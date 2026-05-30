# Phase 3: SalmonApp as a Wayland Session

This directory holds the **implementation plan + scaffolding** for turning
the in-app DesktopView (shipped in Phase 1, v1.20) into a real Linux
desktop session that replaces GNOME Shell.

**Status**: design only. No code in this directory compiles into the
production app — it's a starter kit for whoever picks up Phase 3.

## tl;dr — what Phase 3 ships

A user runs:

```
sudo apt install salmon-desktop
```

…then logs out, picks **"SalmonApp Desktop"** from the GDM session
chooser (the gear icon next to the password field), logs back in, and
the GNOME Shell never starts. Instead the screen is owned by
`salmon-shell` — a Rust binary that:

- Acts as a Wayland compositor (renders the screen, manages windows,
  handles input)
- Hosts the Phase 1 desktop UI (wallpaper + Brief widget + dock + launcher)
  as its own layer
- Lets the user run any normal Linux app (Chrome, VSCode, etc.) as
  Wayland clients in resizable windows

To switch back: log out, gear → "Ubuntu", log in. The mechanism is
already standard; the cost is in making `salmon-shell` good enough to
daily-drive.

## Cost reality check

A maintainable, daily-usable compositor is a **multi-engineer-year**
project for a small team. Reference points:

- **Cosmic Desktop** (System76, Rust + Smithay) — 2022 inception, only
  hit Alpha 1 in 2025. Two full-time Rust engineers.
- **River** (Zig, much smaller scope, no widgets, just tiling) — 2 years
  before stable.
- **Sway** (C, i3-compatible WM, started 2015) — 10 years of bug fixes
  and still receives breakage reports per Wayland version.

Don't start Phase 3 expecting it to ship in months. The Phase 1 in-app
prototype gives the user 80% of the *feel* in a session window; Phase
3 buys the last 20% (actually owning the screen) at >10× the cost.

## How a Wayland compositor works (one-page primer)

A Linux GUI session is three layers:

1. **DRM/KMS + libinput** (kernel) — gives you a framebuffer and raw
   input events.
2. **Compositor** (userspace) — reads input, decides what's on screen,
   composites it. Speaks the Wayland protocol to clients.
3. **Wayland clients** (every GUI app) — Chrome, VSCode, GIMP, Firefox.
   They request buffers from the compositor and ask it to show them.

GNOME Shell, KDE Plasma, Cosmic, Sway — all four are compositors.
Phase 3 is replacing layer 2 with `salmon-shell`. Layers 1 and 3
keep working as-is.

Smithay (`smithay = "0.7"`) is the Rust crate that handles the low-level
DRM/KMS + Wayland protocol bookkeeping. You still write a lot of code
on top of it — see `skeleton/src/main.rs` for the minimal scaffold.

## File map of this directory

```
docs/phase3-compositor/
├── README.md                       ← you are here
├── wayland-protocols.md            ← protocol-by-protocol implementation checklist
├── session/
│   └── salmon-shell.desktop        ← the file GDM reads to expose the session
├── skeleton/
│   ├── Cargo.toml                  ← starter dependencies + features
│   └── src/main.rs                 ← minimal Smithay compositor that boots
└── packaging/
    └── debian.md                   ← how to assemble the .deb that installs everything
```

## Suggested execution order

1. **Get the skeleton booting in a nested mode** (Smithay's `winit`
   backend → compositor renders inside a normal Wayland window inside
   your real GNOME session, no risk to your machine). 1-2 weeks.
2. **Implement xdg-shell + basic input** — enough to run weston-terminal
   in the nested compositor. 2-3 weeks.
3. **Embed the Phase 1 React UI** — easiest path is to spawn the existing
   Tauri `salmon-shell` window as a privileged Wayland client and
   anchor it as a layer-shell surface (see `wayland-protocols.md`).
   Alternative: rewrite the UI as a native Rust GUI using iced or
   slint — better long-term but throws away Phase 1 work. **Pick the
   embed path for v1.** 2 weeks.
4. **Cross-cutting protocols** — `text-input-v3` (IME), `screencopy`
   (screenshots), `output-management` (multi-monitor), `xdg-decoration`,
   `wlr-layer-shell`, `wlr-foreign-toplevel-management` (the dock needs
   this to show "running apps"). 6-10 weeks each, mostly testing.
5. **Run in TTY mode** — switch from the `winit` backend to `udev` (real
   DRM/KMS). Now you can boot into it as a session. **Don't make this
   your daily driver yet** — keep GNOME alongside, switch via GDM gear.
   2-3 weeks once steps 1-4 are stable.
6. **Session integration** — install `session/salmon-shell.desktop`,
   write the `systemd --user` units that start what GNOME's session
   normally starts (PipeWire, NetworkManager applet, polkit agent,
   screensaver). 4-6 weeks.
7. **Packaging** — `.deb`, then `.snap`, then maybe Flatpak. See
   `packaging/debian.md`. 2-3 weeks.

Total: **6-12 months solo full-time**, with a working compositor at
the end. Plan accordingly.

## Repository structure when Phase 3 starts

Today (v1.20):

```
salmon/                          ← single Tauri app, Phase 1 desktop view inside it
├── src/
├── src-tauri/
└── package.json
```

When Phase 3 starts, refactor to a Cargo workspace:

```
crates/
├── salmon-core/                 ← DB, sync, AI, mail/cal/tasks logic
│                                  (most of salmon/src-tauri/src/ moves here)
├── salmon-shell/                ← NEW. Wayland compositor + Phase 1 UI.
│                                  Started from this skeleton/ directory.
├── salmon-app/                  ← The Tauri app as it exists today. Stays
│                                  the default for macOS / Windows users and
│                                  for Linux users who keep desktop_mode=false.
├── salmon-mail/                 ← Phase 2: separate Tauri window for Mail
├── salmon-calendar/             ← Phase 2: ditto
└── salmon-tasks/                ← Phase 2: ditto
```

`salmon-core` is the only crate any of the others depend on. The shell
lives entirely standalone — it can be installed as a system package
without dragging in the whole Tauri stack if a Linux distro maintainer
ever wants a clean separation.

## What ships from Phase 1 that you can reuse

The Phase 1 UI lives at `salmon/src/components/desktop/` (Wallpaper,
DesktopTopBar, BriefWidget, Dock, Launcher). The CSS at the end of
`salmon/src/styles.css` (`.dt-*` classes) is portable. If Phase 3 keeps
embedding the React UI (option 1 in step 3 above), all of this comes
along free.

If Phase 3 rewrites in native Rust, treat the Phase 1 files as the
**visual reference spec** — colour, layout, animation timings.
