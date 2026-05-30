// wl_seat: keyboard / pointer / touch routing.
//
// `focus_changed` is the hook to update window decorations / dim
// other windows when focus moves. v0: no-op.
//
// `cursor_image` is fired when a client wants to set a custom cursor
// (e.g. a text-edit cursor when hovering over an input field). v0
// ignores it — TTY mode will need to render the requested surface
// as the cursor texture.

use smithay::{
    delegate_seat,
    input::{pointer::CursorImageStatus, Seat, SeatHandler, SeatState},
    reexports::wayland_server::protocol::wl_surface::WlSurface,
};

use crate::state::SalmonState;

impl SeatHandler for SalmonState {
    type KeyboardFocus = WlSurface;
    type PointerFocus = WlSurface;
    type TouchFocus = WlSurface;

    fn seat_state(&mut self) -> &mut SeatState<Self> {
        &mut self.seat_state
    }

    fn focus_changed(&mut self, _seat: &Seat<Self>, _focused: Option<&WlSurface>) {}

    fn cursor_image(&mut self, _seat: &Seat<Self>, _image: CursorImageStatus) {
        // TODO: track the latest client cursor request so render.rs can
        // composite the right cursor surface in TTY mode. Nested mode
        // borrows the host's cursor and doesn't need this.
    }
}
delegate_seat!(SalmonState);
