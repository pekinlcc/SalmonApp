# Salmon App

> A three-pane desktop client for the **Claude Code CLI** and **Codex CLI** — Linux + macOS.
>
> Salmon wraps a locally-logged-in `claude` or `codex` and reuses its credentials — no second account to manage. See [Releases](https://github.com/pekinlcc/SalmonApp/releases) for the changelog.

<p align="center">
  <img src="salmon/src-tauri/icons/icon.png" alt="Salmon icon" width="128" />
</p>

[中文 PRD](PRD.md) · [Mockup](mockup.html) · [Icon candidates](icon-candidates.html)

---

## Why

If you already use `claude` (Claude Code) or `codex` (OpenAI Codex CLI) in a terminal, you've hit the same speed bumps:

- Long transcripts are painful to read in a scroll-back buffer
- Multiple projects all share one shell history
- Tool-call diffs need a second `cat`/`ls` to inspect
- Switching between Claude and Codex means switching terminals

Salmon wraps the CLI you're already running and gives it a chat UI:

| Pane | What it shows |
|---|---|
| **Left** | Topic list, grouped by recency, with engine + workdir badges |
| **Middle** | Markdown-rendered chat, tool-call cards, permission prompts, code blocks with `highlight.js` |
| **Right** | Tabs: Files (workdir tree) · Diff · Preview (MD / HTML / pptx / docx / xlsx) · Logs · ⛶ fullscreen toggle |

A **Topic** is mentally a *terminal tab pinned to a workdir* — open many at once, each with its own engine + persistent CLI session. Closing a Topic SIGTERMs its child PTY but keeps the CLI's transcript in `~/.claude/...` or `~/.codex/...` exactly as the CLI itself stores it. Re-opening lazily re-spawns via `claude --resume <session-id>` (or the Codex equivalent). Detach / attach, basically.

Salmon **does not** speak to Anthropic or OpenAI directly. It owns no API key. Credentials and session storage live entirely with the CLI.

## Install

Grab the latest from [Releases](https://github.com/pekinlcc/SalmonApp/releases/latest).

### Ubuntu / Debian

```bash
# .deb — installs to /usr/bin/Salmon and adds an application entry
sudo apt install ./Salmon_*.deb

# OR AppImage — no install, double-click or chmod +x then run
chmod +x Salmon_*.AppImage
./Salmon_*.AppImage
```

The `.deb` declares its WebKit / GTK runtime deps; `apt` resolves them. The AppImage bundles them.

### macOS (Apple Silicon + Intel, universal `.dmg`)

> ⚠ The Mac build is **not notarized** — this project has no Apple Developer account. The `.dmg` is signed ad-hoc, which is enough to launch but not enough to satisfy Gatekeeper out of the box. You'll see "Apple could not verify Salmon is free of malware" on first launch.

```bash
# 1. Open the .dmg, drag Salmon.app into /Applications
# 2. Tell Gatekeeper to trust it. EITHER:

# (a) Right-click Salmon.app → Open → click "Open" in the dialog. macOS
#     remembers the choice; subsequent launches are normal.

# OR (b) clear the quarantine bit from a terminal:
xattr -dr com.apple.quarantine /Applications/Salmon.app
```

`(b)` is the smoother path if you trust this repo's release pipeline. The `.dmg` is universal (`arm64` + `x86_64`), so the same file works on M-series and Intel Macs.

Salmon needs `claude` or `codex` discoverable on PATH. On macOS, GUI apps don't inherit your shell's PATH — Salmon walks `$SHELL -ilc 'echo $PATH'` at startup to import it, plus probes `/opt/homebrew/bin`, `/usr/local/bin`, `~/.npm-global/bin`, `~/.bun/bin`, etc. If `npm i -g @anthropic-ai/claude-code` worked in your terminal, it'll be found.

### Prerequisites

You need at least one of the CLIs already installed and logged in:

```bash
# Claude Code CLI
npm i -g @anthropic-ai/claude-code
claude   # follow the auth flow once

# OR Codex CLI
npm i -g @openai/codex-cli
codex    # auth flow
```

Salmon detects whichever is on `PATH` and offers to use them per-Topic.

### Optional: Office document preview

The Preview pane renders `.pptx` / `.docx` / `.xlsx` / `.odp` / `.odt` / `.ods` by shelling out to LibreOffice headless and slicing the resulting PDF with `pdftoppm`. Install once:

```bash
# Linux
sudo apt install libreoffice-impress libreoffice-writer libreoffice-calc poppler-utils

# macOS (either of these)
brew install --cask libreoffice && brew install poppler
# or download LibreOffice.app from libreoffice.org/download/ — Salmon
# probes /Applications/LibreOffice.app/Contents/MacOS/soffice automatically.
```

Without these, Office files fall back to a friendly "binary file" placeholder instead of crashing the preview.

## Build from source

Common: Rust toolchain (`rustup` 1.77+) and Node 20+.

### Ubuntu 22.04 / 24.04

```bash
sudo apt install \
    libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev \
    librsvg2-dev build-essential curl wget file pkg-config

cd salmon
npm install
npm run tauri:build       # → src-tauri/target/release/bundle/{deb,appimage}/
```

### macOS

```bash
xcode-select --install      # if you don't have command-line tools yet
rustup target add aarch64-apple-darwin x86_64-apple-darwin

cd salmon
npm install
npm run tauri:build -- --target universal-apple-darwin
# → src-tauri/target/universal-apple-darwin/release/bundle/{macos,dmg}/
```

For native-arch only (faster build, won't run on the other Mac arch):

```bash
npm run tauri:build       # → src-tauri/target/release/bundle/{macos,dmg}/
```

### Development (hot-reload UI + auto-restart Tauri, all platforms)

```bash
npm run tauri:dev
```

## Architecture

```
salmon/
├── src/                    React + TypeScript UI (Vite)
│   ├── App.tsx                top-level layout, routing between Topics
│   ├── components/
│   │   ├── LeftSidebar.tsx       Topic list, search, grouping
│   │   ├── ChatStream.tsx        Markdown / tool-call rendering
│   │   ├── Composer.tsx          Input box, /-command pass-through
│   │   ├── ToolCallCard.tsx      Per-tool result rendering
│   │   ├── PermissionCard.tsx    Approval prompts (allow / deny)
│   │   ├── RightPane.tsx         Files / Diff / Preview / Logs tabs
│   │   ├── NewTopicDialog.tsx    Create-topic flow
│   │   └── Onboarding.tsx        First-run CLI detection
│   └── lib/                    invoke() wrappers + types
└── src-tauri/              Rust backend
    └── src/
        ├── lib.rs              Tauri builder, plugin wiring
        ├── commands.rs         Tauri commands invoked from React
        ├── engine.rs           PTY child management, JSONL parse loop
        ├── db.rs               SQLite schema + topic / message CRUD
        └── types.rs            Shared Rust ↔ TS types
```

Key choices:

- **Tauri 2** — native window, system WebKit, ~3 MB app vs. an Electron equivalent
- **Per-Topic PTY** — each Topic owns one `tokio::process::Child` running `claude` (or `codex`) in JSONL streaming mode. Stream events flow through an unbounded mpsc channel and out to the UI as Tauri events.
- **SQLite** in `~/.local/share/Salmon/salmon.db` — Topics, messages, tool calls, permission decisions, token counts. Plain text. Export / clear available from the UI.
- **No API calls from Salmon itself** — every model interaction is a child process invocation.

## Limitations

- Single window, single profile — no multi-account
- No cloud sync, no team workspace (out of scope per [PRD](PRD.md))
- Windows build not yet wired
- macOS build is unsigned / unnotarized — first launch needs the `xattr` workaround above
- Token-usage display only counts what the CLI emits in stream events
- Office preview blocks the UI thread for ~2-3 s on first render (LibreOffice cold-start); cached after

See [PRD.md](PRD.md) for the full design rationale and roadmap.
