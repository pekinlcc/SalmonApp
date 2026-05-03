# Salmon App — 产品需求文档（PRD v0.3.3）

> 状态：**MVP 已落地,进入完善阶段**
> 版本：v0.3.3 — 2026-05-03
> v0.3.2 → v0.3.3 增量(均已实现):
> - **修复 Codex 多轮对话** — `codex exec resume <sid>` 不接受 `--cd` 参数,但 v0.3.2 一直在传,导致每条第二条消息都 usage error 退出,UI 看起来就是 Codex"消息发出去就消失"。v0.3.3 改为 spawn 时 `current_dir(workdir)`(对首次和 resume 都生效),不再传 `--cd`;同时 `suggest_topic_title` 对 Codex 改用 `codex exec --skip-git-repo-check`(原 `codex -p` 进交互模式不出 stdout)
> - **Topic 缺失工作目录的生命周期** — `topics.archived` 新列(`db.rs` ALTER TABLE 自动迁移),`set_archived(id, archived)` / `check_workdir(path)` 后端命令;Topic 选中时前端立刻 `checkWorkdir`,不存在时聊天区显示醒目的橙色 banner(⚠ 工作目录已不存在 + 完整路径 + 解释 + [归档][永久删除] 两按钮),输入框 disable 并改 placeholder;`engine.rs` 在 spawn CLI 之前也做同样校验,缺失直接 emit 中文 Error 不让 CLI 跑去出 status 2
> - **Topic 列表归档分组** — 右键菜单加"归档"按钮(在重命名与删除之间);归档项从主列表消失,进入底部"已归档 N"折叠分组(灰色斜体显示),展开后可"取消归档"或"永久删除"
> - **右栏可折叠** — 380px 的 Files/Diff/Preview/Logs 栏可收起到 28px 细 rail,Tab 行右侧的 `▸` 按钮触发,或全局快捷键 `Ctrl+\\`;状态持久化在 `localStorage["salmon.rightCollapsed"]`
>
> 版本：v0.3.2 — 2026-05-02
> v0.3.1 → v0.3.2 增量(均已实现):
> - **Codex 驱动正式落地**:替换原先 `engine 'codex' not yet supported` 占位,后端用 `codex exec --json --skip-git-repo-check --cd <wd>` 跑首轮,捕获 `thread.started.thread_id` 当 session id,后续 `codex exec resume <sid>` 续 session;`item.completed` 的 `agent_message`/`command_execution`/`local_shell_call`/`file_read`/`file_change`/`web_search` 等映射到现有 ToolCall 卡片渲染
> - **对话布局开关**(Settings → 对话布局):新加 `Block` 数据模型,助手回复的 text 段和工具调用按到达顺序入 `blocks: Block[]`,渲染分两种风格——**折叠思考 + 答案**(默认,工具调用全收进 `▾ 思考过程 · N 步` disclosure,尾部文字作为答案显示)、**内联时序交错**(Cherry Studio / Claude.ai 风,text/tool 完全按 stream 顺序)
> - **新建 Topic 弹窗主面板放出引擎选择**:两张引擎卡片(同 Settings 的样式)直接铺开,不再藏在"高级"里;工作目录默认预填最近 Topic 的 workdir(Enter 即可提交);若该目录已有 Topic,另一张引擎卡 disabled 显示"此目录已锁定 XX"
> - **后端 `create_topic` 校验**:工作目录必须存在且是目录,否则返回中文错误,杜绝"目录手输错 → Topic 一发就崩"
> - **设置对话框**:左上齿轮按钮 ⚙ 入口,目前承载"默认引擎"(替代之前左下的引擎切换器)和"对话布局"两块,持久化到 `settings` 表
> - **左下回到简洁两行登录状态**(Claude Code: 已登录 · Codex: 已登录),"当前/默认引擎"中间态指示器移除——Topic 引擎在列表里的 CC/CX 徽章已经表达
>
> 版本：v0.3.1 — 2026-05-02
> v0.3 → v0.3.1 增量(均已实现):
> - **新建 Topic 极简化**:弹窗只剩"工作目录"必填,标题/模型/危险模式收进"高级"折叠区
> - **全局默认引擎**:左下状态栏从"两行登录状态"改为"当前引擎 + 切换菜单",选择持久化在 `settings` 表的 `default_engine`,新建 Topic 默认带这个值
> - **Topic 引擎一旦选定不可改**(per-topic locked):因 CLI 的 `--resume <session-id>` 按引擎绑死,跨引擎续 session 不可行;新建弹窗的"高级"允许针对单个 Topic 临时覆盖,但不影响全局
>
> 版本：v0.3 — 2026-05-02
> v0.2 → v0.3 变更（已实现的增量,本文已对应更新各章节）：
> - **品牌资产**：定稿"几何折纸鱼"图标(SVG 源 + 32/128/256/1024 PNG),`.deb` 安装后写入 hicolor 主题,Dock/Activities 可见
> - **右栏 Preview 升级**:
>   - `.md` / `.markdown` → ReactMarkdown + remark-gfm + rehype-highlight,代码块语法高亮、表格、引用块按品牌色渲染
>   - `.html` / `.htm` / `.svg` → `<iframe sandbox="allow-same-origin">` 渲染源文件,JS 默认隔离禁用
>   - `.pptx` / `.docx` / `.xlsx` / `.odp` / `.odt` / `.ods` → LibreOffice headless 转 PDF + `pdftoppm` 切页 → 缓存目录 `~/.cache/salmon/preview/<hash>-<mtime>/slide-N.png`,以 base64 data URL 数组返回前端竖排展示;首次约 2-3s,二次命中缓存即时返回
>   - 二进制文件 → 类型识别 + 大小 + 头 16 字节,友好占位
>   - **切换 Topic 自动重置 Preview 状态**(原先会沿用上一个 Topic 的文件路径,现已修复)
> - **Topic 自动标题**:首轮"用户消息→助手回复"完成且当前标题仍为"新建 Topic"时,后台静默调 `claude -p "为对话生成 2-6 字中文标题…"` 取结果重命名,失败不打扰
> - **布局健壮性**:`grid-template-rows: 100vh` + 三栏 `min-height: 0`,修复对话超长时输入框被挤出视口、聊天区无法滚动的旧 bug
>
> v0.1 → v0.2 变更：根据用户反馈确立 "Topic = Terminal Tab" 心智模型，解决了工作目录绑定、子进程生命周期、斜杠命令分发、多 Topic 并发等关键问题；落定权限审批 UX、退出确认、桌面通知等交互；技术栈定为 Tauri 2；移除候选项与待确认问题，改为决策清单 + 已知风险 + 默认决策。

---

## 1. 产品定位

**Salmon App** 是一款运行在 Ubuntu 桌面的本地 AI 协作客户端。它**不直接调用任何模型 API**，而是把用户已在终端登录好的 `claude` (Claude Code CLI) 或 `codex` (Codex CLI) 作为后台引擎来驱动，将命令行体验图形化。

一句话：**给已经在用 CLI 的人一个三栏式可视化界面**——保留 CLI 的能力和登录态，去掉黑窗口的低效率。

### 1.1 核心价值

| 用户痛点 | Salmon 解法 |
| --- | --- |
| 终端里看长对话历史费眼，鼠标选中复制粘贴麻烦 | 中栏渲染富文本对话，代码块、diff、表格全部高亮 |
| 多个项目/话题混在一个 shell session 里容易乱 | 左栏 Topic 列表持久化每个会话，一键切换 |
| CLI 改了文件、生成了产物，要 `cat`/`ls` 才能看 | 右栏实时预览：文件树、diff、新生成文件、代码渲染 |
| 同时想用 Claude Code 和 Codex 但要换终端 | 顶部一键切换后端引擎，每个 Topic 独立选择 |
| 又不想再登一次/再付一次费 | **复用本机已登录的 CLI 凭证**，零新增账号 |

### 1.2 不做的事（明确非目标）

- 不直接对接 Anthropic API / OpenAI API，不存储 API Key（凭证完全由 CLI 自己管）
- 不替代终端：不做通用 shell，只做 AI 对话场景
- MVP 不做云同步、不做团队协作、不做移动端
- 不重新实现 CLI 的能力（slash command、MCP、hooks、sub-agents 等都"透传"给 CLI）

---

## 2. 目标用户

- **主要**：已经在日常使用 Claude Code / Codex CLI 的开发者，Ubuntu 桌面用户
- **次要**：从 Cursor / Cherry Studio 等工具迁移过来、习惯三栏 chatbot UI 的人
- **典型场景**：写代码、查代码、改配置、跑脚本、做小工具、读论文/文档

---

## 3. 核心心智模型：Topic = Terminal Tab

整个产品的设计原则——**一个 Topic 等同于"开了一个 CLI terminal tab"**。这个心智模型直接定义了大量行为：

| 维度 | Terminal Tab 行为 | Salmon Topic 行为 |
| --- | --- | --- |
| 工作目录 | 一个 tab 开在某个 cwd | 一个 Topic 绑定一个真实项目目录（创建时选定，不可改） |
| 多个 tab 同目录 | 完全允许、互不打扰 | 同一目录可有任意多个 Topic |
| 进程生命周期 | tab 一开就一直在 | **常驻 PTY 子进程**，Topic 关闭时 SIGTERM |
| 输入透明性 | 输入啥都给进程，包括 `/xxx` | **斜杠命令全部透传给 CLI**，Salmon 自身功能走菜单/快捷键 |
| 并发 | 多 tab 各跑各的 | Topic 间完全并发，无硬上限 |
| 关 tab 副作用 | 工作目录文件不动 | Salmon 只删自己的 DB 记录，CLI 自己的 session transcript 也不动 |
| 历史 | shell history 明文 | SQLite 明文存对话 + 提供导出/清空 |

### 3.1 Topic 比 Terminal Tab 多的一条性质：**重启后复活**

真正的 terminal tab 关掉就没了，但 Salmon Topic 用户预期重启后还在（不然左栏列表没意义）。实现：

- Salmon 退出时：SIGTERM 所有子进程，但每个 Topic 的 CLI session id 存进 DB
- Salmon 启动时：Topic 列表从 DB 恢复，**子进程不立即起**（lazy spawn），等用户点开 Topic 并发第一条消息时再 `claude --resume <sid>` 重新挂起来
- 用户体验：类似 tmux 的 detach/attach，对话上下文连续

---

## 4. 信息架构与三栏布局

```
┌─────────────────┬───────────────────────────────┬────────────────────┐
│   左栏          │   中栏                        │   右栏             │
│   Topic 列表    │   对话历史                    │   预览区           │
│                 │                               │                    │
│  • 新建 Topic   │  • 用户消息                   │  Tab: Files / Diff │
│  • 搜索（标题） │  • 助手回复（Markdown）       │       / Preview    │
│  • 时间分组     │  • 工具调用卡片               │       / Logs       │
│  • 引擎徽章     │  • 权限审批卡片               │  • 文件树          │
│  • 健康状态     │  • 输入框 + 发送 / 中断       │  • 文件预览        │
└─────────────────┴───────────────────────────────┴────────────────────┘
```

### 4.1 左栏：Topic 列表

- **新建 Topic** 弹窗：
  - 引擎：Claude Code / Codex（单选）
  - 工作目录：必选一个真实目录（最近用过的置顶 + "选择目录…"）
  - 模型（如适用）：从 CLI 支持列表里选，缺省值跟随 CLI 配置
  - 标题：可空，首条消息后自动生成
- **列表项**：标题、最近活跃时间、引擎图标（CC / CX 区分）、状态点
  - 状态点语义：进行中（呼吸点）/ 启动中（旋转点）/ 已中断或异常（红色）
- **操作**：右键 — 重命名、归档、删除（带确认）、复制工作目录路径、在终端打开
- **搜索**：MVP 仅按标题搜；跨消息全文搜索（FTS5）放 P1
- **分组**：按时间（今天 / 昨天 / 本周 / 更早）；MVP 不做手动分组
- **底部**：全局设置入口、引擎健康状态（Claude Code / Codex 是否检测到 + 是否登录）

### 4.2 中栏：对话历史

- **消息渲染**：
  - 用户消息：左对齐通栏样式（接近 Claude Desktop）
  - 助手消息：Markdown + 代码块高亮 + 表格
  - **工具调用卡片**：可折叠，显示工具名（Read / Edit / Write / Bash / Grep…）、参数摘要、状态（running / done / cancelled / error）；点击跳到右栏看详细内容
  - **权限审批卡片**（见 §6.1）：触发权限请求时inline 渲染
  - 思考过程（如 CLI 输出）：默认折叠
- **流式显示**：边接收 CLI 输出边渲染（Claude Code 用 `--output-format stream-json`）
- **输入框**：
  - 多行、Shift+Enter 换行、Enter 发送（可设置）
  - 拖拽文件 → 自动 `@文件路径` 引用
  - 斜杠命令补全（**全部透传给 CLI**，不做白名单分发）
  - 中断按钮（发送 SIGINT 给后台进程，等同终端 Ctrl-C）
- **顶部 Bar**：当前 Topic 标题（可点改）、引擎徽章、模型、工作目录、Token 用量

### 4.3 右栏：预览区

Tab 式切换，**和当前选中的工具调用/消息联动**：

| Tab | 内容 |
| --- | --- |
| **Files** | 工作目录的文件树；本次会话新增 `A` / 修改 `M` 高亮 |
| **Diff** | 选中某次 Edit 工具调用时，展示 before/after diff |
| **Preview** | 单文件预览,按扩展名分派:见 4.3.1 |
| **Logs** | 当前 Topic 的 CLI 原始 stdout/stderr，便于排错 |

- 顶部按钮：在 VSCode 打开 / 在终端打开 / 复制路径
- **右栏宽度可拖拽调整、整体可折叠**（窄屏友好）
- **切换 Topic 时清空所选预览路径**——新 Topic 的 workdir 不同,旧路径失去意义

#### 4.3.1 Preview 渲染分派表

| 扩展名 | 渲染方式 | 备注 |
| --- | --- | --- |
| `.md` `.markdown` `.mdx` | ReactMarkdown + remark-gfm + rehype-highlight | 与对话区一致风格,标题分隔线、表格、引用块带品牌色 |
| `.html` `.htm` `.xhtml` `.svg` | `<iframe sandbox="allow-same-origin" srcDoc=...>` | JS 默认禁用避免污染主进程,允许相对资源 |
| `.pptx` `.docx` `.xlsx` `.odp` `.odt` `.ods` | LibreOffice headless 转 PDF → `pdftoppm -r 110 -png` 切页 → base64 PNG 列表 | 缓存键 = 路径 hash + mtime,二次命中跳过转换 |
| 文本类(其他可 UTF-8 解码的) | `read_file_text` 后塞入 `<div class="preview-text">` | 等宽字体 |
| 已知二进制 (pdf, zip, 图片, 音视频, 字体, 可执行文件) | 类型识别 + 大小 + 头 16 字节 hex,友好占位 | 不阻塞,不报错 |
| > 2MB 文件 | 占位"文件过大"提示 | 避免内存爆炸 |

---

## 5. 后台引擎与 CLI 交互

### 5.1 工作模式

每个 Topic 对应一个**独立的常驻 CLI 子进程会话**：

1. Salmon 启动时检测：`which claude` / `which codex`，并验证登录状态（轻量无副作用调用）
2. 用户新建 Topic → Salmon 在选定的工作目录里 spawn 一个 CLI 子进程（PTY 包装）
3. 子进程参数：
   - Claude Code: `claude --output-format stream-json --input-format stream-json`（启动时附 `--resume <sid>` 复用 session）
   - Codex CLI: 等价的 JSON 流模式（**MVP 启动前先做 1 天可行性 spike**）
4. 用户输入 → 写入子进程 stdin（JSON 帧）
5. 子进程 stdout 流式 JSON → 解析为：消息事件、工具调用事件、文件变更事件、权限请求事件 → 推到中栏 + 右栏

### 5.2 凭证

- **完全不接管**：CLI 用什么登录态（API Key / OAuth / Pro 订阅）就用什么
- Salmon 不读 `~/.claude` 等目录，不存任何 Key
- 如果 CLI 未登录，引导用户回终端跑 `claude login` / `codex login`（见 §6.4 首次引导）

### 5.3 持久化

- 本地 SQLite (`~/.local/share/salmon/salmon.db`)：
  - Topics 元数据（id、标题、引擎、工作目录、CLI session id、创建/更新时间）
  - 消息（role、content、tool_calls、token usage、timestamp）
  - 设置
- 工作目录里的真实文件不动；Salmon 只保存对话和元信息
- **明文存储**（与 VSCode/Cursor 一致，与终端 history 体验对齐）；提供导出 Markdown / JSON 和清空入口

### 5.4 引擎差异处理

| 维度 | Claude Code CLI | Codex CLI |
| --- | --- | --- |
| 输入/输出格式 | `stream-json` 已稳定 | 需调研，MVP 前 1 天 spike |
| 工具调用语义 | Read/Edit/Write/Bash/Grep/WebFetch/WebSearch... | 不同子集，命名可能不同 |
| 斜杠命令 | `/clear` `/compact` `/model` `/agents`... | 另列支持表 |
| MCP / Hooks / Sub-agents | 支持，全部透传 | 待确认 |

---

## 6. 关键 UX 决策

### 6.1 权限审批 UX（默认 B + 高级开关 C）

CLI 触发工具调用时若需用户授权（如 `Allow Bash to run "rm -rf node_modules"?`），Salmon 在中栏渲染**带按钮的权限审批卡片**：

- **允许一次** — 仅本次
- **允许此会话** — 本 Topic 内同一工具+参数模式不再问
- **永久允许此命令** — 全局白名单（写入 Salmon 设置，可在设置里管理）
- **拒绝** — 当前调用作废，CLI 收到拒绝事件

**高级开关 / 危险模式**：Topic 创建时可勾选"危险模式"（等价 CLI 的 `--permission-mode bypassPermissions` 或 `acceptEdits`）。开启后 Topic 头部显示**红色徽章**警告，所有权限请求自动放行。

### 6.2 退出 Salmon 时若有 Topic 在跑

弹确认框：
> "还有 N 个 Topic 在运行（refactor auth、监控脚本…），确认退出？所有运行中的工具调用会被中断。"

按钮：取消 / 确认退出。

### 6.3 桌面通知

后台 Topic 完成时（用户当前不在该 Topic）发 Ubuntu 原生 notification：
- 默认开启
- 设置里可关
- 单条通知点击跳转到对应 Topic

### 6.4 首次启动引导

未检测到任何 CLI / 检测到但未登录的状态：
- 主区域显示空状态卡片，列出 Salmon 检测到的 CLI 与状态：
  - Claude Code：已安装 ✓ / 已登录 ✓ — 准备就绪
  - Codex：已安装 ✓ / 未登录 ✗ — 显示 `codex login` 命令复制按钮
  - 未安装的：显示官方安装命令复制按钮
- **不在 App 内做登录流程**（OAuth / API Key 让 CLI 自己管）
- 检测到至少一个 CLI 可用后，引导"创建第一个 Topic"

### 6.5 自动 Topic 标题

新建 Topic 时不强制取标题(默认占位"新建 Topic")。首轮对话(用户消息 + 助手完整回复 + Exited 事件)结束后,如果标题仍是默认值,后端自动:
1. 取首条用户消息(截前 240 字)+ 首条助手回复(截前 320 字)
2. 用 Topic 配置的 CLI(`claude -p` 或 `codex -p`)无 `--resume` 跑一次 headless,提示"为下面对话生成 2-6 字中文标题,只返回标题文字本身"
3. 清洗结果(去引号/书名号/句末标点,截 20 字),写入 DB,前端 setState 立即可见

特性:
- 静默执行,不打扰对话(失败仅写 debug log)
- 每个 Topic 仅尝试一次(前端 `titleAttemptedRef` 标记)
- 用户随时双击标题手动改,自动改后用户重命名优先级高于自动

### 6.6 中断的语义

用户点中断 / 关闭 Topic / 退出 Salmon：
- 已渲染的不完整消息打 `[已中断]` 标记
- 处于 `running` 的工具调用卡片转 `cancelled` 状态
- 中断不删除已发生的副作用（已修改的文件不回滚——和终端 Ctrl-C 一致）

---

## 7. 异常态与边界情况

| 场景 | 处理 |
| --- | --- |
| 子进程崩溃 | 中栏顶部显示 banner："Topic 进程退出（exit code N）"，提供"重启此 Topic"按钮 |
| 登录过期 | 中栏 banner 提示去终端跑 `claude login`，附复制命令按钮 |
| 工作目录被删除/不可访问 | Topic 列表项变红，打开时显示"目录不可达"，提供"重新选择目录"或"删除此 Topic" |
| 磁盘满 / DB 写失败 | 顶部全局 banner 警告，新消息进入降级模式（仅渲染不持久化） |
| Hook 卡住要交互 | 已知风险，MVP 不解决；用户可在 Logs Tab 看到原始流并自查 |
| 老版本 `claude` 不支持 `stream-json` | 启动时探测，不达版本要求弹窗提示升级 + 给升级命令 |
| 同目录多 Topic 并发改同一文件 | 已知风险，MVP 不做冲突检测；写入"已知风险"小节 |
| 长 bash 输出（>200 行） | 折叠为"展开 N 行"按钮，避免污染中栏 |

---

## 8. 非功能需求

| 项 | 要求 |
| --- | --- |
| 平台 | Ubuntu 22.04+，X11 / Wayland 都要可用 |
| 安装 | `.deb` 包 + AppImage 双格式；MVP 不做 Snap / Flatpak |
| 启动时间 | 冷启动 < 2s |
| 内存 | 空闲 < 300MB（含一个空 Topic） |
| 离线 | 没有网络也能打开 App、看历史；新对话取决于 CLI 自己 |
| 主题 | Light / Dark / **跟随系统（默认）** |
| 国际化 | MVP 支持中文 + 英文 |
| 无障碍 | 键盘可达：Ctrl+K 切 Topic、Ctrl+N 新建、Ctrl+\\ 切右栏 |
| 自更新 | **MVP 不做**，手动下新版 AppImage / `.deb` |
| 遥测 | **MVP 全关**，不上报任何数据 |

---

## 9. 技术栈（已定）

**Tauri 2 + React + TypeScript**

理由：
- 核心难点是 PTY 子进程 + 流式 JSON 解析的稳定性，Rust 在这件事上的可靠性远胜 Node
- 包体小（~10MB vs Electron ~150MB）
- 内存占用低，符合"空闲 < 300MB"指标

---

## 10. MVP 范围

### Must（P0）
- [x] 三栏布局
- [x] 创建 / 切换 / 删除 Topic，引擎可选 Claude Code
- [x] 同目录多 Topic
- [x] 中栏渲染对话（Markdown + 代码块 + 工具调用卡片 + 权限审批卡片）
- [x] 流式显示
- [x] 右栏 Files Tab + Diff Tab
- [x] 持久化对话历史
- [x] 重启 Salmon 后 Topic 复活（`--resume`）
- [x] 检测 CLI 是否安装 + 登录
- [x] 首次引导空状态
- [x] 退出确认（有 Topic 在跑时）
- [x] 桌面通知（默认开）
- [x] 危险模式开关

### Should（P1，第二迭代）
- [x] Logs Tab + Preview Tab(见 4.3.1)
- [x] Markdown / HTML / Office 文件预览(LibreOffice 渲染)
- [x] 自动 Topic 标题生成(见 6.5)
- [x] 品牌图标 + .deb 安装入口
- [ ] Codex CLI 后端（依赖前置 spike 通过）
- [ ] 跨消息全文搜索（FTS5）
- [ ] 拖拽文件 → 自动 `@` 引用
- [ ] Dark mode 完整调校
- [ ] 长 Topic 虚拟滚动（>500 条消息）
- [ ] 永久权限白名单管理 UI
- [ ] 导出对话（Markdown / JSON）

### Could（P2）
- [ ] Topic 手动分组
- [ ] MCP / Hooks 配置 UI
- [ ] 多窗口
- [ ] 自动更新

### Won't（不做）
- 云同步、团队、移动端、自托管模型、图片输入（CLI 不支持）

---

## 11. 已知风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Codex CLI 程序化驱动接口未验证 | P1 后端做不出来 | MVP 启动前 1 天 spike，不通过则推迟 Codex 支持 |
| 同目录多 Topic 并发改同一文件 | 数据冲突 | MVP 写"已知风险"提醒，不做检测；P2 评估文件锁/警示 |
| Hooks 想交互输入会卡住 | Topic 假死 | Logs Tab 暴露原始流，文档说明限制 |
| 用户老 CLI 版本不支持 stream-json | 无法启动 Topic | 启动时版本检测 + 升级引导 |
| Tauri 2 团队学习曲线 | 开发节奏放慢 | 投入前 2 天做内部技术 PoC |

---

## 12. MVP 成功标准

**核心指标**：作者本人能用 Salmon 替代 CLI 一周不切回终端做日常任务。

**辅助指标**：
- 冷启动 < 2s
- Topic 切换响应 < 100ms
- 流式渲染延迟 < 50ms（相对 CLI 原生输出）
- 7 天连续使用无需重启 App

---

## 13. 下一步

1. ✅ PRD v0.2 定稿
2. → 启动 Tauri 2 + PTY + Claude Code stream-json 技术 PoC（2 天）
3. → Codex CLI 可行性 spike（1 天）
4. → 设计稿迭代到 hi-fi（基于 mockup.html）
5. → MVP 开发，每周 demo

> 同目录下的 `mockup.html` 是首屏视觉的中保真预览，已在 v0.2 中补充：权限审批卡片、首次引导空状态、Topic 启动中状态、工具调用 cancelled 状态。
