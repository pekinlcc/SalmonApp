// Compositor-intercepted keyboard shortcuts. These are keys the shell
// handles itself (and explicitly does NOT forward to the focused
// client): Super to open launcher, Super+L to lock, Super+1..9 to
// switch workspaces (not implemented), Ctrl+Alt+T to spawn a terminal.
//
// The interception happens in the keyboard's FilterResult callback in
// `crate::input::dispatch` — we hand it a closure that consults this
// module and returns `FilterResult::Intercept(action)` for keys the
// shell owns, `FilterResult::Forward` otherwise.

use smithay::input::keyboard::{FilterResult, Keysym, ModifiersState};

/// Shell-level action triggered by a recognised shortcut.
#[derive(Debug, Clone)]
pub enum ShellAction {
    /// Super by itself (modifier press + release with no other key).
    /// Opens the launcher.
    OpenLauncher,
    /// Super+L → lock screen via xdg-screensaver-style integration.
    Lock,
    /// Spawn a process — e.g. Ctrl+Alt+T → terminal.
    Spawn(String),
    /// Switch the focused workspace (1-indexed). v1 single-workspace
    /// ignores this; v2 multi-workspace consumes it.
    Workspace(u8),
}

/// Inspect a key event and return a ShellAction if the shell owns it.
///
/// Caller is expected to call this from the keyboard input filter:
///
/// ```ignore
/// keyboard.input::<ShellAction, _>(state, code, key_state, serial, time,
///     |state, modifiers, handle| {
///         match crate::handlers::keyboard_shortcuts::classify(modifiers, handle.modified_sym()) {
///             Some(action) => FilterResult::Intercept(action),
///             None => FilterResult::Forward,
///         }
///     });
/// ```
pub fn classify(modifiers: &ModifiersState, keysym: Keysym) -> Option<ShellAction> {
    // Super+L: lock screen.
    if modifiers.logo && keysym == Keysym::l {
        return Some(ShellAction::Lock);
    }
    // Super+1..9: switch workspace.
    if modifiers.logo && (keysym >= Keysym::_1 && keysym <= Keysym::_9) {
        let n = (u32::from(keysym) - u32::from(Keysym::_1) + 1) as u8;
        return Some(ShellAction::Workspace(n));
    }
    // Ctrl+Alt+T: terminal.
    if modifiers.ctrl && modifiers.alt && keysym == Keysym::t {
        return Some(ShellAction::Spawn("foot".to_string()));
    }
    None
}

/// Detect "Super pressed alone" (modifier transition where the user
/// pressed and released Super without any other key in between).
///
/// Implementing this requires the input dispatcher to track:
///   - timestamp of last Super-down
///   - whether any other key was pressed between Super-down and Super-up
///
/// On Super-up, if no other key was pressed since Super-down, emit
/// ShellAction::OpenLauncher. v0 stub — wire in input.rs once you start
/// using the launcher.
pub struct SuperKeyTracker {
    pub super_pressed_at: Option<std::time::Instant>,
    pub other_key_pressed: bool,
}

impl SuperKeyTracker {
    pub fn new() -> Self {
        Self {
            super_pressed_at: None,
            other_key_pressed: false,
        }
    }

    /// Call on every key event. Returns `Some(OpenLauncher)` if the
    /// just-released key was a clean Super-tap.
    pub fn observe(&mut self, key: Keysym, pressed: bool) -> Option<ShellAction> {
        let is_super = matches!(key, Keysym::Super_L | Keysym::Super_R);
        if is_super && pressed {
            self.super_pressed_at = Some(std::time::Instant::now());
            self.other_key_pressed = false;
            return None;
        }
        if is_super && !pressed {
            let pressed_at = self.super_pressed_at.take();
            let other = std::mem::replace(&mut self.other_key_pressed, false);
            if !other {
                if let Some(t) = pressed_at {
                    // Reject super-long presses (> 500ms): the user
                    // might have been holding Super for a different
                    // shortcut that fired earlier.
                    if t.elapsed().as_millis() < 500 {
                        return Some(ShellAction::OpenLauncher);
                    }
                }
            }
            return None;
        }
        if pressed && self.super_pressed_at.is_some() {
            self.other_key_pressed = true;
        }
        None
    }
}

impl Default for SuperKeyTracker {
    fn default() -> Self {
        Self::new()
    }
}

// Returned from the FilterResult callback when nothing should reach
// the client. The dispatcher loop is responsible for executing the
// matching ShellAction (spawn process, lock, etc.).
#[allow(dead_code)]
pub fn _example_filter_result(action: ShellAction) -> FilterResult<ShellAction> {
    FilterResult::Intercept(action)
}
