# Salmon App

> A three-pane desktop client for the **Claude Code CLI** and **Codex CLI** — Ubuntu / Linux first.
>
> Status: **v0.3.1** — MVP plus a real Preview pane (Markdown / HTML / Office docs), auto-generated topic titles, an origami-fish brand mark, and a workdir-only Topic creation flow with a global engine switcher. End-to-end against a locally-logged-in `claude` or `codex`. Topics persist across launches; the panel reuses your existing CLI credentials so there's no second account to manage.

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

### Prebuilt (Ubuntu / Debian)

Grab the latest from [Releases](https://github.com/pekinlcc/SalmonApp/releases/latest):

```bash
# .deb — installs to /usr/bin/Salmon and adds an application entry
sudo apt install ./Salmon_*.deb

# OR AppImage — no install, double-click or chmod +x then run
chmod +x Salmon_*.AppImage
./Salmon_*.AppImage
```

The `.deb` declares its WebKit / GTK runtime deps; `apt` resolves them. The AppImage bundles them.

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
sudo apt install libreoffice-impress libreoffice-writer libreoffice-calc poppler-utils
```

Without these, Office files fall back to a friendly "binary file" placeholder instead of crashing the preview.

## Build from source

System deps for Tauri 2 on Ubuntu 24.04:

```bash
sudo apt install \
    libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev \
    librsvg2-dev build-essential curl wget file pkg-config
```

Plus a Rust toolchain (`rustup` 1.75+) and Node 20+.

```bash
cd salmon
npm install
npm run tauri:build       # → src-tauri/target/release/bundle/{deb,appimage}/
```

For development (hot-reload UI + auto-restart Tauri):

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

## v0.3.1 — UX polish

- **One-field Topic creation** — the new-Topic dialog now asks for *just* a workdir. Engine, title, model and danger-mode all hide behind a collapsed "高级" pane.
- **Global engine switcher** in the bottom-left status bar — pick the default engine (Claude Code / Codex) once; it's persisted in SQLite and applied to every new Topic. Existing Topics stay on whatever engine they were created with (the CLI's `--resume <session-id>` is per-engine, so cross-engine resume isn't possible — see [PRD §4.1](PRD.md)).
- The dialog still allows a per-Topic override under "高级" without changing the global default.

## v0.3 — what's new since MVP

- **Real Preview**, dispatched by extension:
  - `.md` / `.markdown` → ReactMarkdown + GFM tables + syntax-highlighted code, brand-tinted blockquotes
  - `.html` / `.htm` / `.svg` → sandboxed `<iframe>` (no JS by default, source-of-truth rendering)
  - `.pptx` / `.docx` / `.xlsx` / `.odp` / `.odt` / `.ods` → LibreOffice → PDF → PNG slides, cached at `~/.cache/salmon/preview/<hash>-<mtime>/`. Fallback to embedded-XML text when LibreOffice isn't installed.
  - Recognized binaries (PDF / images / archives / fonts / executables) → type + size + first-16-bytes placeholder instead of a UTF-8 error.
  - **⛶ button in the Preview toolbar** → fullscreen overlay, ESC to exit, MD/Office content gets centered reading width.
  - Switching topics now resets the Preview state (no more stale path from the previous workdir).
- **Auto-generated Topic titles** — after the first user→assistant exchange completes, Salmon silently runs `claude -p "为对话生成 2-6 字标题…"` (or the Codex equivalent) and renames the Topic. Failures are logged and ignored. One attempt per Topic per session.
- **Brand mark** — origami fish icon (SVG source + 32 / 128 / 256 / 1024 PNGs). Installed `.deb` registers it under `hicolor`, so the app shows up in the GNOME Dock and Activities with the new icon.
- **Layout robustness** — the chat / composer panel now uses an explicit `grid-template-rows: 100vh` plus `min-height: 0` on each column. Long chats no longer push the input box below the viewport, and the message stream scrolls properly.

## v0.1 MVP — still works

- [x] CLI auto-detection (claude / codex on PATH)
- [x] Topic create / list / open / close / delete
- [x] Per-Topic PTY child with lazy-spawn on first message
- [x] Streaming Markdown rendering with code highlight + GFM tables
- [x] Tool-call cards (Read / Edit / Bash / WebFetch …)
- [x] Permission approval cards (allow / deny inline)
- [x] Slash commands transparently passed to the CLI (`/help`, `/model`, `/agents`, …)
- [x] Right-pane file tree of the Topic's workdir
- [x] Persistent prefs + Topic restore on launch (no auto-resume; spawn is lazy)
- [x] Bundled as `.deb` and `.AppImage` for x86_64

## Known gaps (v0.3)

- Single window, single profile — no multi-account
- No cloud sync, no team workspace (out of scope per [PRD](PRD.md))
- Linux only — macOS / Windows builds not yet wired
- Token-usage display only counts what the CLI emits in stream events; doesn't reconcile with the CLI's own usage panel
- Office preview blocks the UI thread for ~2-3 s on the first render of a file (LibreOffice cold-start); subsequent loads hit the cache

See [PRD.md](PRD.md) for the full design rationale and roadmap.
