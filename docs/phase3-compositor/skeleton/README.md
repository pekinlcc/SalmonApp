# Phase 3 Compositor Skeleton

A starting point for `salmon-shell`, the Wayland compositor that
SalmonApp Desktop will eventually become. ~1500 lines of Rust across
~10 files, modeled after [Smithay's anvil reference
compositor](https://github.com/Smithay/smithay/tree/master/anvil).

**Honest status**: this code was written without ability to
compile-test. Treat the first `cargo build` as the start of an API
fix-up pass, not an expected pass. Smithay 0.7's API has enough
generic trait bounds that a few imports / signatures are likely
wrong — they'll surface as `cargo build` errors that mostly read
"expected X, found Y in delegate_compositor! macro" or "method
not found". When that happens:

1. Don't fight it alone — paste the first 5 errors into a Claude
   Code session and we'll patch.
2. The reference truth is always `anvil/`. Open
   <https://github.com/Smithay/smithay/tree/master/anvil/src> in
   another tab and compare signatures line-by-line.
3. Pin Smithay to the exact version anvil is on
   (`cargo tree -p smithay` in this directory).

## What's here

| File | Purpose | Completeness |
|---|---|---|
| `Cargo.toml` | Deps, features (`nested` / `tty`) | Real, should compile |
| `src/main.rs` | CLI + backend dispatch | Real |
| `src/state.rs` | `SalmonState` central struct | Real, anvil-style |
| `src/handlers.rs` | Compositor / Shell / Shm / Seat / DataDevice / Output | Tier-1 protocols, real impls |
| `src/input.rs` | Routes backend InputEvent → seat methods | Keyboard + pointer working; touch/tablet TODO |
| `src/nested.rs` | winit-backend bootstrap | **Most likely to actually run.** Build with `--features nested` |
| `src/tty.rs` | udev/DRM bootstrap | **Stub only.** Anvil's `udev.rs` is ~2000 lines; port that |
| `src/ui_layer.rs` | How to anchor salmon-app as layer-shell surface | Plan + env-var contract only; layer-shell protocol not implemented |
| `src/render.rs` | Shared rendering helpers | Empty shim |

## Build

```bash
cd docs/phase3-compositor/skeleton

# System deps for Wayland + GL (Ubuntu):
sudo apt install -y libwayland-dev libudev-dev libinput-dev \
    libgbm-dev libdrm-dev libxkbcommon-dev libseat-dev \
    libegl1-mesa-dev libgles2-mesa-dev pkg-config

cargo build --features nested
```

Expect the first `cargo build` to emit ~5-15 errors. That's normal —
the macros expand to a lot of code and Smithay's generics catch
small mismatches loudly. **Pasting the first error into a Claude
Code session is almost always faster than reading the macro
expansion** — most of these are "trait `X` for `SalmonState` needs
method `y` with signature `Z`" which is a quick lookup in anvil.

## Run (nested mode)

After it compiles:

```bash
# Inside your existing GNOME / KDE / Sway session.
RUST_LOG=salmon_shell=debug cargo run --features nested -- --no-ui
```

You should see a host-side window pop open showing a dark navy
background. That's salmon-shell as a compositor with zero clients.
It's headless — no UI layer, no apps. To validate it actually
accepts clients, in another terminal:

```bash
# Find the socket name we bound:
ls "$XDG_RUNTIME_DIR"/wayland-*

# Tell weston-terminal to use our socket:
WAYLAND_DISPLAY=wayland-N weston-terminal
```

If a terminal window appears inside the nested compositor's window,
you've got working xdg-shell + wl_shm + wl_seat. That's the Phase 3
"hello world" milestone. From here it's a long road to daily-driver
quality but the foundation works.

## What's NOT here (don't expect)

- `xwayland` — Smithay supports it (the dep is enabled) but
  bringing up XwaylandServer + handling X11 windows is its own
  ~500-line file.
- `layer-shell` — needed for the desktop UI integration. Implement
  via `smithay::wayland::shell::wlr_layer`.
- Real cursor rendering — nested mode borrows the host cursor;
  TTY mode you draw it via a hardware cursor plane.
- HiDPI / fractional scaling — the per-output scale code in anvil
  is a good port target.
- Multi-monitor — `Space::map_output` supports it but you need a
  Smithay-side `wlr-output-management` impl for runtime config.
- IME — `text-input-v3` + `input-method-v2`. Required for Chinese
  input.

Each of these is its own multi-week project. See
`../wayland-protocols.md` for the full checklist.

## Pulling in to the workspace

When this skeleton actually compiles and you're ready to make
salmon-shell a real workspace member:

```bash
# Move (don't copy):
git mv docs/phase3-compositor/skeleton crates/salmon-shell
# Update /Cargo.toml workspace members:
#   - "crates/salmon-shell"
# Update docs/refactor-three-products/README.md to mark this as the
#   "Phase 3" crate alongside salmon-app and salmon-desktop.
```
