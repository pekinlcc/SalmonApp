// XWayland: bridge for legacy X11 apps (Steam, older Electron apps,
// JetBrains IDEs, GIMP <3.0, …). About 30% of the Linux app ecosystem
// still expects X11.
//
// Architecture: salmon-shell spawns the `Xwayland` binary as a child
// process. Xwayland speaks the X11 protocol to its clients but speaks
// Wayland to us (the compositor). We become an X11 window manager from
// X11's perspective and a normal Wayland compositor from our own
// perspective.
//
// Smithay's `XWayland` struct hides most of the choreography. You
// provide an event handler that gets called on every X11 event
// (window mapped, configured, mouse moved, etc.); Smithay wraps each
// X11 window as an `X11Surface` that you treat as a Wayland surface
// for compositing purposes.
//
// v0 scaffold: spawn XWayland on startup, log when it's ready. Window
// management is stub — port from anvil/src/xwayland.rs when you start
// actually using X11 apps.

#![allow(dead_code)]

use smithay::{
    reexports::calloop::LoopHandle,
    utils::Logical,
    xwayland::{
        xwm::{Reorder, XwmId},
        X11Surface, X11Wm, XWayland, XWaylandEvent, XwmHandler,
    },
};

use crate::state::SalmonState;

pub fn launch_xwayland(loop_handle: &LoopHandle<'static, SalmonState>) -> anyhow::Result<()> {
    let (xwayland, channel) = XWayland::new(loop_handle.clone(), None);
    loop_handle
        .insert_source(channel, move |event, _, state: &mut SalmonState| {
            match event {
                XWaylandEvent::Ready {
                    x11_socket,
                    display_number,
                    ..
                } => {
                    tracing::info!(display = display_number, "XWayland ready");
                    std::env::set_var("DISPLAY", format!(":{display_number}"));
                    // TODO(verify): the X11Wm::start_wm signature changed
                    // between Smithay 0.6 and 0.7. Anvil constructs the
                    // Wm and stashes it on the state so subsequent
                    // events can route through it.
                    state.xwm_socket = Some(x11_socket);
                }
                XWaylandEvent::Error => {
                    tracing::error!("XWayland exited with error");
                    state.xwm_socket = None;
                }
            }
        })
        .map_err(|e| anyhow::anyhow!("insert xwayland channel source: {e}"))?;
    if let Err(e) = xwayland.start(loop_handle.clone(), None, std::iter::empty::<(String, String)>(), true, |_| {}) {
        anyhow::bail!("xwayland start: {e}");
    }
    Ok(())
}

// X11 window-management events.
//
// Each callback corresponds to an X11 request — map, unmap, configure,
// destroy, etc. Smithay wraps the X11 window as an `X11Surface` which
// you can put into `Space` just like a regular Wayland Window via
// `Window::new_x11_window(surface)`.
//
// v0: most callbacks are no-ops with TODO markers. The minimum-viable
// XWm needs at least `map_window_request` (to add the window to space)
// and `unmapped_window` (to remove it).

impl XwmHandler for SalmonState {
    fn xwm_state(&mut self, _xwm: XwmId) -> &mut X11Wm {
        // TODO(verify): typically the binary stores the X11Wm in state
        // (e.g. `pub xwm: Option<X11Wm>` on SalmonState) and returns a
        // mut reference here. Anvil's pattern.
        unimplemented!("store X11Wm on SalmonState first")
    }

    fn new_window(&mut self, _xwm: XwmId, _window: X11Surface) {}
    fn new_override_redirect_window(&mut self, _xwm: XwmId, _window: X11Surface) {}

    fn map_window_request(&mut self, _xwm: XwmId, window: X11Surface) {
        // TODO: configure the surface, then wrap as a Window and add to
        // self.space. Refer to anvil/src/xwayland.rs::map_window_request.
        if let Err(e) = window.set_mapped(true) {
            tracing::warn!(?e, "set_mapped(true)");
        }
    }

    fn mapped_override_redirect_window(&mut self, _xwm: XwmId, _window: X11Surface) {}

    fn unmapped_window(&mut self, _xwm: XwmId, _window: X11Surface) {
        // TODO: remove from self.space.
    }

    fn destroyed_window(&mut self, _xwm: XwmId, _window: X11Surface) {}

    fn configure_request(
        &mut self,
        _xwm: XwmId,
        window: X11Surface,
        _x: Option<i32>,
        _y: Option<i32>,
        _w: Option<u32>,
        _h: Option<u32>,
        _reorder: Option<Reorder>,
    ) {
        // Honour the client's requested geometry — Wayland doesn't have
        // an equivalent so we mostly just accept what X11 apps ask for.
        if let Err(e) = window.configure(None) {
            tracing::warn!(?e, "x11 configure");
        }
    }

    fn configure_notify(
        &mut self,
        _xwm: XwmId,
        _window: X11Surface,
        _geometry: smithay::utils::Rectangle<i32, Logical>,
        _above: Option<u32>,
    ) {
    }

    fn resize_request(
        &mut self,
        _xwm: XwmId,
        _window: X11Surface,
        _button: u32,
        _resize_edge: smithay::xwayland::xwm::ResizeEdge,
    ) {
    }

    fn move_request(&mut self, _xwm: XwmId, _window: X11Surface, _button: u32) {}
}
