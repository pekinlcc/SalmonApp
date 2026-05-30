# Phase 3 Skeleton — Status (2026-05-17, evening)

Updated after the "慢慢做" session that took the skeleton from 0 → compiles →
runs nested with a Wayland client connected. **Still nowhere near "install
this as your GDM session"**, but two real milestones cleared.

## Status

| Milestone | Status |
|---|---|
| Skeleton compiles (`cargo build --features nested`) | ✅ green |
| Compositor binary launches without crashing | ✅ |
| Wayland socket bound under `$XDG_RUNTIME_DIR/wayland-1` | ✅ |
| winit backend opens host-side window | ✅ |
| EGL platform `PLATFORM_WAYLAND_KHR` + OpenGL ES 3.2 context on Lunar Lake iGPU | ✅ |
| `wl_output` created, ready event emitted | ✅ |
| `weston-terminal` connects to `wayland-1` without protocol error | ✅ |
| **Pixels actually visible on screen** | ⚠️ unverified — needs visual confirmation |
| Layer-shell surfaces rendered | ❌ collection deferred (see `nested.rs` TODO) |
| Real input routing (libinput → focused client) | ❌ stubbed in `input.rs` |
| TTY backend (DRM/KMS) | ❌ `tty.rs` still stub |
| XWayland integration | ❌ feature gated off; needs rewrite vs Smithay 0.7's `XWayland::spawn` |
| Installable as a GDM session | ❌ months away |

## What got fixed this session

1. **`Cargo.toml`** — add `[workspace]` to detach from root SalmonApp
   workspace; drop `xwayland` from default features.
2. **`handlers/shell.rs`** — `MoveSurfaceGrab` / `ResizeSurfaceGrab`
   `PointerGrab` impls:
   - Promoted focus arg `Point<i32, Logical> → Point<f64, Logical>`.
   - Added 8 gesture stubs per grab.
   - Fixed `popups.grab_popup(self, ...)` → `grab_popup(root_surface, ...)`
     by pulling the popup's xdg parent surface.
   - `let mut cached` (current() needs &mut self in 0.7).
   - Imported `Resource` trait so `.id()` resolves on `WlSurface`.
3. **`handlers/dmabuf.rs`** — added `impl BufferHandler for SalmonState`
   (no-op `buffer_destroyed`); required supertrait of `DmabufHandler`.
4. **`handlers/text_input.rs`** — added v0 `impl InputMethodHandler`
   stubs (new/dismiss/reposition popups + zero-rect `parent_geometry`).
   Enough for the delegate macro to compile.
5. **`handlers/mod.rs` + `state.rs`** — disabled screencopy module +
   state field (not in Smithay 0.7 release, only git main).
6. **`handlers/scaling.rs`** — fixed `with_fractional_scale` callback to
   take `&SurfaceData` via `compositor::with_states` bridge.
7. **`handlers/layer_shell.rs`** — rewrote `new_layer_surface` and
   `layer_destroyed` to bind layer-map guards to locals before chaining
   (fixes "does not live long enough" + mut/imm borrow conflicts).
8. **`nested.rs`** — many:
   - Replaced `display.backend().poll_fd().as_raw_fd()` →
     `display.backend().poll_fd().try_clone_to_owned()?` so calloop's
     `Generic` source gets an `OwnedFd: AsFd: 'static`.
   - Moved `display` into the loop closure so we can call
     `display.dispatch_clients(state)` (0.7 method on `Display`, not
     `DisplayHandle`); replaced the outer-scope `display.flush_clients()`
     with `state.display_handle.flush_clients()`.
   - Dropped the unused `Vec<AsRenderElements<...>>` placeholder
     (AsRenderElements is a trait, not a type).
   - Switched `dispatch_new_events` Result handling to `PumpStatus` match.
   - Added `WinitEvent::Redraw` arm; dropped removed `Refresh` arm.
   - Restructured render block: bind → render lives in a child scope so
     `framebuffer` (which mutably borrows backend) drops before
     `backend.submit(None)` (which also mutably borrows backend).
   - Pass `&mut framebuffer` as 2nd arg to `damage_tracker.render_output`
     (new in 0.7 — render target is now explicit).

## What it does now

```
$ cargo run --features nested --no-default-features -- --no-ui
INFO salmon-shell starting
INFO wayland socket bound socket="wayland-1"
INFO backend_winit: Initializing a winit backend
INFO EGL Initialized version=(1, 5)
INFO renderer_gles2: GL Renderer: "Mesa Intel(R) Graphics (LNL)"
INFO Creating new Output name="winit"
INFO Creating new wl_output
INFO ready socket="wayland-1"

# In another shell:
$ WAYLAND_DISPLAY=wayland-1 weston-terminal
# (connects, no protocol errors)
```

Both processes stay alive, no crashes. **Whether weston-terminal's window
actually appears inside our nested compositor's host-side window** is
the next thing to verify with eyes-on-screen. The pipeline is up: socket,
EGL, GL renderer, output, client connection. The "no pixels" failure
mode would mean the render path silently produces a black frame; the
"pixels are wrong" failure mode means the surface attach handler isn't
wiring buffer textures correctly. Either is iteratable on from here.

## What's still missing (rough order)

### Tier 1 — make weston-terminal actually render

1. **Verify the host window appears + shows clear color** (the
   [0.05, 0.05, 0.08] dark navy from `render_output`). If yes:
   buffer-tex pipeline broken; if no: rendering pipeline broken.
2. **Wire input** — `input.rs` currently logs WinitEvent::Input without
   forwarding to the seat. Anvil's `input.rs` is the reference. Without
   this, weston-terminal sees no keyboard / mouse.
3. **Layer-shell render** — uncomment the layer iteration in `nested.rs`
   so salmon-app's UI layer (when we spawn it) actually composites.

### Tier 2 — be a usable nested desktop

4. **Cursor rendering** — `CursorImageStatus` from `handlers/seat.rs`
   isn't used; we just leak the host's cursor through. For TTY backend
   we'll need to render the client-requested cursor surface.
5. **`KeyboardFocus` enum** — currently typed as `WlSurface`. Anvil
   wraps `Window` + `LayerSurface` in an enum so focus tracking knows
   what kind of surface owns the keyboard. Refactor before TTY work.
6. **Proper damage tracking** — `backend.submit(None)` redraws the
   full frame every tick (60 fps full repaint). Wire
   `OutputDamageTracker`'s rect set into submit.
7. **XWayland** — rewrite `handlers/xwayland.rs` against
   `XWayland::spawn` (0.7 API). Re-enable feature.

### Tier 3 — make it a real session

8. **TTY backend** (`tty.rs`) — udev + DRM/KMS + libinput. Months of
   work.
9. **GDM session file** — `session/salmon-shell.desktop` exists but
   nothing's been validated end-to-end.
10. **Crash recovery** — currently a panic = stuck black screen on TTY.
    Needs a watchdog (anvil has one).

## Don't install this yet

The skeleton compiles and runs as a nested Wayland compositor demo. It
**does not** belong in `/usr/share/wayland-sessions/`. Doing so today
would brick login. The SalmonApp App + Desktop binaries shipped this
session (in-window fullscreen + multi-window spawn) deliver 90% of the
desktop *feel* with 0% of this risk.
