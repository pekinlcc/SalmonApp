// Skeleton main entrypoint for salmon-shell. This compiles in isolation
// (with Cargo.toml in the same directory) but it does NOT yet support
// xdg-shell, layer-shell, input, or rendering — those are the implementation
// work of Phase 3.
//
// The structure follows Smithay's anvil example (https://github.com/Smithay/smithay/tree/master/anvil)
// which is the canonical reference for new compositors. Read anvil/src/main.rs
// alongside this file when starting.

use anyhow::Result;
use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "salmon-shell")]
#[command(about = "SalmonApp's Wayland compositor and desktop shell")]
struct Args {
    /// Run nested inside the host Wayland session (dev mode). When false,
    /// takes over the TTY via DRM/KMS (production session mode).
    #[arg(long, default_value_t = true)]
    nested: bool,

    /// Path to the salmon-app binary spawned as the desktop UI layer.
    /// In the production install this resolves to /usr/bin/salmon-app.
    #[arg(long, default_value = "salmon-app")]
    ui_binary: String,
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "salmon_shell=debug,smithay=info".into()),
        )
        .init();

    let args = Args::parse();
    tracing::info!(?args, "salmon-shell starting");

    if args.nested {
        run_nested(&args)
    } else {
        run_tty(&args)
    }
}

#[cfg(feature = "nested")]
fn run_nested(args: &Args) -> Result<()> {
    // Smithay's `winit` backend opens a window in the host compositor and
    // makes salmon-shell composite into it. Crashes don't take down your
    // real session — safe to iterate on.
    //
    // Implementation outline:
    //   1. Init calloop event loop.
    //   2. Init smithay backend::winit::init() → returns a winit-backed
    //      OutputDevice and event source.
    //   3. Init compositor state: CompositorHandler, XdgShellHandler,
    //      SeatHandler, ShmHandler, DataDeviceHandler (Tier 1 traits).
    //   4. Insert event sources into calloop:
    //      - Wayland clients
    //      - Winit input + repaint
    //      - Optional: spawn the UI binary as a client (see below).
    //   5. Run loop, dispatching events. Each xdg_toplevel created by a
    //      client becomes a window the shell positions.
    //
    // The minimal working version (just enough to display weston-terminal):
    // ~1500 lines of Rust ported from anvil. Plan 1-2 weeks for the port +
    // initial test.
    //
    // For the UI integration: at startup, spawn `args.ui_binary` with an
    // env var SALMON_LAYER_SHELL=1 — the Tauri side reads this and uses
    // layer-shell instead of xdg-toplevel for its window. The shell then
    // pins it to the bottom layer (full-screen wallpaper-style).
    tracing::info!(ui = %args.ui_binary, "would start nested compositor");
    todo!("nested mode not implemented yet — port from smithay/anvil")
}

#[cfg(not(feature = "nested"))]
fn run_nested(_args: &Args) -> Result<()> {
    anyhow::bail!("built without `nested` feature; rebuild with --features nested")
}

#[cfg(feature = "tty")]
fn run_tty(args: &Args) -> Result<()> {
    // Production session mode: udev + DRM/KMS + libinput. Run via the
    // .desktop session file at /usr/share/wayland-sessions/salmon-shell.desktop.
    //
    // Implementation outline:
    //   1. Smithay backend::udev::init() — enumerates DRM devices.
    //   2. For each device, backend::drm::init() per CRTC → outputs.
    //   3. backend::libinput::init() for input devices, listen for hot-plug
    //      via udev monitor.
    //   4. Render via backend::renderer::glow (GL) or vulkan.
    //   5. Same Wayland handlers as nested mode.
    //
    // Major extras beyond nested:
    //   - VT switching (handle Ctrl+Alt+F1..F7 to swap virtual terminals)
    //   - Cursor rendering (you draw the cursor; in nested mode the host does)
    //   - Display power-management (DPMS off/on)
    //   - logind integration (suspend, lock, session take/release)
    //
    // Plan 4-6 weeks beyond the nested milestone.
    tracing::info!(ui = %args.ui_binary, "would start TTY compositor");
    todo!("TTY mode not implemented yet — port from smithay/anvil")
}

#[cfg(not(feature = "tty"))]
fn run_tty(_args: &Args) -> Result<()> {
    anyhow::bail!("built without `tty` feature; rebuild with --features tty")
}
