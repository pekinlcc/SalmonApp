// xdg_shell: how clients say "I am a window" / "I am a popup".
//
// Phase 3 deeper: move/resize requests now install pointer grabs so
// the user can drag and resize windows. Popup grabs route the next
// outside-click to dismiss the popup.

use smithay::{
    delegate_xdg_shell,
    desktop::{Space, Window},
    input::{
        pointer::{
            AxisFrame, ButtonEvent, GrabStartData as PointerGrabStartData, MotionEvent,
            PointerGrab, PointerInnerHandle, RelativeMotionEvent,
        },
        Seat,
    },
    reexports::{
        wayland_protocols::xdg::shell::server::xdg_toplevel,
        wayland_server::{
            protocol::{wl_seat, wl_surface::WlSurface},
            // `Resource` trait brings `.id()` onto WlSurface (etc.) so
            // we can compare client ownership during popup grab setup.
            Resource,
        },
    },
    utils::{IsAlive, Logical, Point, Rectangle, Serial, Size},
    wayland::shell::xdg::{
        PopupSurface, PositionerState, SurfaceCachedState, ToplevelSurface, XdgShellHandler,
        XdgShellState,
    },
};

use crate::state::SalmonState;

impl XdgShellHandler for SalmonState {
    fn xdg_shell_state(&mut self) -> &mut XdgShellState {
        &mut self.xdg_shell_state
    }

    fn new_toplevel(&mut self, surface: ToplevelSurface) {
        let window = Window::new_wayland_window(surface);
        self.space.map_element(window, (0, 0), true);
    }

    fn new_popup(&mut self, surface: PopupSurface, _positioner: PositionerState) {
        if let Err(err) = self.popups.track_popup(surface.into()) {
            tracing::warn!(?err, "failed to track popup");
        }
    }

    fn move_request(&mut self, surface: ToplevelSurface, seat: wl_seat::WlSeat, serial: Serial) {
        let Some(seat) = Seat::<Self>::from_resource(&seat) else {
            return;
        };
        let Some(start_data) = check_grab(&seat, surface.wl_surface(), serial) else {
            return;
        };
        let pointer = match seat.get_pointer() {
            Some(p) => p,
            None => return,
        };
        let window = self
            .space
            .elements()
            .find(|w| w.toplevel().map(|t| t == &surface).unwrap_or(false))
            .cloned();
        let Some(window) = window else { return };
        let initial_window_location = self
            .space
            .element_location(&window)
            .unwrap_or((0, 0).into());
        let grab = MoveSurfaceGrab {
            start_data,
            window,
            initial_window_location,
        };
        pointer.set_grab(self, grab, serial, smithay::input::pointer::Focus::Clear);
    }

    fn resize_request(
        &mut self,
        surface: ToplevelSurface,
        seat: wl_seat::WlSeat,
        serial: Serial,
        edges: xdg_toplevel::ResizeEdge,
    ) {
        let Some(seat) = Seat::<Self>::from_resource(&seat) else {
            return;
        };
        let Some(start_data) = check_grab(&seat, surface.wl_surface(), serial) else {
            return;
        };
        let pointer = match seat.get_pointer() {
            Some(p) => p,
            None => return,
        };
        let window = self
            .space
            .elements()
            .find(|w| w.toplevel().map(|t| t == &surface).unwrap_or(false))
            .cloned();
        let Some(window) = window else { return };
        let initial_window_location = self
            .space
            .element_location(&window)
            .unwrap_or((0, 0).into());
        let initial_window_size = window.geometry().size;
        surface.with_pending_state(|state| {
            state.states.set(xdg_toplevel::State::Resizing);
        });
        surface.send_pending_configure();
        let grab = ResizeSurfaceGrab {
            start_data,
            window,
            edges: ResizeEdge::from(edges),
            initial_window_location,
            initial_window_size,
            last_window_size: initial_window_size,
        };
        pointer.set_grab(self, grab, serial, smithay::input::pointer::Focus::Clear);
    }

    fn grab(&mut self, surface: PopupSurface, seat: wl_seat::WlSeat, serial: Serial) {
        let Some(seat) = Seat::<Self>::from_resource(&seat) else {
            return;
        };
        // Smithay 0.7: grab_popup wants the parent *KeyboardFocus* (i.e.
        // the surface the popup nests beneath), not the compositor state.
        // KeyboardFocus is declared as WlSurface in handlers/seat.rs.
        // `PopupKind::parent` is private in 0.7, so reach into the xdg
        // surface directly before wrapping it in a PopupKind.
        let Some(root) = surface.get_parent_surface() else {
            tracing::warn!("popup has no parent surface, refusing grab");
            return;
        };
        let kind = smithay::desktop::PopupKind::Xdg(surface);
        if let Err(err) = self.popups.grab_popup(root, kind, &seat, serial) {
            tracing::warn!(?err, "popup grab failed");
        }
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

// ─── Grab-start sanity check ─────────────────────────────────────────
// The client gave us a serial — verify the pointer is actually pressed
// and the focused surface matches the surface the client claimed.
// Without this check, a malicious client could grab the pointer at any
// time and steal input.

fn check_grab(
    seat: &Seat<SalmonState>,
    surface: &WlSurface,
    serial: Serial,
) -> Option<PointerGrabStartData<SalmonState>> {
    let pointer = seat.get_pointer()?;
    if !pointer.has_grab(serial) {
        return None;
    }
    let start_data = pointer.grab_start_data()?;
    let (focus_surface, _) = start_data.focus.as_ref()?;
    if !focus_surface.id().same_client_as(&surface.id()) {
        return None;
    }
    Some(start_data)
}

// ─── MoveSurfaceGrab ─────────────────────────────────────────────────

pub struct MoveSurfaceGrab {
    pub start_data: PointerGrabStartData<SalmonState>,
    pub window: Window,
    pub initial_window_location: Point<i32, Logical>,
}

impl PointerGrab<SalmonState> for MoveSurfaceGrab {
    fn motion(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        _focus: Option<(WlSurface, Point<f64, Logical>)>,
        event: &MotionEvent,
    ) {
        // While dragging, focus stays on the dragged surface; no enter/leave.
        handle.motion(data, None, event);
        let delta = event.location - self.start_data.location;
        let new_location = self.initial_window_location.to_f64() + delta;
        data.space
            .map_element(self.window.clone(), new_location.to_i32_round(), true);
    }

    fn relative_motion(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        focus: Option<(WlSurface, Point<f64, Logical>)>,
        event: &RelativeMotionEvent,
    ) {
        handle.relative_motion(data, focus, event);
    }

    fn button(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        event: &ButtonEvent,
    ) {
        handle.button(data, event);
        if handle.current_pressed().is_empty() {
            handle.unset_grab(self, data, event.serial, event.time, true);
        }
    }

    fn axis(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        details: AxisFrame,
    ) {
        handle.axis(data, details);
    }

    fn frame(&mut self, data: &mut SalmonState, handle: &mut PointerInnerHandle<'_, SalmonState>) {
        handle.frame(data);
    }

    // Touch-gesture stubs — Smithay 0.7 added these to the PointerGrab
    // trait. We don't initiate window moves from gestures, so each one
    // just delegates to the inner handle (which fires the right events
    // on the focused client).
    fn gesture_swipe_begin(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        event: &smithay::input::pointer::GestureSwipeBeginEvent,
    ) { handle.gesture_swipe_begin(data, event); }
    fn gesture_swipe_update(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        event: &smithay::input::pointer::GestureSwipeUpdateEvent,
    ) { handle.gesture_swipe_update(data, event); }
    fn gesture_swipe_end(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        event: &smithay::input::pointer::GestureSwipeEndEvent,
    ) { handle.gesture_swipe_end(data, event); }
    fn gesture_pinch_begin(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        event: &smithay::input::pointer::GesturePinchBeginEvent,
    ) { handle.gesture_pinch_begin(data, event); }
    fn gesture_pinch_update(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        event: &smithay::input::pointer::GesturePinchUpdateEvent,
    ) { handle.gesture_pinch_update(data, event); }
    fn gesture_pinch_end(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        event: &smithay::input::pointer::GesturePinchEndEvent,
    ) { handle.gesture_pinch_end(data, event); }
    fn gesture_hold_begin(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        event: &smithay::input::pointer::GestureHoldBeginEvent,
    ) { handle.gesture_hold_begin(data, event); }
    fn gesture_hold_end(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        event: &smithay::input::pointer::GestureHoldEndEvent,
    ) { handle.gesture_hold_end(data, event); }

    fn start_data(&self) -> &PointerGrabStartData<SalmonState> {
        &self.start_data
    }

    fn unset(&mut self, _data: &mut SalmonState) {}
}

// ─── ResizeSurfaceGrab ───────────────────────────────────────────────

bitflags::bitflags! {
    #[derive(Debug, Clone, Copy)]
    pub struct ResizeEdge: u32 {
        const TOP    = 0b0001;
        const BOTTOM = 0b0010;
        const LEFT   = 0b0100;
        const RIGHT  = 0b1000;
    }
}

impl From<xdg_toplevel::ResizeEdge> for ResizeEdge {
    fn from(value: xdg_toplevel::ResizeEdge) -> Self {
        match value {
            xdg_toplevel::ResizeEdge::Top         => ResizeEdge::TOP,
            xdg_toplevel::ResizeEdge::Bottom      => ResizeEdge::BOTTOM,
            xdg_toplevel::ResizeEdge::Left        => ResizeEdge::LEFT,
            xdg_toplevel::ResizeEdge::Right       => ResizeEdge::RIGHT,
            xdg_toplevel::ResizeEdge::TopLeft     => ResizeEdge::TOP | ResizeEdge::LEFT,
            xdg_toplevel::ResizeEdge::TopRight    => ResizeEdge::TOP | ResizeEdge::RIGHT,
            xdg_toplevel::ResizeEdge::BottomLeft  => ResizeEdge::BOTTOM | ResizeEdge::LEFT,
            xdg_toplevel::ResizeEdge::BottomRight => ResizeEdge::BOTTOM | ResizeEdge::RIGHT,
            _ => ResizeEdge::empty(),
        }
    }
}

pub struct ResizeSurfaceGrab {
    pub start_data: PointerGrabStartData<SalmonState>,
    pub window: Window,
    pub edges: ResizeEdge,
    pub initial_window_location: Point<i32, Logical>,
    pub initial_window_size: Size<i32, Logical>,
    pub last_window_size: Size<i32, Logical>,
}

impl PointerGrab<SalmonState> for ResizeSurfaceGrab {
    fn motion(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        _focus: Option<(WlSurface, Point<f64, Logical>)>,
        event: &MotionEvent,
    ) {
        handle.motion(data, None, event);
        if !self.window.toplevel().map(|t| t.alive()).unwrap_or(false) {
            handle.unset_grab(self, data, event.serial, event.time, true);
            return;
        }
        let delta = event.location - self.start_data.location;
        let mut new_window_size = self.initial_window_size;
        if self.edges.intersects(ResizeEdge::LEFT | ResizeEdge::RIGHT) {
            let dw = if self.edges.contains(ResizeEdge::LEFT) {
                -delta.x
            } else {
                delta.x
            };
            new_window_size.w = (self.initial_window_size.w as f64 + dw).max(1.0) as i32;
        }
        if self.edges.intersects(ResizeEdge::TOP | ResizeEdge::BOTTOM) {
            let dh = if self.edges.contains(ResizeEdge::TOP) {
                -delta.y
            } else {
                delta.y
            };
            new_window_size.h = (self.initial_window_size.h as f64 + dh).max(1.0) as i32;
        }
        if let Some(toplevel) = self.window.toplevel() {
            let (min, max) = smithay::wayland::compositor::with_states(
                toplevel.wl_surface(),
                |states| {
                    let mut cached = states.cached_state.get::<SurfaceCachedState>();
                    let current = cached.current();
                    (current.min_size, current.max_size)
                },
            );
            if min.w > 0 {
                new_window_size.w = new_window_size.w.max(min.w);
            }
            if min.h > 0 {
                new_window_size.h = new_window_size.h.max(min.h);
            }
            if max.w > 0 {
                new_window_size.w = new_window_size.w.min(max.w);
            }
            if max.h > 0 {
                new_window_size.h = new_window_size.h.min(max.h);
            }
            self.last_window_size = new_window_size;
            toplevel.with_pending_state(|state| {
                state.states.set(xdg_toplevel::State::Resizing);
                state.size = Some(new_window_size);
            });
            toplevel.send_pending_configure();
        }
    }

    fn relative_motion(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        focus: Option<(WlSurface, Point<f64, Logical>)>,
        event: &RelativeMotionEvent,
    ) {
        handle.relative_motion(data, focus, event);
    }

    fn button(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        event: &ButtonEvent,
    ) {
        handle.button(data, event);
        if handle.current_pressed().is_empty() {
            if let Some(toplevel) = self.window.toplevel() {
                toplevel.with_pending_state(|state| {
                    state.states.unset(xdg_toplevel::State::Resizing);
                    state.size = Some(self.last_window_size);
                });
                toplevel.send_pending_configure();
            }
            handle.unset_grab(self, data, event.serial, event.time, true);
        }
    }

    fn axis(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        details: AxisFrame,
    ) {
        handle.axis(data, details);
    }

    fn frame(&mut self, data: &mut SalmonState, handle: &mut PointerInnerHandle<'_, SalmonState>) {
        handle.frame(data);
    }

    // Gesture stubs (Smithay 0.7) — same passthrough policy as MoveSurfaceGrab.
    fn gesture_swipe_begin(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        event: &smithay::input::pointer::GestureSwipeBeginEvent,
    ) { handle.gesture_swipe_begin(data, event); }
    fn gesture_swipe_update(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        event: &smithay::input::pointer::GestureSwipeUpdateEvent,
    ) { handle.gesture_swipe_update(data, event); }
    fn gesture_swipe_end(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        event: &smithay::input::pointer::GestureSwipeEndEvent,
    ) { handle.gesture_swipe_end(data, event); }
    fn gesture_pinch_begin(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        event: &smithay::input::pointer::GesturePinchBeginEvent,
    ) { handle.gesture_pinch_begin(data, event); }
    fn gesture_pinch_update(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        event: &smithay::input::pointer::GesturePinchUpdateEvent,
    ) { handle.gesture_pinch_update(data, event); }
    fn gesture_pinch_end(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        event: &smithay::input::pointer::GesturePinchEndEvent,
    ) { handle.gesture_pinch_end(data, event); }
    fn gesture_hold_begin(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        event: &smithay::input::pointer::GestureHoldBeginEvent,
    ) { handle.gesture_hold_begin(data, event); }
    fn gesture_hold_end(
        &mut self,
        data: &mut SalmonState,
        handle: &mut PointerInnerHandle<'_, SalmonState>,
        event: &smithay::input::pointer::GestureHoldEndEvent,
    ) { handle.gesture_hold_end(data, event); }

    fn start_data(&self) -> &PointerGrabStartData<SalmonState> {
        &self.start_data
    }

    fn unset(&mut self, _data: &mut SalmonState) {}
}

#[allow(dead_code)]
pub fn window_under_pointer(
    space: &Space<Window>,
    pos: Point<f64, Logical>,
) -> Option<(Window, Rectangle<i32, Logical>)> {
    space
        .element_under(pos)
        .map(|(w, loc)| (w.clone(), Rectangle::from_loc_and_size(loc, w.geometry().size)))
}
