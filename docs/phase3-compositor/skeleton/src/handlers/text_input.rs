// text-input-v3 + input-method-v2: IME support.
//
// CRITICAL for Chinese / Japanese / Korean input. Without these,
// fcitx5 / ibus / nimf can't talk to client surfaces and the user
// can't type CJK characters. Anvil doesn't implement these by
// default — they're considered an "advanced" protocol but on a
// desktop targeting Chinese users they're absolutely required.
//
// Smithay 0.7 exposes both via `smithay::wayland::text_input` and
// `smithay::wayland::input_method`. The handler traits are thin —
// most logic is in the IME daemon (fcitx5-wayland), which connects
// as a client and registers itself.
//
// v0: empty handler impls that route events to whichever IME is
// connected. This is enough for fcitx5 to come up. Tuning the focus
// transitions (so the right input field gets the right candidates)
// is iterative work that needs real testing.

use smithay::{
    delegate_input_method_manager, delegate_text_input_manager,
    reexports::wayland_server::protocol::wl_surface::WlSurface,
    utils::{Logical, Rectangle},
    wayland::{
        input_method::{InputMethodHandler, InputMethodManagerState, PopupSurface as IMPopupSurface},
        text_input::TextInputManagerState,
    },
};

use crate::state::SalmonState;

// Smithay 0.7 requires `InputMethodHandler` impl for the delegate macro
// to compile. v0 stubs: accept popup creation, dismissal, and report
// the focused surface's geometry so the IME daemon can anchor its
// candidate window correctly. Enough for fcitx5 to come up; tuning
// focus transitions (so the right input field gets the right
// candidates) is iterative work that needs real testing.
impl InputMethodHandler for SalmonState {
    fn new_popup(&mut self, _surface: IMPopupSurface) {
        // v0: accept the popup but don't draw-track it yet. Once a
        // text-input field is focused we'll know where to anchor.
    }

    fn dismiss_popup(&mut self, _surface: IMPopupSurface) {
        // v0: nothing to clean up since new_popup didn't track.
    }

    fn popup_repositioned(&mut self, _surface: IMPopupSurface) {
        // v0: relayout would happen here.
    }

    fn parent_geometry(&self, _parent: &WlSurface) -> Rectangle<i32, Logical> {
        // Should return the bounding box of the focused text-input
        // surface so the IME positions candidates correctly. v0
        // returns a zero rect — fcitx5 will anchor at (0,0) until we
        // track focused-input geometry. Not blocking for hello-world.
        Rectangle::from_loc_and_size((0, 0), (0, 0))
    }
}

delegate_text_input_manager!(SalmonState);
delegate_input_method_manager!(SalmonState);

// Helper to make the imports of *State types actually be exercised
// somewhere so unused-import warnings don't fire while these
// modules are still scaffolding.
#[allow(dead_code)]
pub fn _state_types(_: &TextInputManagerState, _: &InputMethodManagerState) {}
