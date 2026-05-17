# Session Handoff — 2026-05-17

Snapshot of where Linux Desktop work stands at the end of this remote
Claude Code session. The user (pekinlcc) is now home and switching to
local Claude Code with real `cargo` / `npm` / `tauri` available; this
doc gives that next instance enough context to continue without
re-asking the user for any background.

---

## Background — what we're building

SalmonApp is an AI-first mail / workspace suite (Mail, Calendar, Tasks,
Contacts, Topics, briefings). It runs as a Tauri desktop app on macOS
and Linux.

The user wants a **Linux-specific desktop experience** that progresses
through three phases:

1. **Phase 1** — in-app desktop view: `SalmonApp` on Linux launches
   straight into a GNOME-style screen (wallpaper + AI Brief widget +
   dock + launcher) instead of the regular WelcomeBack home. Still a
   normal Tauri window. **Shipped in v1.20.0 → v1.20.2.**
2. **Phase 2** — three independent products from one repo:
   - **SalmonApp (App)**: Mac dmg + Linux deb/AppImage/rpm. WelcomeBack
     home, no desktop view code.
   - **SalmonApp Desktop**: Linux deb/AppImage/rpm only. DesktopView
     home, no WelcomeBack code.
   - Shared backend (DB, mail/cal/tasks, AI plumbing) in a Cargo
     workspace member both binaries depend on.
3. **Phase 3** — `SalmonApp Desktop` becomes a real Wayland
   compositor that replaces GNOME Shell. Installed via a `.deb` that
   drops a `/usr/share/wayland-sessions/salmon-shell.desktop` file
   so GDM exposes it as a login option. The user switches via the
   GDM gear icon next to their password.

Reality check on costs is in `docs/refactor-three-products/README.md`
and `docs/phase3-compositor/README.md` — Phase 3 alone is genuinely 6-12
months of full-time Wayland-compositor work.

## Current repo state on `main`

```
.
├── Cargo.toml                                ← v2.0 workspace root
├── salmon/                                   ← v1.x SalmonApp (Mac + Linux App)
│   ├── package.json
│   ├── src/                                  ← React frontend
│   ├── src-tauri/                            ← Rust backend; workspace member
│   └── …
├── crates/
│   └── salmon-desktop/                       ← v2.0 Phase 2b: second binary
│       ├── package.json                      ← duplicates salmon/ today
│       ├── src/                              ← duplicate React
│       └── src-tauri/                        ← duplicate Rust; workspace member
├── docs/
│   ├── refactor-three-products/README.md     ← v2.0 Phase 2 plan (355 lines)
│   └── phase3-compositor/                    ← v2.0 Phase 3 plan + skeleton
│       ├── README.md
│       ├── wayland-protocols.md              ← protocol checklist
│       ├── session/salmon-shell.desktop      ← GDM session file template
│       ├── packaging/debian.md
│       └── skeleton/                         ← ~3000 lines of compositor code
│           ├── Cargo.toml
│           ├── README.md
│           └── src/{main,state,nested,tty,input,render,ui_layer}.rs
│           └── src/handlers/                 ← 12 protocol handlers
└── .github/workflows/
    ├── release.yml                           ← v* tags → SalmonApp App
    └── release-desktop.yml                   ← desktop-v* tags → SalmonApp Desktop
```

## Per-phase status

### Phase 1 — ✅ Shipped

| Release | Content |
|---|---|
| v1.20.0 | DesktopView (wallpaper + Brief widget with real data + Dock + Launcher) + Settings toggle + Phase 3 docs |
| v1.20.1 | 4 wallpaper variants + Super-key shortcuts + dock activity dots |
| v1.20.2 | Hide desktop toggle on Mac/Win (was misleading); honest label on Linux |

Releases at https://github.com/pekinlcc/SalmonApp/releases — Mac
universal dmg + Linux deb/AppImage/rpm for each.

### Phase 2 — partial

| Sub-phase | What | Status |
|---|---|---|
| 2a | Cargo workspace skeleton at repo root | **Merged to main.** CI-validated via desktop-v2.0.0-rc1. |
| 2b | `crates/salmon-desktop/` second binary | **Merged to main.** CI-validated via desktop-v2.0.0-rc2. Two binaries (App + Desktop) build independently. Massive code duplication intentional and temporary. |
| 2c stage 1 | Extract `types.rs` → `crates/salmon-core/src/types.rs` | **CI-validated** via desktop-v2.0.0-rc3. NOT merged to main. Lives on branch `claude/v2.0.0-phase2c-extract-salmon-core` at commit `db52b97`. |
| 2c stage 2 | Extract `path_dirs.rs` + `platform.rs` → salmon-core | **BROKEN** — fails to compile in ~5 min. Branch HEAD `a162a6f9` has a partial fix (lib.rs bare-module-ref repair) but it's still failing. See "What's broken right now" below. |
| 2c stage 3+ | Extract `db.rs`, then `engine.rs`, then `mail`/`calendar`/`tasks` subsystems | NOT started. Blocked on stage 2 being fixed. |
| 2d | Split React frontend across `frontends/{shared,app,desktop}/` | NOT started. |
| 2e | Final CI cleanup, delete legacy `salmon/` path | NOT started. |

### Phase 3 — skeleton on main

Comprehensive starter for the Wayland compositor at
`docs/phase3-compositor/skeleton/`. ~3000 lines across ~22 files.
Never compile-tested in the remote sandbox. Expect API drift errors
on first `cargo build`. See `docs/phase3-compositor/skeleton/README.md`
for build + troubleshoot steps.

Tier 1 protocols implemented (real, not stub):
- wl_compositor, xdg_shell (with real Move + Resize PointerGrab),
  wl_shm, wl_seat, wl_data_device, wl_output.

Tier 2 protocols implemented:
- wlr-layer-shell-v1 (used by salmon-app for the desktop UI anchor)
- xdg-decoration-v1 (GTK / Qt apps need this)
- text-input-v3 + input-method-v2 (Chinese IME via fcitx5)
- wlr-foreign-toplevel-list (dock needs this to see running apps)
- linux-dmabuf-v1 (Chrome / Firefox GPU buffers — handler scaffold)
- fractional-scale-v1 + viewporter (HiDPI)
- wlr-screencopy-v1 (screenshots, Zoom share — constraints set, frame
  body still TODO)
- XWayland bootstrap (feature-gated; XwmHandler stubs only)
- Super-key tracker + shortcut classifier

Tier 2 still missing: wlr-output-management-v1, presentation-time,
wlr-gamma-control-v1, tablet-v2, pointer-constraints.

The TTY backend (`src/tty.rs`) is a stub. Use the nested backend
(`--features nested`) for all initial bring-up — it runs as a
Wayland client inside the user's existing GNOME session and can't
brick their machine on crash.

## What's broken right now

`claude/v2.0.0-phase2c-extract-salmon-core` branch fails CI.

Symptom: every CI run (rc4, rc5, rc6) completes in ~5m24s — fast
enough to be a compile failure before tauri-action's release-publish
step. No release is created on GitHub for those tags.

What I tried:
- Stage 1 (types only) passed CI as desktop-v2.0.0-rc3. So types
  extraction works.
- Stage 2 (path_dirs + platform) fails. First theory: bare module refs
  in `lib.rs` (lines 68 + 239) which the bulk sed didn't catch because
  they didn't use a `crate::` prefix. Fixed those in commit a162a6f9,
  pushed as rc6 — still failed.
- I exhaustively grep'd for any other bare `path_dirs::`, `platform::`,
  `super::path_dirs`, `use crate::{...path_dirs...}` patterns — none
  found.

The remote sandbox can't run `cargo build`, so I'm out of remote
debug surface. Local Claude Code should:

1. `git fetch origin && git checkout claude/v2.0.0-phase2c-extract-salmon-core`
2. `cd salmon/src-tauri && cargo build 2>&1 | head -100`
3. The first compile error will tell us exactly what's broken. Paste
   the error and I'll patch — probably a single import or a missed
   call site in some module I didn't grep.

## Pickup tasks, in order

### 1. Fix Phase 2c stage 2 (highest priority)

Run the cargo build above. Fix whatever error appears. Push to the
same branch. Re-trigger CI by creating a new
`release-trigger/desktop-v2.0.0-rc7` branch from it. If CI passes,
merge `claude/v2.0.0-phase2c-extract-salmon-core` to main.

### 2. Continue Phase 2c stages 3+

Per the plan in `docs/refactor-three-products/README.md`:
- stage 3: extract `db.rs` (large, ~15 files depend on it)
- stage 4-N: mail subsystem, calendar subsystem, tasks subsystem,
  briefing subsystem — one stage per subsystem
- After each stage, push, re-trigger CI via the release-trigger trick,
  verify before continuing.

Crucial lesson from stage 2: **before each sed, also grep for BARE
module references** (e.g. `db::` not `crate::db::`) which appear in
`lib.rs` since modules declared with `mod X;` are sibling-accessible
without a prefix. The fix is to replace those bare refs with
`salmon_core::db::` etc.

### 3. Phase 3 first compile

`cd docs/phase3-compositor/skeleton && cargo build --features nested`
will likely emit 5-20 Smithay API drift errors. Pick them off
one-by-one. The reference for ANY signature confusion is anvil:
https://github.com/Smithay/smithay/tree/master/anvil/src

After it compiles:
```
RUST_LOG=salmon_shell=debug cargo run --features nested -- --no-ui
```
should open a nested compositor window. From another shell:
```
ls "$XDG_RUNTIME_DIR"/wayland-*
# pick the new one, e.g. wayland-2
WAYLAND_DISPLAY=wayland-2 weston-terminal
```
If a terminal appears INSIDE the nested compositor's window, Phase 3
hello-world works.

### 4. Phase 2d (split React frontend)

Only after Phase 2c is complete. Set up npm workspaces, factor
shared components into `frontends/shared/`, give App and Desktop
their own slim entry points. Plan in
`docs/refactor-three-products/README.md` Phase 2d section.

## Branches to know about

- `main` — production. Has Phase 1 + Phase 2a/2b + Phase 3 skeleton.
- `claude/v2.0.0-phase2c-extract-salmon-core` — Phase 2c stages 1+2.
  Stage 1 works, stage 2 broken. **Resume here for Phase 2c work.**

Branches safe to delete after this handoff:
- `claude/desktop-polish-v1.20.1`, `claude/ubuntu-desktop-shell`,
  `claude/v1.20.2-mac-hide-desktop`, `claude/v2.0.0-workspace-refactor`,
  `claude/rec-payoff-field`, `claude/topic-order-bump`,
  `claude/topic-bypass-toggle`, `claude/notifications-overhaul`,
  `claude/recs-fresh-snapshot`, `claude/bypass-toggle-actually-applies`,
  `claude/improve-recommendations-1VXoO`, `claude/release-v0.5.3`,
  `claude/release-v0.5.4`, `claude/v2.0.0-phase2b-desktop-crate`,
  `claude/phase3-compositor-skeleton`, `claude/phase3-skeleton-expand`,
  `claude/phase3-deeper`, `claude/phase3-tier2-more`,
  `claude/session-handoff-2026-05-17` (this one, after the doc merges).
- All `release-trigger/*` branches (single-use CI triggers).
- `v0.5.3` (stray ref accidentally created during an early tag-push
  attempt).

The user's local terminal can delete in bulk:
```bash
for b in $(git branch -r | grep 'origin/claude/\|origin/release-trigger/' \
                 | grep -v 'phase2c' | sed 's|origin/||'); do
  git push origin --delete "$b"
done
```

## CI / release machinery

The unusual setup: the sandbox can't push git tags (proxy 403). To
trigger a release I push a `release-trigger/v*` or
`release-trigger/desktop-v*` branch instead. Both workflows have a
matching branch trigger that extracts the tag name from the branch.
tauri-action then creates the real tag + release.

You can ignore this when working locally — just push tags normally:
```bash
git tag v1.21.0 && git push origin v1.21.0      # SalmonApp App
git tag desktop-v2.0.0 && git push origin desktop-v2.0.0  # SalmonApp Desktop
```

## Open question for the user

After Phase 2c is fully done, do you want Phase 3 (the actual Wayland
compositor) to be your next focus, or Phase 2d (React frontend split)?
Phase 2d gives the App / Desktop binaries truly different bundles and
unblocks the "remove desktop view from the App binary" cleanup. Phase 3
is bigger / more interesting / multi-month.

There's no rush on this question — Phase 2c is enough to be working
on for now.
