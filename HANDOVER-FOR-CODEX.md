# Handover for Codex — SalmonApp Linux Desktop (Phase 3, shippable scope)

You (Codex CLI) are taking over from Claude Code. Read this top-to-bottom before doing anything. The previous Claude Code session ended at commit `6ff1994`. Today is 2026-05-18.

---

## The goal (read this twice)

Ship a **`.deb` package the user can install on Ubuntu** such that:

1. **`sudo dpkg -i salmon-desktop_X.Y.Z_amd64.deb && sudo apt -f install`** succeeds on a clean Ubuntu 24.04 / 25.04 box.
2. After install, the user **logs out**, the GDM login screen's gear icon offers **"SalmonApp Desktop"**, the user picks it, logs in — and instead of GNOME Shell, **the SalmonApp Desktop UI owns the screen** (wallpaper + Brief widget + dock + launcher from `crates/salmon-desktop`).
3. Clicking Mail / Calendar / Tasks / Contacts / Settings from the dock or launcher **opens a separate native window for that app** — NOT a tab inside one big SalmonApp window. Every app feels like a standalone first-class window the user can Alt-Tab to, drag around, close independently.
4. All those apps **share the same backend data** as the normal SalmonApp App (same SQLite, same OAuth tokens, same engine logic). Mail seen in the Desktop's Mail window is the same Mail seen in the regular SalmonApp.
5. **Local-only.** Never `git push`, `git fetch`, or `git pull`. The remote `origin` points to a rolled-back GitHub repo the user does not want anyone to see. The .deb stays on disk; do not publish a Release.
6. Switching back to plain Ubuntu = log out, GDM gear → "Ubuntu", log in. Nothing the install does should make this hard.

That's the goal. You're done when steps 1-6 all work end-to-end on the user's ThinkPad.

---

## Hard rules

1. **Never `git push`, `git fetch`, or `git pull`.** Remote `origin` was rolled back; touching it will rewrite local refs or — worse — leak the project. Commit locally. That's it.
2. **Don't run the half-finished Smithay compositor with `--features tty`.** It can brick login. The Smithay skeleton at `docs/phase3-compositor/skeleton/` is **parked** — do not invest in it for this scope (see "Why not finish the Smithay skeleton" below).
3. **Never daily-driver the new session until you've tested it end-to-end via a throwaway user account or a VM.** A broken session file in `/usr/share/wayland-sessions/` makes GDM offer a session that hangs on login. Recovery requires Ctrl+Alt+F3 to a TTY + `sudo rm` the .desktop file. The user's machine is their daily driver — protect it.
4. **Don't auto-launch the session as the default.** The user picks it from the GDM gear each time. Default session stays "Ubuntu".
5. **`origin/main` is misleading.** `git status` says "与上游分支一致" only because the local ref is stale; the remote was actually reset to an older commit. Treat local `main` as ground truth.

---

## What's already done (don't re-do)

| Capability | Status | Where |
|---|---|---|
| Pixel-perfect Ubuntu Desktop UI (wallpaper / top bar / dock / launcher / Brief widget) | ✅ | `crates/salmon-desktop/src/components/desktop-shell/` |
| Separate native window per app (Mail / Calendar / Tasks / Contacts / Settings / SalmonApp) when running in shell mode | ✅ | `crates/salmon-desktop/src/lib/openAppWindow.ts` — `openAppWindow(view)` calls `new WebviewWindow(...)` with a unique label and `#view=mail` hash route. Already wired to the dock and launcher via `isShellWindow()` detection. |
| Shared data layer (types, paths, platform abstraction, SQLite) | ✅ | `crates/salmon-core/` — used by both `salmon` (App) and `salmon-desktop` binaries |
| Phase 2c stages 1-3 (types / path_dirs / platform / db extracted) | ✅ | commits `71e0134`, `84a6a7f` |
| Fullscreen kiosk-mode Tauri window with no decorations | ✅ | `crates/salmon-desktop/src-tauri/tauri.conf.json` (`fullscreen: true`, `decorations: false`) |
| `.deb` artifact production (basic, via `tauri bundle`) | ✅ | `cd crates/salmon-desktop && npm run tauri build` outputs `target/release/bundle/deb/` |

**You probably don't need to touch frontend code at all.** Mail/Calendar/Tasks/etc. already render in their own windows when the binary detects shell mode. Verify, don't rewrite.

---

## What needs to be built (this is the work)

### Step 1 — Compositor substrate

The current `salmon-desktop` binary is just a fullscreen Tauri window. That's not a desktop session — it can't accept other apps as floating windows over it, and GNOME would still be the compositor.

To "own the screen" without writing a Wayland compositor from scratch, use **labwc** (a small, mature, Wayland-only wlroots-based compositor; Ubuntu package: `labwc`). labwc:
- Renders a root surface (we'll set it to the dark navy from the SalmonApp design)
- Reads `~/.config/labwc/autostart` and launches whatever's in it as the first client → that's `salmon-desktop`
- Lets other Wayland apps spawn as floating windows over it
- Supports xdg-shell, layer-shell, decorations, Super key shortcuts out of the box

**Why labwc over sway**: smaller surface, designed to be themable, no built-in tiling we have to disable. Sway works too if labwc has a blocker.

**Tasks**:
- `apt-get install labwc` (NOPASSWD is configured, see Environment notes)
- Write `packaging/labwc-config/` in the repo with: `rc.xml` (theme + key bindings), `autostart` (launches `salmon-desktop`), `environment` (sets `WAYLAND_DISPLAY` etc.)
- The `salmon-desktop` Tauri window in this mode probably wants to be a **`wlr-layer-shell` background layer** rather than a regular xdg-toplevel — so it acts as the desktop background and other apps float over it. Tauri 2 doesn't speak layer-shell directly. Two options:
  - **(a) Pragmatic**: keep `salmon-desktop` as a regular fullscreen xdg-toplevel, configure labwc to keep it at the bottom of the stack. Other apps naturally float on top. Simpler. Try this first.
  - **(b) Proper**: write a tiny `gtk4-layer-shell` wrapper in C/Rust that hosts the WebView and binds it to the background layer. More work. Skip unless (a) has visible problems.

### Step 2 — Per-app windows are independent OS windows

Already working — verify these things on the new compositor:
- `salmon-desktop` runs (label "shell", fullscreen).
- Click dock Mail → a new `app-mail` Tauri window appears as a floating window on labwc.
- It has decorations (close / max / min), can be moved with Super+drag (labwc default), can be Alt-Tabbed to.
- Closing it doesn't close the shell.
- Re-clicking Mail focuses the existing window instead of opening another.

If the new windows don't get decorations under labwc, set `decorations: true` for non-shell labels (currently `tauri.conf.json` only declares the `shell` window with `decorations: false`; secondary windows from `WebviewWindowBuilder` default to whatever WebKitGTK gives them, which under labwc should be server-side decorations via `xdg-decoration`).

### Step 3 — `.deb` packaging that installs the session

The Tauri-produced .deb only ships the binary + a `.desktop` launcher under `/usr/share/applications/`. That's not a Wayland session.

Post-process or extend the .deb so it also installs:

```
/usr/bin/salmon-desktop                              ← from Tauri (already there)
/usr/share/wayland-sessions/salmon-shell.desktop     ← NEW. Tells GDM "this session exists"
/usr/share/salmon-desktop/labwc-config/rc.xml        ← NEW
/usr/share/salmon-desktop/labwc-config/autostart     ← NEW
/usr/share/salmon-desktop/labwc-config/environment   ← NEW
/usr/bin/salmon-session                              ← NEW. tiny wrapper script. See below.
```

`salmon-shell.desktop` contents (template lives at `docs/phase3-compositor/session/salmon-shell.desktop`):

```
[Desktop Entry]
Name=SalmonApp Desktop
Comment=Personal AI workspace as a Wayland session
Exec=/usr/bin/salmon-session
Type=Application
DesktopNames=SalmonApp
```

`salmon-session` (a shell script):

```bash
#!/bin/sh
export XDG_CONFIG_HOME="$HOME/.config"
mkdir -p "$XDG_CONFIG_HOME/labwc"
# Symlink the system labwc config the first time
[ -e "$XDG_CONFIG_HOME/labwc/autostart" ] || \
  ln -sf /usr/share/salmon-desktop/labwc-config/* "$XDG_CONFIG_HOME/labwc/"
exec labwc
```

Where to write the files:
- Repo paths: put templates under `crates/salmon-desktop/packaging/` (new folder). Cargo doesn't need to know about them; the build script does.
- `crates/salmon-desktop/build.rs` already exists — augment, don't replace.
- Easiest: after `npm run tauri build`, run a post-build script (Bash, in `scripts/build-deb.sh`) that `dpkg-deb -R`s the Tauri .deb, splices in the extra files + a `DEBIAN/postinst` that runs `update-desktop-database`, then `dpkg-deb -b`s a new .deb at `dist/`. Don't use FPM unless you must — keep dependencies minimal.

### Step 4 — Install, log out, log in, verify

Verification protocol:
1. `sudo dpkg -i dist/salmon-desktop_X.Y.Z_amd64.deb`
2. `ls /usr/share/wayland-sessions/salmon-shell.desktop` exists
3. `apt-get install -y labwc` (declared as a `.deb` dependency too — see below)
4. Log out
5. GDM gear → "SalmonApp Desktop" visible
6. Pick it, log in
7. See the SalmonApp Desktop wallpaper + dock + Brief widget
8. Click dock Mail → independent Mail window appears
9. Open Files (or any other Wayland app) — it floats above the desktop
10. Log out, gear → "Ubuntu", log in → normal GNOME comes back

Add `labwc` to the `.deb`'s `Depends:` (in `tauri.conf.json` -> `bundle.linux.deb.depends`).

### Step 5 — Crash safety

If `salmon-desktop` crashes, labwc by itself leaves the user with an empty screen + no shell. Add a tiny watchdog in `salmon-session`:

```bash
while true; do
  /usr/bin/salmon-desktop || sleep 2
done &
exec labwc
```

(That keeps `salmon-desktop` restarting if it dies, while labwc stays the compositor. If labwc itself dies, GDM takes the user back to the login screen — same behavior as if GNOME Shell dies.)

---

## Why not finish the Smithay skeleton

The skeleton at `docs/phase3-compositor/skeleton/` (separate workspace, ~2700 LoC, commit `6ff1994`) does compile and run nested, but per `COMPILE-STATUS-2026-05-17.md` it's missing input routing, real cursor rendering, damage tracking, TTY backend, GDM integration, and XWayland — each multi-week. Total: 6-12 months solo full-time. **That's not this scope.** Leave the skeleton parked at HEAD; don't delete it (it's research/prototype the user invested in), but don't extend it either. The labwc path gets requirements 1-6 in days, not months.

If the user later wants to swap labwc → custom compositor, the .deb / session-file / window-spawning work above is reusable as-is. The compositor underneath is the only thing that changes.

---

## Repo layout

```
~/桌面/Salmon App/                           (Chinese path; "桌面" = Desktop)
├── Cargo.toml                                ← workspace root
├── salmon/                                   ← v1.x App binary (Mac + Linux App)
├── crates/
│   ├── salmon-core/                          ← shared types/db/platform — DO USE
│   └── salmon-desktop/                       ← the binary to ship as Phase 3
│       ├── src/                              ← React frontend (per-app windows wired)
│       ├── src-tauri/
│       │   ├── tauri.conf.json               ← decorations:false, fullscreen:true
│       │   └── src/                          ← Rust backend
│       └── packaging/                        ← NEW — you create this for Step 1+3
├── docs/
│   ├── SESSION-HANDOFF-2026-05-17.md         ← STALE — background only
│   ├── refactor-three-products/README.md     ← Phase 2 plan
│   └── phase3-compositor/                    ← PARKED — don't extend
│       ├── README.md
│       ├── COMPILE-STATUS-2026-05-17.md
│       ├── session/salmon-shell.desktop      ← reusable template for Step 3
│       └── skeleton/                         ← parked Smithay code
├── HANDOVER-FOR-CODEX.md                     ← this file
└── PRD.md
```

---

## Build / dev commands

```bash
cd "/home/bytedance/桌面/Salmon App/"

# Build the Desktop binary + .deb
cd crates/salmon-desktop && npm run tauri build
# Output: target/release/bundle/deb/SalmonApp_Desktop_<ver>_amd64.deb

# Dev (runs inside current GNOME, in a normal window — for iterating on the UI)
cd crates/salmon-desktop && npm run tauri dev

# After Step 3: build the augmented .deb
./scripts/build-deb.sh                  # to write
# Output: dist/salmon-desktop_<ver>_amd64.deb
```

For the App binary (untouched by this work):
```bash
cd salmon && npm run tauri build
```

---

## Environment notes

- Hardware: ThinkPad X1 Carbon Gen 13, Intel Core Ultra 7 258V (Lunar Lake). Lunar Lake iGPU needs an OEM kernel — not noble GA 6.8 — for proper GPU init under any Wayland compositor. If you hit black-screen issues, check `uname -r`. The user knows this; don't run `apt full-upgrade` to "fix" it.
- Shell has proxy env pointing at `http://127.0.0.1:7897` (local Clash). **`dl.google.com` is blocked** by Clash — use `--noproxy '*'` for Google downloads.
- `apt-get`, `apt`, `dpkg` work without TTY (NOPASSWD configured). Use them freely. **Other `sudo` commands need the user to prefix `!` in the chat** — if you need one, stop and ask.
- User's semver: `Z` = silent fix, `Y` = small/medium feature, `X` = big revamp. This Phase 3 work is an **X bump** when it ships. Update `crates/salmon-desktop/src-tauri/tauri.conf.json` `version` and the `Cargo.toml` versions consistently.

---

## Coding conventions

- Cargo's shared target is `/target/` at workspace root (already configured).
- `#[serde(rename_all = "camelCase")]` only renames *variants*. For struct-variant fields use `rename_all_fields = "camelCase"` (serde 1.0.169+). Required for IPC payloads.
- From a Tauri sync command, spawn async with `tauri::async_runtime::spawn`, NOT `tokio::spawn` (the latter panics with "no reactor running").
- For multi-file Rust refactors: grep both prefixed (`crate::db::foo`) and bare (`db::foo`) patterns.

---

## Plan-first protocol

Before you write code:
1. Read this whole file.
2. Read `docs/phase3-compositor/README.md` and `docs/phase3-compositor/COMPILE-STATUS-2026-05-17.md` for context on what's parked.
3. Read `crates/salmon-desktop/src/lib/openAppWindow.ts` and `crates/salmon-desktop/src-tauri/tauri.conf.json` to confirm the per-app-window code matches what this doc claims.
4. **Confirm the plan with the user before installing anything to /usr or modifying GDM-visible files.** A wrong session file means a hung login screen.
5. Use `/goal` mode (or your equivalent persistent-work mode) so you iterate steps 1→5 until verification protocol passes end-to-end. Don't stop at "compiles" — stop at "I logged out, logged back in, and the new session worked."

If a step requires `sudo` for something other than `apt`/`dpkg` (e.g. writing to `/usr/share/wayland-sessions/` outside of `dpkg`), surface it to the user with the exact command so they can run it with `!` prefix.

---

## In case of doubt

- Read `docs/SESSION-HANDOFF-2026-05-17.md` for older background.
- `git log --oneline -30` for history.
- Ask the user. Don't guess on what "owning the screen" should feel like — there's only one user, just ask them.
