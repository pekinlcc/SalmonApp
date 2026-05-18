# SalmonApp v0.9 — 邮件 / 日历 / 联系人 + 混合 AI 首页

> 第二版方案。用户已确认：(1) 首页是混合推荐 (2) v0.9 邮件/日历完整不留尾巴
> (3) Gmail + Outlook (4) 联系人也要同步。

---

## 产品定位升级

**v0.8.x**：CLI 客户端 + 推荐
**v0.9.0**：**个人工作中枢** —— 首页是基于 邮件 / 日历 / CLI 对话 / 联系人 四路数据
的 AI 混合推荐流；邮件 / 日历 / 联系人是辅助操作面板。

---

## 体量诚实说（第二版）

| 模块 | 工作量 | 关键风险 |
|---|---|---|
| OAuth × 2 providers | 3-4 周 | Google + Microsoft 各自注册、各自 token 刷新协议、各自 scope 配置；OAuth 错一处全部链路坏 |
| 邮件 Gmail API + Graph | 4-5 周 | 两套协议差异：Gmail thread 模型 vs Outlook conversation 模型；搜索语法；附件 multipart 上传 |
| 邮件发送 / 草稿 / 回复 / 引用 | 2-3 周 | Compose UI、HTML 渲染、签名、内联图片、富文本编辑器 |
| 邮件后台同步（IDLE / Watch / Webhook） | 1-2 周 | Gmail push notification 要 Pub/Sub；Graph 用 webhook 或 long-poll；fallback 5min 轮询 |
| 日历 CRUD × 2 | 3-4 周 | Google Calendar events + Graph events；周期事件 RRULE 解析；多日历 |
| 联系人同步 × 2 | 1-2 周 | Google People API + Graph contacts；用于邮件 contact 分组 |
| AI 混合推荐流水线 | 3-4 周 | ThunderClaw 的 Roost/ContactPulse/Briefing → 改成跨数据源；新加 Calendar/Topic 信号源 |
| 多账号管理 | 1-2 周 | 同 provider 多账号；账号切换；每账号独立 token |
| UI：邮件 3 栏 / 日历 周月 / 联系人 / 发件 modal | 5-6 周 | 占总量约 1/4 |
| Polish + bug fixing | 3-4 周 | OAuth 各种边界 case；网络抖动；token 过期 |
| **小计** | **26-36 周 / 6-8 个月** | 单人开发 |

我会用 **内部里程碑** 来切（不是发布版本，是开发顺序），保证 6-8 周左右就有第一个能跑的内部版本，然后逐步叠加能力：

- M1 (~6 周)：OAuth flow + Gmail 读 + Calendar 读 + 简单 UI + 简单推荐 — 自己能 daily-use
- M2 (~4 周)：发邮件 / 起草 / 回复 + 日历 CRUD + Welcome 混合推荐流
- M3 (~3 周)：Outlook (邮件 + 日历)
- M4 (~3 周)：联系人 sync + AI 用上联系人数据
- M5 (~2 周)：多账号 + 后台 push 同步
- M6 (~3 周)：Polish + 边界 case + ship

总计 **5-6 个月内部开发**，然后 v0.9.0 一次 release 你拿到的是完整版（不分版本 ship 残缺品）。

---

## 数据源 → 推荐 的混合架构

**4 路输入信号**：

```
┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐
│ 邮件正文    │   │ 日历事件    │   │ 联系人      │   │ CLI Topics │
│ Gmail / O   │   │ Google / O  │   │ Google / O  │   │ 现有       │
└─────┬──────┘   └─────┬──────┘   └─────┬──────┘   └─────┬──────┘
      │                │                │                │
      ▼                ▼                ▼                ▼
   ┌──────────────────────────────────────────────────────┐
   │  Signals Layer (Rust)                                 │
   │  - 提取每个数据源的"重要程度 + 时效性"信号             │
   │  - 邮件：未读 × 发件人优先级 × 截止日期提及           │
   │  - 日历：今日 + 24h 内事件 + 缺议程的会议             │
   │  - 联系人：本周交互频次 × VIP 标记                    │
   │  - Topics：现有 priority + payoff                     │
   └────────────────────────┬─────────────────────────────┘
                            ▼
   ┌──────────────────────────────────────────────────────┐
   │  AI Briefing Agent (复用 ThunderClaw 三段流水线)       │
   │  - Roost: 跨源去重 + 按"应处理事项"聚类               │
   │  - Pulse: 每个聚类让 claude/codex 写一句"为什么/怎么办" │
   │  - Briefing: 合并 + 时序排序 + 顶部最多 5 条          │
   └────────────────────────┬─────────────────────────────┘
                            ▼
   ┌──────────────────────────────────────────────────────┐
   │  Welcome Back 首页混合推荐流                          │
   │  - 不再区分"来自邮件"/"来自日历"/"来自 Topic"        │
   │  - 每条 card 标注信号来源 + 一键跳转对应视图         │
   └──────────────────────────────────────────────────────┘
```

**关键设计**：

- **推荐 card 是异质的** —— 一张 card 可能引用一封邮件 + 一个日历事件 + 一个 Topic（"5/12 嘉年华截止 → 邮件 #abc + 日历事件 #def + 你有个 Topic 在做家长群通知"）
- **联系人作为"放大镜"** —— 不直接出现在推荐里，但参与"这个发件人重要吗"的打分
- **现有 v0.6 推荐系统沿用** —— 只是数据源从 1 个（Topics）变成 4 个

---

## 数据模型扩展

```sql
-- 账号（多账号 + 多 provider）
CREATE TABLE mail_accounts (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,           -- 'gmail' | 'outlook'
  email       TEXT NOT NULL,
  display_name TEXT,
  oauth_refresh BLOB,                  -- AES-encrypted; key in OS keyring
  oauth_access  TEXT,                  -- short-lived; can re-derive from refresh
  oauth_expires_at INTEGER,
  added_at    INTEGER NOT NULL,
  last_sync_at INTEGER
);

CREATE TABLE mail_messages (
  id           TEXT PRIMARY KEY,       -- provider's message_id
  account_id   TEXT NOT NULL,
  thread_id    TEXT,
  from_email   TEXT, from_name TEXT,
  to_emails    TEXT,                   -- JSON
  subject      TEXT,
  snippet      TEXT,
  body_text    TEXT,                   -- on-demand fetched
  body_html    TEXT,                   -- on-demand fetched
  date_ms      INTEGER,
  unread       INTEGER DEFAULT 1,
  starred      INTEGER DEFAULT 0,
  labels       TEXT,                   -- JSON
  has_attachments INTEGER DEFAULT 0
);
CREATE INDEX idx_mail_account_date ON mail_messages(account_id, date_ms DESC);

CREATE TABLE mail_attachments (
  id           TEXT PRIMARY KEY,
  message_id   TEXT NOT NULL,
  filename     TEXT,
  mime_type    TEXT,
  size_bytes   INTEGER,
  local_path   TEXT                     -- NULL until user downloads
);

CREATE TABLE mail_drafts (              -- 本地起草，未发出
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  to_emails    TEXT, cc_emails TEXT, bcc_emails TEXT,
  subject      TEXT,
  body         TEXT,
  reply_to_id  TEXT,                    -- 回复关联
  attachments  TEXT,                    -- JSON local paths
  updated_at   INTEGER NOT NULL
);

CREATE TABLE calendar_events (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  calendar_id  TEXT,                    -- multiple calendars per account
  start_ms     INTEGER NOT NULL,
  end_ms       INTEGER NOT NULL,
  all_day      INTEGER DEFAULT 0,
  title        TEXT,
  location     TEXT,
  description  TEXT,
  attendees    TEXT,                    -- JSON: [{email, name, response}]
  organizer    TEXT,
  recurrence   TEXT,                    -- RRULE string
  status       TEXT,                    -- confirmed | tentative | cancelled
  my_response  TEXT                     -- accepted | declined | tentative | needsAction
);
CREATE INDEX idx_cal_start ON calendar_events(start_ms);

CREATE TABLE contacts (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  email        TEXT NOT NULL,
  name         TEXT,
  organization TEXT,
  is_vip       INTEGER DEFAULT 0,       -- 频繁联系 / 用户标星
  last_seen_ms INTEGER,
  interaction_count INTEGER DEFAULT 0
);
CREATE INDEX idx_contact_email ON contacts(account_id, email);

CREATE TABLE briefings (
  id           TEXT PRIMARY KEY,
  generated_at INTEGER,
  scope        TEXT,                    -- 'today' | 'week'
  items_json   TEXT                     -- 完整结构
);
```

**OAuth token 加密策略**：
- macOS：Keychain via `security` framework
- Linux：libsecret / GNOME Keyring
- Windows：DPAPI
- 密钥在 keyring，加密后 token blob 落 SQLite

---

## UI 三大变动

### A. 首页（Welcome Back）彻底重写

不再是简单 attention/recent + recs，而是：

```
┌─────────────────────────────────────────────────────────┐
│  ✦ 早安，今天 5/8 周四                                  │
│                                                         │
│  ┌─ 现在最重要的 5 件事 ─────────────────────────────┐ │
│  │ 🔴 BASIS 嘉年华截止                                 │ │
│  │    源：邮件 #abc · 日历事件 #def · 5/12 截止       │ │
│  │    [打开邮件] [起草回复] [× 忽略]                  │ │
│  ├─────────────────────────────────────────────────── │ │
│  │ 🟠 14:00 SalmonApp 周回顾（进行中）                 │ │
│  │    源：日历事件 · 议程未填                          │ │
│  │    [打开日历] [生成议程]                            │ │
│  ├─────────────────────────────────────────────────── │ │
│  │ 🟡 HSBC 信用卡续卡                                  │ │
│  │    源：邮件 3 封 · 联系人 cards@hsbc.com VIP        │ │
│  │    [打开邮件] [× 忽略]                              │ │
│  ├─────────────────────────────────────────────────── │ │
│  │ 🟡 ThunderClaw 任务 v0.4 进展                       │ │
│  │    源：CLI Topic                                    │ │
│  │    [继续对话] [× 忽略]                              │ │
│  └─────────────────────────────────────────────────── │ │
│                                                         │
│  ┌─ 用量 ────┐ ┌─ Topics ─┐ ┌─ 日程 ─┐                │
│  │ 今日 12k  │ │ 11 个     │ │ 3 个   │                │
│  └───────────┘ └───────────┘ └────────┘                │
└─────────────────────────────────────────────────────────┘
```

### B. 邮件 / 日历 / 联系人 各一个完整视图

- **邮件**：3 栏（账号/文件夹 + 邮件列表 + 阅读+回信）；右上角发件按钮；附件下载；HTML 渲染
- **日历**：左侧今日 agenda + 右侧周/月切换；点空白处建事件；右键事件编辑/删除
- **联系人**：搜索 + 列表 + 与该联系人的所有邮件 + 共享的日历事件

### C. 设置 → 账号

- 一个新 Tab "📧 账号" 在 设置 内
- 添加 / 切换 / 移除账号
- 每账号显示同步状态 + 上次同步时间
- 隐私开关：哪些数据可以送给 claude/codex 分析（默认全开，可选只送 subject 不送 body）

---

## 减化后的决策点（其余你已经定了）

1. **OAuth client ID**：我帮你注册 SalmonApp 在 Google + Microsoft 各一个（client_id 公开 OK；desktop secret 也公开但仍走 PKCE）→ 推荐
2. **同步范围**：最近 90 天 + 1000 邮件首次拉，之后增量 → 你 OK 吗？
3. **写邮件的富文本编辑器**：用 `tiptap` (轻量 Markdown-first) 还是 `lexical`（功能完整但重）→ 推荐 tiptap
4. **AI 用量预算**：每日 briefing 估 50-100k tokens，要不要在 Settings → 用量 里加"AI 自动消耗"和"对话消耗"分类显示？→ 推荐做
5. **手机邮件已读状态**：你在 iPhone 上读了一封邮件，SalmonApp 这边能感知吗？答：能（Gmail / Graph 都返回 unread label，5 min 一次轮询能拿到）
6. **联系人 UI 入口**：作为侧栏一级 vs 嵌在 邮件 视图里？→ 推荐嵌在 邮件 里（不是高频独立入口）
7. **第一次登录的 onboarding 引导**：是必须填账号才能用，还是可以跳过先用 CLI 功能？→ 推荐"可以跳过"，账号是可选增强

---

## 5-6 个月开发期内你能看到什么

- 第 6 周：自己用得上的内部版（Gmail 读 + Calendar 读 + UI 雏形 + 简单推荐）—— 我会给你打 dev build
- 第 10 周：完整发件 + 日历 CRUD + 混合推荐 —— 第二个内部版
- 第 13 周：Outlook 接入
- 第 16 周：联系人 + 多账号 + 后台 push
- 第 20-24 周：polish + v0.9.0 正式 ship

中间每个 dev build 都会推到 GitHub Releases（标 `v0.9.0-alpha.N`），你能装上日常用 + 反馈，但 SalmonApp 的"主线版本"号还是 v0.8.x（CLI 用法不变）直到 v0.9.0 正式发布。

---

## 下一步

1. 看 `email-calendar-mockup.html` 确认 UI 方向
2. 答 7 个决策点（或"按你建议来"）
3. 我才注册 OAuth client、设 schema、动代码
4. 准备好 ~5-6 个月内不要砍 SalmonApp 现有 CLI 功能开发预算 —— 这俩并行是不现实的，全力做 v0.9 期间 v0.8.x 只接 hotfix
