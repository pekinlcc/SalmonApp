// TTY backend: production session mode. Reads input via libinput,
// renders via DRM/KMS. This is what GDM launches when the user picks
// "SalmonApp Desktop" from the session menu.
//
// v0: stub only. Once nested.rs is stable on your machine and you can
// run a few apps in it without crashing, port this from anvil's
// udev.rs (which is ~2000 lines including hotplug handling).
//
// Until then: build with --features nested only and don't install the
// .desktop session file in production.

#![cfg(feature = "tty")]

use anyhow::Result;

pub fn run(_args: &crate::Args) -> Result<()> {
    // Real implementation outline:
    //   1. Open libseat session — `smithay::backend::session::libseat`
    //      gives you a Session struct that manages /dev/tty
    //      switching + privilege drop.
    //   2. Enumerate DRM devices via udev (Smithay's
    //      backend::udev::UdevBackend).
    //   3. For each DRM device, open it and create a DrmDevice +
    //      DrmCompositor per CRTC/output.
    //   4. Open libinput via the seat → InputBackend stream.
    //   5. Hook all of those into calloop.
    //   6. From there the dispatch loop is identical to nested.rs:
    //      handle wayland clients + render space + send frames.
    //
    // Watch out for:
    //   - VT switching (ctrl+alt+F1..F7): session.change_vt()
    //   - DRM device hotplug: udev monitor source
    //   - Render-loss → re-create renderer (happens on suspend/resume)
    //   - Cursor: nested mode borrows the host cursor; TTY mode you
    //     draw it yourself via a hardware cursor plane.
    //
    // Reference: smithay/anvil/src/udev.rs

    anyhow::bail!("TTY backend not implemented yet — see comments in src/tty.rs and port from anvil/src/udev.rs")
}
