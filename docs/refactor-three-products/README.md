# Refactor: Three Products from One Repo

**Goal**: Split the current monolithic SalmonApp Tauri project into three
distinct shippable products that share code through a Cargo workspace
and a small JS monorepo.

**Status**: planning document + Phase 2a starter on the
`claude/v2.0.0-workspace-refactor` branch. Not yet merged.

**Why this exists**: today's `salmon/` directory builds a single binary
that ships everywhere. The Settings toggle lets a Mac user "enable"
Ubuntu Desktop mode — which can't possibly replace Finder. The toggle
is misleading because the product boundary lives at runtime instead of
at the binary boundary.

## Target products

| Product | Binary | Built for | Contains |
|---|---|---|---|
| **SalmonApp** (App) | `salmonapp` | macOS dmg + Linux deb/AppImage/rpm | WelcomeBack home, Mail, Calendar, Tasks, Contacts, Topic. **No DesktopView.** |
| **SalmonApp Desktop** (Linux only) | `salmonapp-desktop` | Linux deb/AppImage/rpm | DesktopView wallpaper / Brief widget / Dock / Launcher as the home. Mail / Calendar / Tasks reached via dock buttons that swap the rendered view. **No WelcomeBack.** |

A user on Linux who wants both can install both; they're separate apps
with separate `.desktop` entries.

## Why Cargo workspace, not feature flags

Build-time feature flags would be cheaper:

```toml
[features]
default = []
desktop = []  # gates DesktopView
```

…and one `cfg!(feature = "desktop")` check in `App.tsx` (via Vite's
`define`). Mac CI builds without the feature, desktop CI builds with.

Two reasons we're going with workspace instead:

1. **Frontend duplication risk**: The DesktopView already pulls real
   data from Mail / Calendar / Tasks API calls. Without separate
   compilation, all the data plumbing also lives in the App binary,
   exposed to Settings/Dev. Workspace lets us put the desktop's data
   layer in `crates/salmon-desktop/` and remove it from the App's
   build entirely.
2. **Release independence**: workspaces give us separate `Cargo.toml`
   versions and separate release tags (`app-v2.0.0`,
   `desktop-v2.0.0`). Otherwise both products are forced to bump
   together every release, even when only one changed.

## Final structure (target)

```
.
├── Cargo.toml                          ← workspace root, lists members
├── package.json                        ← npm workspace root
├── crates/
│   ├── salmon-core/                    ← shared Rust: DB, sync, mail/cal/tasks,
│   │                                      AI plumbing, engine, types
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs                  ← pub mod db, types, mail, calendar, …
│   │       ├── db.rs                   (moved from salmon/src-tauri/src/db.rs)
│   │       ├── types.rs                (moved from salmon/src-tauri/src/types.rs)
│   │       ├── engine.rs               (moved)
│   │       ├── mail/…                  (moved)
│   │       ├── calendar/…              (moved)
│   │       └── tasks/…                 (moved)
│   │
│   ├── salmon-app/                     ← App binary
│   │   ├── Cargo.toml                  ← depends on salmon-core
│   │   ├── tauri.conf.json
│   │   ├── icons/
│   │   ├── capabilities/
│   │   └── src/
│   │       ├── main.rs
│   │       ├── lib.rs                  ← Tauri setup, command registrations
│   │       └── commands.rs             ← Tauri commands specific to the App
│   │                                      (most of today's commands.rs)
│   │
│   └── salmon-desktop/                 ← Desktop binary (Linux only)
│       ├── Cargo.toml                  ← depends on salmon-core
│       ├── tauri.conf.json             ← productName = "SalmonApp Desktop"
│       ├── icons/                      ← different icon
│       ├── capabilities/
│       └── src/
│           ├── main.rs
│           ├── lib.rs
│           └── commands.rs             ← desktop-specific Tauri commands
│                                          (wallpaper persistence etc.)
│
├── frontends/
│   ├── shared/                         ← React code both apps use
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── lib/
│   │   │   │   ├── api.ts              ← shared API wrappers
│   │   │   │   ├── types.ts            ← shared TS types (mirrors salmon-core)
│   │   │   │   ├── platform.ts
│   │   │   │   ├── notify.ts
│   │   │   │   └── useDesktopBrief.ts  (used by desktop only — see "splitting" note)
│   │   │   └── components/             ← MailView, CalendarView, TasksView,
│   │   │                                  ContactsView, ChatStream, Composer,
│   │   │                                  Toasts, Onboarding, SettingsDialog (subset)
│   │   └── tsconfig.json
│   │
│   ├── app/                            ← App-only React code
│   │   ├── package.json
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx                 ← stripped of DesktopView import / desktop branch
│   │   │   └── components/
│   │   │       ├── WelcomeBack.tsx     ← App's home
│   │   │       ├── IconRail.tsx
│   │   │       └── LeftSidebar.tsx
│   │   └── tsconfig.json
│   │
│   └── desktop/                        ← Desktop-only React code
│       ├── package.json
│       ├── index.html
│       ├── vite.config.ts
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx                 ← much simpler, always renders DesktopView
│       │   └── components/
│       │       ├── DesktopView.tsx
│       │       ├── BriefWidget.tsx
│       │       ├── DesktopTopBar.tsx
│       │       ├── Dock.tsx
│       │       ├── Wallpaper.tsx
│       │       └── Launcher.tsx
│       └── tsconfig.json
│
└── .github/workflows/
    ├── release-app.yml                 ← builds salmon-app for Mac + Linux
    ├── release-desktop.yml             ← builds salmon-desktop for Linux only
    └── ci.yml                          ← fmt + clippy + tsc check on PR
```

**Naming clarification**: today's `salmon/` directory contains both Rust
(`salmon/src-tauri/`) and JS (`salmon/src/`, `salmon/package.json`,
`salmon/vite.config.ts`). The target structure separates these by
language at the top: Rust under `crates/`, JS under `frontends/`. Tauri
configs (which bridge them) live with the Rust side because the binary
ID belongs to a specific binary product.

## Migration phases

Each phase is a separate PR. Each is testable on its own. Don't
skip ahead.

### Phase 2a — Workspace skeleton

**What changes**: add `/Cargo.toml` at the repo root declaring a
workspace with `salmon/src-tauri` as the sole member.

**File diff**:
- ADD `/Cargo.toml` (new, ~10 lines)
- UPDATE `/.gitignore` to ignore `/target/` at root (Cargo's shared
  target dir relocates when a workspace appears)
- UPDATE `.github/workflows/release.yml` `Swatinem/rust-cache`
  `workspaces` setting from `salmon/src-tauri` to `.` (workspace root)
- UPDATE `.github/workflows/release.yml` `tauri-action` `projectPath`
  stays `salmon` (the JS side hasn't moved) BUT `tauriScript` may
  need explicit pointer if it gets confused

**Verify**:
```
cargo metadata --format-version 1 | jq .workspace_members
# expect: ["salmonapp 1.20.2 (path+file:///…/salmon/src-tauri)"]

cd salmon
npm run tauri:dev
# expect: app launches as before
```

**Risk**: low. Pure additive at root.

### Phase 2b — Add salmon-desktop crate as a duplicate

**Goal**: prove we can build two binaries from the same workspace.

**What changes**:
- ADD `crates/salmon-desktop/` as a copy of `salmon/src-tauri/`,
  rename Cargo package to `salmonapp-desktop`, change
  `tauri.conf.json` `productName` and `identifier`.
- UPDATE root `Cargo.toml` to list both members.
- ADD a separate `.github/workflows/release-desktop.yml` that builds
  the new crate.
- KEEP existing `release.yml` for the App.

After this phase: two CI pipelines build two binaries from the same
React code. Massive duplication remains (both binaries ship
DesktopView code), but the build separation works.

**Verify**:
```
cargo build -p salmonapp
cargo build -p salmonapp-desktop
# both succeed; two different binaries land in target/debug/
```

**Risk**: medium. Duplicate `commands.rs` paths may shadow each other
if not careful with `Cargo.toml` `[[bin]]` `path` entries.

### Phase 2c — Extract salmon-core

**What changes**: move shared Rust modules (db, types, engine, mail,
calendar, tasks, briefing, AI) into a new `crates/salmon-core/`
library crate. Both app and desktop depend on it.

**Files to move** (today → salmon-core):
- `salmon/src-tauri/src/db.rs`
- `salmon/src-tauri/src/types.rs`
- `salmon/src-tauri/src/engine.rs`
- `salmon/src-tauri/src/mail*.rs` (whatever exists)
- `salmon/src-tauri/src/calendar*.rs`
- `salmon/src-tauri/src/tasks*.rs`
- `salmon/src-tauri/src/briefing*.rs`
- `salmon/src-tauri/src/permission_bridge.rs`
- `salmon/src-tauri/src/platform.rs` (the Rust one if it exists)

**Files to keep in the binary crate**:
- `main.rs` (entry point)
- `lib.rs` (Tauri setup, `tauri::generate_handler!`)
- `commands.rs` (Tauri command shims — they call into salmon-core)

**Verify**:
```
cargo build -p salmon-core      # builds in isolation
cargo build -p salmonapp        # picks up shared code from salmon-core
cargo build -p salmonapp-desktop
```

**Risk**: high. Lots of small `use crate::…` → `use salmon_core::…`
fixes. `pub` visibility audit. Module-level state (statics) needs to
move carefully.

### Phase 2d — Split React frontends

**What changes**: factor `salmon/src/` into three:
- `frontends/shared/src/` — types, api, notify, platform, all the
  view components both apps use
- `frontends/app/src/` — App.tsx (without DesktopView), main.tsx,
  WelcomeBack
- `frontends/desktop/src/` — App.tsx (always renders DesktopView),
  main.tsx, all desktop components

Use npm workspaces (root `package.json` with `"workspaces"`) so
shared is a sibling package that the other two depend on by name.

**Bookkeeping**:
- ADD root `package.json` declaring `"workspaces": ["frontends/*"]`
- MOVE `salmon/src/components/Mail*` → `frontends/shared/src/components/`
- MOVE `salmon/src/components/desktop/` → `frontends/desktop/src/components/`
- SPLIT `salmon/src/App.tsx` into two slimmer App.tsx files
- One `tsconfig.json` per package, plus a root `tsconfig.json` for
  path aliases

**Risk**: highest. TS module-resolution gets fussy in monorepos.
Vite has to pick up shared from `node_modules`. Likely a few rounds
of "build broken in X, fix, rerun".

### Phase 2e — Wire CI to both pipelines

**What changes**: two workflow files:

```yaml
# .github/workflows/release-app.yml
on:
  push:
    tags: ['app-v*']
…
- name: Build & publish
  uses: tauri-apps/tauri-action@v0
  with:
    projectPath: crates/salmon-app
    tagName: ${{ steps.tag.outputs.tag }}
    releaseName: 'SalmonApp ${{ steps.tag.outputs.tag }}'
```

```yaml
# .github/workflows/release-desktop.yml
on:
  push:
    tags: ['desktop-v*']
…
strategy:
  matrix:
    include:
      - platform: ubuntu-22.04           # NO macos-latest
…
- name: Build & publish
  uses: tauri-apps/tauri-action@v0
  with:
    projectPath: crates/salmon-desktop
    tagName: ${{ steps.tag.outputs.tag }}
    releaseName: 'SalmonApp Desktop ${{ steps.tag.outputs.tag }}'
```

Two distinct tag prefixes (`app-v*` and `desktop-v*`) keep the
release pipelines independent. The unified `release.yml` from v1.x
can be deleted in Phase 2f.

### Phase 2f — Delete legacy paths

**What changes**: now that `salmon/` is empty (everything moved into
`crates/` and `frontends/`), delete it. Update any remaining docs
that reference the old paths.

## Effort estimate

| Phase | Single-engineer estimate | Risk |
|---|---|---|
| 2a workspace skeleton | half a day | low |
| 2b duplicate crate | 1 day | medium |
| 2c extract salmon-core | 3-4 days | high |
| 2d split frontends | 3-5 days | highest |
| 2e CI pipelines | 1 day | medium |
| 2f cleanup | half a day | low |
| **Total** | **8-10 days** | — |

This is for someone who can compile-test locally. Doubled if working
blind through PRs.

## What's on the branch right now

`claude/v2.0.0-workspace-refactor` contains:

1. **This document** (`docs/refactor-three-products/README.md`).
2. **Phase 2a starter**: workspace `Cargo.toml` at repo root, CI
   workflow update, `.gitignore` update. Nothing else moves.

To validate Phase 2a locally:

```
git fetch && git checkout claude/v2.0.0-workspace-refactor
cargo metadata --format-version 1 | jq -r .workspace_members[]
# expect a single salmonapp entry
cd salmon
npm install
npm run tauri:dev
# should launch the v1.20.2 app, unchanged behaviour
```

If `cargo metadata` complains or `tauri:dev` won't launch, the
workspace declaration is off. The fix is usually small — point me at
the error message and I'll patch.

Once Phase 2a is verified, Phase 2b lands on the same branch. Don't
merge to main until at least 2a + 2b are validated. Earlier merges
are fine if you have the bandwidth to validate each phase one by one.
