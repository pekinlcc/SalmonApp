// Wayland protocol handlers — one file per protocol so the dependency
// surface for each is easy to audit.
//
// Adding a new protocol:
//   1. Add a `protocol.rs` file here implementing the relevant
//      `*Handler` trait + `delegate_*!` macro.
//   2. Add the `mod protocol;` declaration below.
//   3. Add any state fields the handler needs to `SalmonState` in state.rs.
//   4. If the protocol exposes a global, create it during state.rs ::new().
//
// Order below loosely matches Tier 1 → Tier 3 from
// docs/phase3-compositor/wayland-protocols.md.

// Tier 1 — minimum-viable compositor.
pub mod compositor;
pub mod shell;
pub mod shm;
pub mod seat;
pub mod data_device;
pub mod output;

// Tier 2 — needed for daily-driver feel.
pub mod layer_shell;
pub mod decoration;
pub mod text_input;
pub mod foreign_toplevel;
pub mod keyboard_shortcuts;
pub mod dmabuf;
pub mod scaling;
pub mod screencopy;

// XWayland — bridge for legacy X11 apps. Gated behind feature flag
// because Smithay's xwayland integration pulls in extra deps and
// you may want to ship a Wayland-only build for size reasons.
#[cfg(feature = "xwayland")]
pub mod xwayland;

use smithay::{
    desktop::WindowSurfaceType,
    input::pointer::{MotionEvent, PointerHandle},
    reexports::wayland_server::protocol::wl_surface::WlSurface,
    utils::{Logical, Point, Serial, SERIAL_COUNTER},
};

use crate::state::SalmonState;

/// Locate the surface under the pointer, returning both the surface and
/// the location of its origin in compositor coordinates.
pub fn surface_under_pointer(
    state: &SalmonState,
    pos: Point<f64, Logical>,
) -> Option<(WlSurface, Point<i32, Logical>)> {
    state
        .space
        .element_under(pos)
        .and_then(|(window, window_loc)| {
            window
                .surface_under(pos - window_loc.to_f64(), WindowSurfaceType::ALL)
                .map(|(s, loc)| (s, window_loc + loc))
        })
}

pub fn next_serial() -> Serial {
    SERIAL_COUNTER.next_serial()
}

/// Click-to-focus: when the user clicks on a window, give it keyboard
/// focus and dispatch the corresponding pointer-motion event so the
/// app sees an enter event before the button press.
#[allow(dead_code)]
pub fn focus_pointer_on_click(state: &mut SalmonState, pos: Point<f64, Logical>) {
    let pointer: PointerHandle<SalmonState> = match state.seat.get_pointer() {
        Some(p) => p,
        None => return,
    };
    if let Some((surface, _)) = surface_under_pointer(state, pos) {
        let serial = next_serial();
        if let Some(kb) = state.seat.get_keyboard() {
            kb.set_focus(state, Some(surface.clone()), serial);
        }
        pointer.motion(
            state,
            Some((surface, pos.to_i32_round())),
            &MotionEvent {
                location: pos,
                serial,
                time: state.start_time.elapsed().as_millis() as u32,
            },
        );
    }
}
