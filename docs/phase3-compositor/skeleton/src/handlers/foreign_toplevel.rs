// wlr-foreign-toplevel-management-v1: lets external apps (taskbars,
// docks, "what's running" lists) enumerate every toplevel window the
// compositor is managing, and request actions on them (activate,
// minimise, close).
//
// CRITICAL for the SalmonApp Desktop dock: the dock needs to know
// "Chrome is running, here's its title, here's how to focus it".
// Without this protocol, the dock is window-blind.
//
// Smithay has helpers in `smithay::wayland::shell::wlr_foreign_toplevel`
// (exact module path verify in your installed version — protocols
// occasionally relocate between minor versions). The handler trait is
// thin; the heavy lifting is keeping the state in sync with `space`.
//
// Sync points to wire in shell.rs::new_toplevel / window-destroyed:
//   - on new_toplevel: call manager.new_toplevel(window)
//   - on window close: call handle.send_closed()
//   - on title/app_id change: handle.title(...) / handle.app_id(...)
//   - on focus change: handle.state(...) with State::Activated set

use smithay::{
    delegate_foreign_toplevel_list,
    wayland::foreign_toplevel_list::{ForeignToplevelListHandler, ForeignToplevelListState},
};

use crate::state::SalmonState;

impl ForeignToplevelListHandler for SalmonState {
    fn foreign_toplevel_list_state(&mut self) -> &mut ForeignToplevelListState {
        &mut self.foreign_toplevel_list_state
    }
}
delegate_foreign_toplevel_list!(SalmonState);

// TODO(verify): the exact name of the Smithay module differs between
// versions:
//   - 0.5: `smithay::wayland::shell::wlr_foreign_toplevel` (the old wlr-only API)
//   - 0.7: `smithay::wayland::foreign_toplevel_list` (the newer
//     wayland-protocols-stable counterpart)
//
// If your build complains, check `smithay::wayland::*` for the
// foreign-toplevel module and adjust the imports above. The newer
// `foreign_toplevel_list` is preferred — it's the upstream-stable
// version, not the wlroots vendor-specific one. Some toolkits
// (GNOME-based) only speak the newer one.
//
// If you need to also support the older `wlr-foreign-toplevel-management-v1`
// for backwards compatibility (sway-rooted apps): implement a second
// handler in `handlers/wlr_foreign_toplevel.rs` for that protocol.

// Tie-in (called from handlers/shell.rs::new_toplevel — add this call
// once you confirm the API signature):
//
//   data.foreign_toplevel_list_state.new_toplevel(&window);
//
// And from a window-destroy hook (wherever you detect that — typically
// in the Space::cleanup_dead_windows loop on each tick):
//
//   for window in dead_windows {
//       data.foreign_toplevel_list_state.toplevel_destroyed(&window);
//   }
