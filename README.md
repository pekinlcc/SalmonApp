# Salmon App

> A three-pane desktop client for the **Claude Code CLI** and **Codex CLI** — Ubuntu / Linux first.
>
> Status: **v0.4.0** — Welcome Back home page with sessions overview + a peer-validated recommendations agent: every hour mark (only if there's been new chat activity since last run) Salmon asks Claude Code and Codex independently for "what's worth doing next", then has each engine cross-rate the other's candidates; only items both engines independently rated *high* show up by default. End-to-end against a locally-logged-in `claude` or `codex`. The panel reuses your existing CLI credentials so there's no second account to manage.

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

## v0.4.0 — Welcome Back home page + peer-validated recommendation agent

Big update — the app stops being just a "wrapper around your CLIs" and starts proactively surfacing what to work on next.

Two new pieces.

### Welcome Back home

When no Topic is selected (or you click the new **首页** entry in the sidebar), the middle pane shows a Welcome Back overview, modeled on claude.ai/code:

- **Sessions** — Topics needing your attention, badged by status: 🟠 *需要授权* (pending permission request) / 🔴 *工作目录失效* (workdir gone) / 🔵 *未读* (assistant replies you haven't seen since last visit).
- **Recent** — already-read Topics, sorted by last activity.
- Click any row to open that Topic; the badge clears as you visit it.
- *Last-read* timestamps live in `localStorage`; messages arriving while you're already viewing the Topic don't re-mark it as unread.

### Recommendations (peer-validated, two-round agent loop)

A new **推荐** section on the Welcome page asks both CLIs what you should do next, runs cross-validation between them, and only surfaces items both engines independently agree are worth your time.

**Two-round flow:**

1. **Round 1 — parallel candidate generation.** A compact summary of every active Topic (first user message + last 3 turns, capped per Topic + total budget ≤ 18K chars) plus the user's accept/ignore history is sent to **both** `claude -p` and `codex exec --json` in parallel. Each engine returns 3-5 candidates with a self-rated value (`high` / `medium` / `low`).
2. **Round 2 — cross-validation.** Each engine reviews the *other's* candidates and rates each one independently. The combined `priority` is conservative: only items both engines independently rated `high` get the **★ 高价值** badge and show up by default. Items where exactly one engine called it high get folded under **▸ 其他建议**. Items neither engine called high are dropped entirely.
3. **Click feedback.** Clicking *✓ 同意* opens the linked Topic and marks `accepted`; *× 忽略* dismisses. Behind the scenes a one-shot `claude -p` then guesses *why* you accepted/ignored (≤40 chars Chinese) and stores it as `decision_reason` so the next round's prompt can reference your real preferences.

**Trigger rule:** runs at the next hour boundary (HH:00) iff there's been new activity (any topic's `updated_at` > last run). On launch, if it's been ≥1 hour since the last run AND there's new activity, fires immediately so the home page isn't stale. **↻ 刷新** button bypasses both gates.

**Persistence.** New tables `recommendations` (priority / self_value / peer_value / status) and `settings.last_recommendation_run` are auto-migrated.

## v0.3.4 — Persist assistant replies (history actually survives restart)

Critical bug fix.

- **Assistant replies are now written to SQLite.** Up through v0.3.3, only the user side of the chat was being persisted via `db.append_message`; the assistant's text only flew through the live stream-event channel and never hit disk. So when you closed the app and re-opened a Topic, you'd see your own messages with no replies — half a conversation. The new `EngineRegistry::spawn` takes an `on_assistant_message` callback; `commands::open_topic` wires it up to `db.append_message(topic_id, "assistant", text, None)`. Both the Claude (`text` block in the assistant message stream-json) and Codex (`agent_message` item.completed) paths invoke it.
- This only affects history *going forward*. Conversations from v0.3.3 and earlier where the assistant text was lost can't be recovered — those bytes never reached the DB.
- Tool-call cards (Bash / Read / Edit / Grep …) are still in-memory only; they reappear during a live session but don't survive a restart yet. That's a bigger schema-side fix planned for a follow-up.

## v0.3.3 — Codex follow-up turns, Topic lifecycle, collapsible right pane

- **Codex multi-turn actually resumes now.** v0.3.2 wired up the Codex driver but `codex exec resume <session-id>` was being passed `--cd <workdir>`, which `resume` doesn't accept — every follow-up turn died with a usage error and the chat looked like Codex went silent after the first message. v0.3.3 drops the `--cd` flag entirely and relies on the spawn's `current_dir(workdir)` for both first-turn and resume; codex remembers the workdir from the session anyway.
- **Codex auto-titles work.** The first-turn auto-title path was running `codex -p "..."` which makes Codex go interactive; switched to `codex exec --skip-git-repo-check "..."` and the title gets generated correctly.
- **Missing-workdir lifecycle.** Topics whose workdir is gone (deleted, moved, typo at creation) used to fail every send with a cryptic `exited with status 2`. Now:
  - Selecting a Topic checks `workdir.exists() && is_dir()` up-front.
  - The chat area shows a proper amber banner: ⚠ *工作目录已不存在* + the missing path + an explanation, with two buttons: **归档** and **永久删除**.
  - The composer is disabled with a placeholder explaining why.
  - Backend's send loop also short-circuits with a friendly Chinese error before spawning the CLI, so the same banner shows up if the dir disappears mid-session.
- **Topic archiving.** New `topics.archived` column (auto-migrated for existing DBs). Right-click context menu in the Topic list gains an *归档* action; archived Topics drop out of the main list into a collapsed *已归档 N* group at the bottom of the sidebar. From there you can *取消归档* or *永久删除*.
- **Right pane collapsible.** The 380px Files / Diff / Preview / Logs pane now collapses to a 28px hover rail. Toggle from the `▸` button in the tab bar or with `Ctrl+\\`. State is persisted in `localStorage`.

## v0.3.2 — Codex driver + chat layouts + Topic creation overhaul

- **Codex CLI is now a real engine, not a stub.** The `codex` topic type used to short-circuit with `engine 'codex' not yet supported in this build`; v0.3.2 wires up the actual driver. Salmon spawns `codex exec --json --skip-git-repo-check --cd <workdir> "<prompt>"` for the first turn (capturing `thread_id` from the `thread.started` event), and `codex exec resume <thread_id> "<prompt>"` for subsequent turns — same per-Topic session-resume semantics that Claude Code already had. Tool-call items (`command_execution`, `local_shell_call`, `file_read`, `file_change`, `web_search` …) get mapped to the same ToolCall card the Claude side uses, so you see what Codex actually did in the workdir. `agent_message` items become assistant text.
- **Chat layouts (Settings → 对话布局).** Assistant turns now keep their text + tool calls in arrival order via a `blocks` array, instead of "all text first, then all tools" which broke the time line. Two layouts:
  - **Folded thinking + answer** (default) — every tool call collapses into a `▾ 思考过程 · N 步` disclosure; the trailing text is the visible final answer. The answer is plain prose now, no orange blockquote bar.
  - **Inline interleaved** (Cherry Studio / Claude.ai style) — text and tools alternate exactly as they streamed.
- **Topic creation flow rewritten.**
  - Two engine cards (Claude Code / Codex) are visible up-front next to the workdir input — no more digging into "高级" to switch engines.
  - The workdir input is **pre-filled with the most recently used Topic's workdir**, so the common case is "Enter to confirm".
  - When the chosen workdir already has a Topic, the **other engine's card is locked out**: same-folder-cross-engine session resume doesn't actually work in either CLI, so we make that constraint explicit at creation time instead of letting it confuse users later.
  - **`create_topic` now validates** that the workdir exists + is a directory; previously a typo got you a topic that crashed every send.
- **Settings dialog** (gear icon top-left of the sidebar). Currently houses *默认引擎* (which engine new Topics default to) and *对话布局*. Persisted in SQLite `settings`.
- **Sidebar bottom-left simplified.** Back to the original two-pill CLI health (Claude Code: 已登录 · Codex: 已登录). The intermediate "current/default engine" indicator was confusing and is gone — engine state is now exposed via the per-Topic badge in the list and the Settings dialog.

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
