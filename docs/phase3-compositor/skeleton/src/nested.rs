// Nested backend: run salmon-shell as a Wayland client of your existing
// GNOME / KDE / Sway session. The "winit" backend opens a host-side
// window and gives us a GL context inside it. We're then a fully
// functional Wayland compositor — just one whose output happens to be
// another compositor's surface, not a real monitor.
//
// This is the ONLY backend you should iterate against during initial
// bring-up. Crashes don't take down your host session; you can `cargo
// run` again 30 seconds later and not lose your unsaved work.
//
// The main loop:
//   1. winit drives input + repaint
//   2. wayland_server dispatches client events to handlers (handlers.rs)
//   3. on each redraw, we render every Window in `space` into the GL
//      context and present
//
// Smithay ships an example called `anvil` doing exactly this. When this
// skeleton breaks, anvil/src/winit.rs is the canonical reference.

#![cfg(feature = "nested")]

use std::process::Command;
use std::time::Duration;

use anyhow::Result;
use smithay::{
    backend::{
        renderer::{
            damage::OutputDamageTracker,
            element::surface::WaylandSurfaceRenderElement,
            gles::GlesRenderer,
            Bind,
        },
        winit::{self, WinitEvent, WinitGraphicsBackend},
    },
    desktop::space::SpaceRenderElements,
    output::{Mode as OutputMode, Output, PhysicalProperties, Subpixel},
    reexports::{
        calloop::{generic::Generic, EventLoop, Interest, Mode as CalloopMode, PostAction},
        wayland_server::Display,
    },
    utils::{Rectangle, Transform},
};

use crate::state::{ClientState, SalmonState};

pub fn run(args: &crate::Args) -> Result<()> {
    // 1. Calloop event loop. Smithay's run() expects 'static handlers
    // attached to LoopHandle<'static, SalmonState>.
    let mut event_loop: EventLoop<'static, SalmonState> = EventLoop::try_new()?;

    // 2. Display = the wayland_server-side state of the protocol.
    let mut display: Display<SalmonState> = Display::new()?;

    // 3. SalmonState pulls together all per-protocol state and grabs a
    // listening unix socket under $XDG_RUNTIME_DIR.
    let (mut state, socket_source) = SalmonState::new(
        &mut display,
        event_loop.handle(),
        event_loop.get_signal(),
    )?;

    // 4. Hook the listening socket into the loop. Every accept() spawns
    // a new client; we hand it a ClientState that holds per-client
    // protocol bookkeeping.
    event_loop
        .handle()
        .insert_source(socket_source, |stream, _, state| {
            if let Err(err) = state
                .display_handle
                .insert_client(stream, std::sync::Arc::new(ClientState::default()))
            {
                tracing::warn!(?err, "client insert failed");
            }
        })
        .map_err(|e| anyhow::anyhow!("insert socket source: {e}"))?;

    // 5. Hook the Display fd into the loop so per-tick we drain whatever
    // clients sent us.
    let display_fd = display.backend().poll_fd().as_raw_fd();
    event_loop
        .handle()
        .insert_source(
            Generic::new(display_fd, Interest::READ, CalloopMode::Level),
            |_, _, state| {
                state.display_handle.dispatch_clients(state)
                    .map(|_| PostAction::Continue)
                    .map_err(|e| {
                        tracing::error!(?e, "dispatch_clients");
                        std::io::Error::new(std::io::ErrorKind::Other, e)
                    })
            },
        )
        .map_err(|e| anyhow::anyhow!("insert display source: {e}"))?;

    // 6. Bring up the winit backend. This opens a host-side window and
    // returns a GL renderer pointing at its EGL surface.
    let (mut backend, mut winit_loop) = winit::init::<GlesRenderer>()
        .map_err(|e| anyhow::anyhow!("winit init: {e}"))?;
    let size = backend.window_size();
    let mode = OutputMode {
        size: size.into(),
        refresh: 60_000,
    };
    let output = Output::new(
        "winit".to_string(),
        PhysicalProperties {
            size: (0, 0).into(),
            subpixel: Subpixel::Unknown,
            make: "salmon".into(),
            model: "winit".into(),
        },
    );
    output.create_global::<SalmonState>(&state.display_handle);
    output.change_current_state(
        Some(mode),
        Some(Transform::Flipped180),
        None,
        Some((0, 0).into()),
    );
    output.set_preferred(mode);
    state.space.map_output(&output, (0, 0));
    let mut damage_tracker = OutputDamageTracker::from_output(&output);

    // 7. Set WAYLAND_DISPLAY so child processes (the salmon-app UI
    // client we spawn next) connect to OUR socket, not the host's.
    std::env::set_var("WAYLAND_DISPLAY", &state.socket_name);
    tracing::info!(socket = ?state.socket_name, "ready");

    // 8. Spawn the UI layer.
    if !args.no_ui {
        match Command::new(&args.ui_binary)
            .env("WAYLAND_DISPLAY", &state.socket_name)
            .env("SALMON_LAYER_SHELL", "1") // hint: salmon-app reads this
            .spawn()
        {
            Ok(child) => {
                tracing::info!(pid = child.id(), bin = %args.ui_binary, "spawned UI layer");
                state.ui_pid = Some(child.id());
            }
            Err(e) => {
                tracing::warn!(?e, bin = %args.ui_binary, "could not spawn UI layer (continuing headless)");
            }
        }
    }

    // 9. The main loop. winit drives input + redraw; calloop drives
    // wayland dispatch.
    loop {
        // Pull pending winit events.
        let dispatch_result = winit_loop.dispatch_new_events(|event| match event {
            WinitEvent::Resized { size, .. } => {
                let new_mode = OutputMode {
                    size: size.into(),
                    refresh: 60_000,
                };
                output.change_current_state(Some(new_mode), None, None, None);
            }
            WinitEvent::Input(event) => {
                // TODO(verify): route through crate::input::dispatch_event.
                // Anvil's input.rs is the reference; v0 just logs.
                tracing::trace!(?event, "winit input event (TODO route)");
            }
            WinitEvent::CloseRequested => {
                state.loop_signal.stop();
            }
            WinitEvent::Focus(_) | WinitEvent::Refresh => {}
        });

        if let Err(err) = dispatch_result {
            tracing::error!(?err, "winit dispatch failed; exiting");
            break;
        }

        // Render every mapped window + every layer surface into the
        // GL context. Layer ordering, bottom → top:
        //   background layer (wallpaper) → bottom layer (salmon-app
        //   UI lives here) → app windows (Space) → top layer
        //   (notifications) → overlay layer (lock screen, modals)
        let size = backend.window_size();
        let damage = Rectangle::from_loc_and_size((0, 0), size);
        backend
            .bind()
            .map_err(|e| anyhow::anyhow!("backend bind: {e}"))?;

        // Collect the four layer-shell layers, then app windows, in
        // bottom-to-top order. Smithay's layer_map_for_output gives us
        // the per-output layer surfaces grouped by Layer enum value.
        let mut elements: Vec<smithay::backend::renderer::element::AsRenderElements<GlesRenderer>>
            = Vec::new();

        // TODO(verify): the exact API for collecting layer surface
        // render elements changed across Smithay versions. In 0.7 the
        // pattern is:
        //
        //   let layer_map = smithay::desktop::layer_map_for_output(&output);
        //   for layer in [Layer::Background, Layer::Bottom] {
        //       for surface in layer_map.layers_on(layer) {
        //           elements.extend(surface.render_elements(...));
        //       }
        //   }
        //   // ... space.render_elements between bottom and top
        //   for layer in [Layer::Top, Layer::Overlay] { /* same */ }
        //
        // For v0 of this skeleton we render only Space windows so the
        // build doesn't break on layer-surface element type generics.
        // Once you confirm the actual collector signature in your
        // Smithay version, uncomment the layer iteration above and
        // remove this comment block.
        let space_elements: Vec<SpaceRenderElements<_, WaylandSurfaceRenderElement<GlesRenderer>>> =
            smithay::desktop::space::space_render_elements(
                backend.renderer(),
                [&state.space],
                &output,
                1.0,
            )
            .map_err(|e| anyhow::anyhow!("collect render elements: {e:?}"))?;

        damage_tracker
            .render_output(
                backend.renderer(),
                0,
                &space_elements,
                [0.05, 0.05, 0.08, 1.0], // background colour (dark navy)
            )
            .map_err(|e| anyhow::anyhow!("render_output: {e:?}"))?;

        // Quiet "unused" while elements vec is a placeholder.
        let _ = elements;
        backend
            .submit(Some(&[damage]))
            .map_err(|e| anyhow::anyhow!("backend submit: {e}"))?;

        // Send frame callbacks to clients so they know they can draw
        // the next frame.
        state.space.elements().for_each(|window| {
            window.send_frame(
                &output,
                state.start_time.elapsed(),
                Some(Duration::ZERO),
                |_, _| Some(output.clone()),
            );
        });

        // Drive the calloop loop for one tick. 16ms ≈ 60Hz.
        event_loop
            .dispatch(Some(Duration::from_millis(16)), &mut state)
            .map_err(|e| anyhow::anyhow!("calloop dispatch: {e}"))?;

        // Flush pending events back to clients.
        let _ = display.flush_clients();
    }

    Ok(())
}

// AsRawFd shim: depending on rust version + features, the Generic::new
// signature changed between calloop 0.13 / 0.14. If your build chokes
// here, replace with .raw_fd() or .as_raw_fd() as appropriate.
use std::os::unix::io::AsRawFd;
