// salmon-shell — entry point.
//
// Dispatches to one of two backends:
//   --nested (default, when compiled with feature `nested`):
//       Runs as a Wayland client of your existing GNOME / KDE / Sway
//       session via Smithay's `winit` backend. Crashes don't take down
//       your real session. Iterate here until stable.
//
//   --tty (when compiled with feature `tty`):
//       Takes over a virtual terminal via udev + DRM/KMS + libinput.
//       Plug into GDM's session list via the .desktop file in
//       ../session/. Don't switch to this as your default session
//       until nested mode runs Chrome + VSCode without crashing.

use anyhow::Result;
use clap::Parser;

mod state;
mod handlers;
mod input;
mod render;
mod ui_layer;

#[cfg(feature = "nested")]
mod nested;
#[cfg(feature = "tty")]
mod tty;

#[derive(Parser, Debug)]
#[command(name = "salmon-shell")]
#[command(about = "SalmonApp's Wayland compositor and desktop shell")]
struct Args {
    /// Force backend even when both features are compiled in.
    /// Default: nested if available, else tty.
    #[arg(long, value_enum)]
    backend: Option<Backend>,

    /// Path to the salmon-app binary to spawn as the desktop UI layer.
    /// On a packaged install this is /usr/bin/salmon-app.
    #[arg(long, default_value = "salmon-app")]
    ui_binary: String,

    /// Skip spawning the UI binary (useful when bringing up the
    /// compositor in isolation; you'll see a black screen with a cursor).
    #[arg(long)]
    no_ui: bool,
}

#[derive(clap::ValueEnum, Debug, Clone, Copy)]
enum Backend {
    Nested,
    Tty,
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

    let backend = args.backend.unwrap_or(default_backend());
    match backend {
        Backend::Nested => {
            #[cfg(feature = "nested")]
            return nested::run(&args);
            #[cfg(not(feature = "nested"))]
            anyhow::bail!("built without `nested` feature; rebuild with --features nested");
        }
        Backend::Tty => {
            #[cfg(feature = "tty")]
            return tty::run(&args);
            #[cfg(not(feature = "tty"))]
            anyhow::bail!("built without `tty` feature; rebuild with --features tty");
        }
    }
}

const fn default_backend() -> Backend {
    #[cfg(feature = "nested")]
    {
        Backend::Nested
    }
    #[cfg(all(not(feature = "nested"), feature = "tty"))]
    {
        Backend::Tty
    }
    #[cfg(all(not(feature = "nested"), not(feature = "tty")))]
    {
        // Compile fails earlier in this case; this branch only exists so
        // the const fn typechecks.
        Backend::Nested
    }
}
