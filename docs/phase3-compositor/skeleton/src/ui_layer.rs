// Anchoring the SalmonApp UI (existing Tauri React app) as a Wayland
// layer-shell surface.
//
// The idea: salmon-shell IS the compositor, and at startup it spawns
// `salmon-app` as a privileged Wayland client. Anchor it to all four
// edges of the output with EXCLUSIVE zone so it covers the full screen
// — that's our "desktop shell UI". Real app windows (Chrome, Firefox,
// etc.) get composited above it.
//
// salmon-app needs a small change on its Tauri side to:
//   1. Detect `$SALMON_LAYER_SHELL=1`
//   2. Request a layer-shell surface (Tauri 2.4+ supports this via the
//      `gtk_layer_shell` crate's Wayland equivalent)
//   3. Anchor to TOP|BOTTOM|LEFT|RIGHT with margin 0
//
// We're not implementing layer-shell here yet — wlr-layer-shell-v1 is
// its own protocol implementation that doesn't ship in Smithay by
// default and needs explicit handling. Add when you get to Tier 2 of
// docs/phase3-compositor/wayland-protocols.md.

#[allow(dead_code)]
pub fn salmon_app_env_for_layer_shell() -> &'static [(&'static str, &'static str)] {
    &[
        ("SALMON_LAYER_SHELL", "1"),
        // GDK_BACKEND restricts GTK/Tauri to Wayland — without this
        // it can fall back to X11 via XWayland which doesn't give us
        // layer-shell surfaces.
        ("GDK_BACKEND", "wayland"),
        // Disable client-side decorations. Layer-shell surfaces don't
        // have a "window" in the usual sense.
        ("GTK_CSD", "0"),
    ]
}

// IPC channel: shell → ui_layer. The shell needs to push events like
// "user pressed Super" (open launcher), "workspace switched", "screen
// locked", etc. v0: not implemented. Plan: AF_UNIX socket at
// $XDG_RUNTIME_DIR/salmon-shell.sock, JSON line protocol. The Tauri
// side reads it via std::os::unix::net::UnixStream in a worker thread
// and emits Tauri events to the React side.
