// Wayland protocol handlers, in one file because they're mostly
// boilerplate delegations. Smithay's `delegate_*!` macros expand to
// the per-protocol `Dispatch` impls; we just provide the *Handler*
// trait body that says "what to do when a request comes in".
//
// Files referenced:
//   handlers/compositor.rs (CompositorHandler) — surface lifecycle
//   handlers/shell.rs      (XdgShellHandler)  — windows / popups
//   handlers/shm.rs        (ShmHandler)       — shared-memory buffers
//   handlers/seat.rs       (SeatHandler)      — input device routing
//   handlers/data_device.rs (DataDeviceHandler) — clipboard / DnD
//   handlers/output.rs     (OutputHandler)    — multi-monitor
//
// They're inlined in this single file for v0; once you start growing
// each (e.g. real DnD support), split into the file paths above.

use smithay::{
    delegate_compositor, delegate_data_device, delegate_output, delegate_seat,
    delegate_shm, delegate_xdg_shell,
    desktop::{Window, WindowSurfaceType},
    input::{
        pointer::{CursorImageStatus, PointerHandle},
        Seat, SeatHandler, SeatState,
    },
    reexports::{
        wayland_protocols::xdg::shell::server::xdg_toplevel,
        wayland_server::{
            protocol::{wl_seat, wl_surface::WlSurface},
            Client, Resource,
        },
    },
    utils::{Logical, Point, Serial, SERIAL_COUNTER},
    wayland::{
        compositor::{
            get_parent, is_sync_subsurface, CompositorClientState, CompositorHandler,
            CompositorState,
        },
        selection::{
            data_device::{
                ClientDndGrabHandler, DataDeviceHandler, DataDeviceState, ServerDndGrabHandler,
            },
            SelectionHandler,
        },
        shell::xdg::{
            PopupSurface, PositionerState, ToplevelSurface, XdgPopupSurfaceData,
            XdgShellHandler, XdgShellState, XdgToplevelSurfaceData,
        },
        shm::{ShmHandler, ShmState},
    },
};

use crate::state::{ClientState, SalmonState};

// ─── CompositorHandler ────────────────────────────────────────────────
// Surface lifecycle: created, committed, destroyed.

impl CompositorHandler for SalmonState {
    fn compositor_state(&mut self) -> &mut CompositorState {
        &mut self.compositor_state
    }

    fn client_compositor_state<'a>(&self, client: &'a Client) -> &'a CompositorClientState {
        &client.get_data::<ClientState>().unwrap().compositor_state
    }

    fn commit(&mut self, surface: &WlSurface) {
        // Defer to subsurface sync if needed: a synced subsurface commit
        // doesn't apply until its parent commits.
        if is_sync_subsurface(surface) {
            return;
        }
        // Walk to the toplevel parent — that's whose buffer changed.
        let mut root = surface.clone();
        while let Some(parent) = get_parent(&root) {
            root = parent;
        }
        // Inform the desktop layer (Space) so it can refresh sizes /
        // mark the surface dirty for redraw.
        if let Some(window) = self
            .space
            .elements()
            .find(|w| w.toplevel().map(|t| t.wl_surface() == &root).unwrap_or(false))
            .cloned()
        {
            window.on_commit();
        }
        // Popups likewise.
        self.popups.commit(surface);
    }
}
delegate_compositor!(SalmonState);

// ─── ShmHandler ───────────────────────────────────────────────────────

impl ShmHandler for SalmonState {
    fn shm_state(&self) -> &ShmState {
        &self.shm_state
    }
}
delegate_shm!(SalmonState);

// ─── XdgShellHandler ─────────────────────────────────────────────────
// "I am a window" / "I am a popup" requests.

impl XdgShellHandler for SalmonState {
    fn xdg_shell_state(&mut self) -> &mut XdgShellState {
        &mut self.xdg_shell_state
    }

    fn new_toplevel(&mut self, surface: ToplevelSurface) {
        // New window. Add to the space at origin; a real WM would pick
        // a placement based on focus, mouse position, or workspace state.
        let window = Window::new_wayland_window(surface);
        self.space.map_element(window, (0, 0), true);
    }

    fn new_popup(&mut self, surface: PopupSurface, _positioner: PositionerState) {
        // Track the popup so it gets dismissed correctly when its
        // parent loses focus.
        if let Err(err) = self.popups.track_popup(surface.into()) {
            tracing::warn!(?err, "failed to track popup");
        }
    }

    fn move_request(&mut self, _surface: ToplevelSurface, _seat: wl_seat::WlSeat, _serial: Serial) {
        // TODO(verify): wire to PointerGrab implementing MoveSurfaceGrab.
        // Anvil has a clean example in input.rs::move_request.
    }

    fn resize_request(
        &mut self,
        _surface: ToplevelSurface,
        _seat: wl_seat::WlSeat,
        _serial: Serial,
        _edges: xdg_toplevel::ResizeEdge,
    ) {
        // TODO(verify): wire to ResizeSurfaceGrab. Same anvil reference.
    }

    fn grab(&mut self, _surface: PopupSurface, _seat: wl_seat::WlSeat, _serial: Serial) {
        // TODO(verify): popup grab handling. For now letting clients
        // dismiss popups on outside-click via the default behaviour.
    }

    fn reposition_request(
        &mut self,
        _surface: PopupSurface,
        _positioner: PositionerState,
        _token: u32,
    ) {
        // TODO(verify): respond with repositioned() per xdg_popup_v3.
    }
}
delegate_xdg_shell!(SalmonState);

// ─── SeatHandler ─────────────────────────────────────────────────────

impl SeatHandler for SalmonState {
    type KeyboardFocus = WlSurface;
    type PointerFocus = WlSurface;
    type TouchFocus = WlSurface;

    fn seat_state(&mut self) -> &mut SeatState<Self> {
        &mut self.seat_state
    }

    fn focus_changed(&mut self, _seat: &Seat<Self>, _focused: Option<&WlSurface>) {
        // Hook here to update window decorations / dim other windows
        // when focus changes. v0: no-op.
    }

    fn cursor_image(&mut self, _seat: &Seat<Self>, _image: CursorImageStatus) {
        // Client-requested cursor change. v0: we ignore and keep the
        // default cursor. v1 should draw the requested surface.
    }
}
delegate_seat!(SalmonState);

// ─── DataDevice / Selection ──────────────────────────────────────────
// Clipboard + drag-and-drop. v0 supports the minimum required for
// most clients not to crash; real DnD is a multi-week protocol exercise.

impl SelectionHandler for SalmonState {
    type SelectionUserData = ();
}

impl DataDeviceHandler for SalmonState {
    fn data_device_state(&self) -> &DataDeviceState {
        &self.data_device_state
    }
}

impl ClientDndGrabHandler for SalmonState {}
impl ServerDndGrabHandler for SalmonState {}

delegate_data_device!(SalmonState);

// ─── OutputHandler ───────────────────────────────────────────────────

impl smithay::wayland::output::OutputHandler for SalmonState {}
delegate_output!(SalmonState);

// ─── Helper: dispatch input to focused surface ───────────────────────
// Not a trait impl but lives here because input handlers (nested.rs,
// tty.rs) call into it to commit pointer/keyboard events.

#[allow(dead_code)]
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

#[allow(dead_code)]
pub fn next_serial() -> Serial {
    SERIAL_COUNTER.next_serial()
}

#[allow(dead_code)]
pub fn focus_pointer_on_click(state: &mut SalmonState, pos: Point<f64, Logical>) {
    let pointer: PointerHandle<SalmonState> = match state.seat.get_pointer() {
        Some(p) => p,
        None => return,
    };
    if let Some((surface, _)) = surface_under_pointer(state, pos) {
        let serial = next_serial();
        state.seat.get_keyboard().map(|kb| {
            kb.set_focus(state, Some(surface.clone()), serial);
        });
        pointer.motion(
            state,
            Some((surface, pos.to_i32_round())),
            &smithay::input::pointer::MotionEvent {
                location: pos,
                serial,
                time: state.start_time.elapsed().as_millis() as u32,
            },
        );
    }
}

// Currently unused but stops "import never used" warnings while the
// stubs above are still no-ops.
#[allow(dead_code)]
fn _silence_unused(_d: &XdgToplevelSurfaceData, _p: &XdgPopupSurfaceData) {}
