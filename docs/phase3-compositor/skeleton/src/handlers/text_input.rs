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
    wayland::{
        input_method::InputMethodManagerState, text_input::TextInputManagerState,
    },
};

use crate::state::SalmonState;

// Both manager types have empty handler traits in current Smithay —
// the actual surface routing happens through the seat / focus system
// which is wired by `TextInputManagerState::new::<Self>(&dh)` and
// `InputMethodManagerState::new::<Self, _>(&dh, |_| true)`.
//
// The `|_| true` filter in InputMethodManagerState::new is the
// "which client may register as an IME?" policy. v0 accepts any
// client; a hardened version would check the client's PID against
// a whitelist (fcitx5 / ibus / nimf binaries).

delegate_text_input_manager!(SalmonState);
delegate_input_method_manager!(SalmonState);

// Helper to make the imports of *State types actually be exercised
// somewhere so unused-import warnings don't fire while these
// modules are still scaffolding.
#[allow(dead_code)]
pub fn _state_types(_: &TextInputManagerState, _: &InputMethodManagerState) {}
