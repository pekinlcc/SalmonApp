// xdg-decoration-v1: client- vs server-side decoration negotiation.
//
// Most GTK apps prefer client-side (they draw their own titlebar).
// Most Qt and many smaller apps prefer server-side. Without this
// protocol the client gets stuck waiting for a `configure` that
// includes the decoration mode it asked for, and never draws.
//
// v0: we always respond with "use ClientSide" since v0 doesn't draw
// titlebars anyway. Once we have a desktop-shell theme, switch to
// honouring the client's preferred mode (anvil mirrors the request).

use smithay::{
    delegate_xdg_decoration,
    reexports::wayland_protocols::xdg::decoration::zv1::server::zxdg_toplevel_decoration_v1::Mode,
    wayland::shell::xdg::{decoration::XdgDecorationHandler, ToplevelSurface},
};

use crate::state::SalmonState;

impl XdgDecorationHandler for SalmonState {
    fn new_decoration(&mut self, toplevel: ToplevelSurface) {
        toplevel.with_pending_state(|state| {
            state.decoration_mode = Some(Mode::ClientSide);
        });
        toplevel.send_pending_configure();
    }

    fn request_mode(&mut self, toplevel: ToplevelSurface, _mode: Mode) {
        toplevel.with_pending_state(|state| {
            state.decoration_mode = Some(Mode::ClientSide);
        });
        toplevel.send_pending_configure();
    }

    fn unset_mode(&mut self, toplevel: ToplevelSurface) {
        toplevel.with_pending_state(|state| {
            state.decoration_mode = Some(Mode::ClientSide);
        });
        toplevel.send_pending_configure();
    }
}
delegate_xdg_decoration!(SalmonState);
