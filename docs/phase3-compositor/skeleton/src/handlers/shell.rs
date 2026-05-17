// xdg_shell: how clients say "I am a window" / "I am a popup".
//
// move_request / resize_request need to install pointer grabs to drag
// the window; v0 leaves them as TODO (anvil has clean MoveSurfaceGrab
// + ResizeSurfaceGrab examples to port).

use smithay::{
    delegate_xdg_shell,
    desktop::Window,
    reexports::{
        wayland_protocols::xdg::shell::server::xdg_toplevel,
        wayland_server::protocol::wl_seat,
    },
    utils::Serial,
    wayland::shell::xdg::{
        PopupSurface, PositionerState, ToplevelSurface, XdgShellHandler, XdgShellState,
    },
};

use crate::state::SalmonState;

impl XdgShellHandler for SalmonState {
    fn xdg_shell_state(&mut self) -> &mut XdgShellState {
        &mut self.xdg_shell_state
    }

    fn new_toplevel(&mut self, surface: ToplevelSurface) {
        let window = Window::new_wayland_window(surface);
        // v0 placement: origin of the active output. A real WM picks
        // based on focus / pointer position / workspace state.
        self.space.map_element(window, (0, 0), true);
    }

    fn new_popup(&mut self, surface: PopupSurface, _positioner: PositionerState) {
        if let Err(err) = self.popups.track_popup(surface.into()) {
            tracing::warn!(?err, "failed to track popup");
        }
    }

    fn move_request(&mut self, _surface: ToplevelSurface, _seat: wl_seat::WlSeat, _serial: Serial) {
        // TODO: install MoveSurfaceGrab on the seat's pointer.
        // Reference: smithay/anvil/src/input.rs::move_request
    }

    fn resize_request(
        &mut self,
        _surface: ToplevelSurface,
        _seat: wl_seat::WlSeat,
        _serial: Serial,
        _edges: xdg_toplevel::ResizeEdge,
    ) {
        // TODO: install ResizeSurfaceGrab. Same anvil reference.
    }

    fn grab(&mut self, _surface: PopupSurface, _seat: wl_seat::WlSeat, _serial: Serial) {
        // TODO: PopupGrab so the popup gets exclusive pointer focus
        // until dismissed (outside-click → unmap).
    }

    fn reposition_request(
        &mut self,
        surface: PopupSurface,
        positioner: PositionerState,
        token: u32,
    ) {
        surface.with_pending_state(|state| {
            state.geometry = positioner.get_geometry();
            state.positioner = positioner;
        });
        surface.send_repositioned(token);
    }
}
delegate_xdg_shell!(SalmonState);
