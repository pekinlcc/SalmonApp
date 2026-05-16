# SalmonApp OAuth 注册指南

> v0.9 集成 Gmail + Outlook 邮件 / 日历 / 联系人，需要你在两家
> 平台分别注册一个 OAuth 应用。这份文档一步步带你做。
>
> 注册完把 client ID + secret 给我，alpha.2 接入。

---

## 为什么需要你注册（而不是我帮你）

- Desktop app 的 OAuth client secret 实际上是 public 的（无法保密），
  Google 和 Microsoft 都明确说 desktop apps 不是 confidential client。
- 但 client ID 仍然绑定**注册者的 Google Cloud / Azure 项目**：使用量算
  到你账号下，配额你来管。
- 你自己注册的 client：你随时能 revoke、看 audit log、改 scope。
- 我可以注册一个 "SalmonApp 公共 client"，但所有用户共用、配额冲突、
  你看不到自己的访问明细 —— 体验差。

---

## Part 1 · Google Cloud Console（Gmail + Calendar + Contacts）

预计 15 分钟。需要一个 Google 账号（用哪个都行，不一定是 SalmonApp 要登录的那个）。

### 1.1 新建项目

1. 打开 https://console.cloud.google.com/
2. 顶部项目下拉 → **新建项目**
3. 项目名：`SalmonApp` （随意）
4. 创建后回到首页，确保顶部下拉选中这个项目

### 1.2 启用所需 API

侧边栏 → **API 和服务 → 库**，依次搜索并启用：

- **Gmail API**
- **Google Calendar API**
- **People API** （联系人）

每个都点 "启用" 按钮。

### 1.3 配置 OAuth 同意屏幕

侧边栏 → **API 和服务 → OAuth 同意屏幕**

1. **用户类型**：选 "外部 (External)"，点创建
   - 内部（Internal）只有 Google Workspace 企业域可用，个人 Gmail 选不到
2. **应用信息**：
   - 应用名称：`SalmonApp`
   - 用户支持电子邮件：你自己的 Gmail
   - 应用徽标：可选（不传也行）
3. **应用域**：留空（desktop app 没有域）
4. **开发者联系信息**：你自己的 Gmail
5. 保存继续

**Scopes** 页：点 "添加或移除范围"，从弹出列表勾选：

| Scope | 用途 |
|---|---|
| `https://www.googleapis.com/auth/gmail.readonly` | 读邮件 |
| `https://www.googleapis.com/auth/gmail.send` | 发邮件 |
| `https://www.googleapis.com/auth/gmail.compose` | 草稿 |
| `https://www.googleapis.com/auth/gmail.modify` | 标已读 / 归档 / 删除 |
| `https://www.googleapis.com/auth/calendar` | 日历 CRUD |
| `https://www.googleapis.com/auth/contacts.readonly` | 联系人 |
| `https://www.googleapis.com/auth/tasks` | 待办 CRUD |
| `https://www.googleapis.com/auth/userinfo.email` | 知道登录的邮箱地址 |
| `https://www.googleapis.com/auth/userinfo.profile` | 显示名 / 头像 |

保存继续。

**测试用户** 页：把要用 SalmonApp 的 Gmail 邮箱都加进来（最多 100 个）。
应用 publishing 状态在 "测试中" 时，只有这里列出的邮箱能登录。

> ⚠ **不要点 "发布应用"**。发布需要 Google verification，
> 几周到几个月，且需要隐私政策网址等。"测试" 状态对个人用足够。

### 1.4 创建 OAuth client ID

侧边栏 → **API 和服务 → 凭据**

1. 顶部 **+ 创建凭据 → OAuth 客户端 ID**
2. **应用类型**：选 **"桌面应用 (Desktop app)"**
3. 名称：`SalmonApp Desktop`
4. 创建

弹出的对话框给你两个东西，**复制下来**：

```
客户端 ID (Client ID):   xxxx-yyyy.apps.googleusercontent.com
客户端密钥 (Client secret): GOCSPX-zzzz
```

> ⚠ secret 虽然叫 secret 但 desktop client 的安全模型不依赖它保密，
> 别人拿到只能模仿成 SalmonApp 发 OAuth，但仍要用户授权才能拿 token。

---

## Part 2 · Microsoft Azure（Outlook 邮件 / 日历 / 联系人）

预计 15 分钟。需要一个 Microsoft 账号（个人 / 工作都行）。

### 2.1 进入 Azure 应用注册

1. 打开 https://entra.microsoft.com/ （或 portal.azure.com → Microsoft Entra ID）
2. 左侧 **应用注册** → 顶部 **+ 新建注册**

### 2.2 填注册表单

- **名称**：`SalmonApp`
- **支持的账户类型**：选 **"任何组织目录中的账户和个人 Microsoft 账户"** （第三个选项）
  - 这样个人 Outlook / Hotmail / Live 邮箱 + 公司账号都能登录
- **重定向 URI**：
  - 平台选 **"公共客户端/本机 (移动和桌面)"**
  - URI 填：`http://127.0.0.1/oauth/callback`
  - SalmonApp 启动 OAuth 时会监听随机本地端口。Microsoft 对 loopback redirect URI 会忽略端口，但路径必须匹配 `/oauth/callback`。

点 **注册**。

### 2.3 复制 Application ID

注册完成跳到应用概览页，**复制顶部的 "应用程序 (客户端) ID"**：

```
应用程序 ID: 12345678-abcd-...
```

Microsoft 不用 client secret（公共客户端走 PKCE），所以只有这一个值。

### 2.4 配置 API 权限

左侧 **API 权限** → **+ 添加权限**

选 **Microsoft Graph** → **委托的权限 (Delegated permissions)**，
逐一搜索勾选：

| 权限 | 用途 |
|---|---|
| `Mail.ReadWrite` | 邮件读 / 改 |
| `Mail.Send` | 发邮件 |
| `Calendars.ReadWrite` | 日历 CRUD |
| `Contacts.Read` | 联系人 |
| `Tasks.ReadWrite` | 待办 CRUD |
| `User.Read` | 知道登录的账号信息 |
| `offline_access` | refresh token（关键！没这个每小时要重登） |

点 **添加权限**。

> Microsoft 的"管理员同意"按钮**不需要点**（你给自己授权时弹的同意框会自动覆盖）。

### 2.5 启用公共客户端流

左侧 **身份验证 (Authentication)** → 滚到底部 **高级设置 →
允许公共客户端流** → 改成 **是**。保存。

（这个开关启用 desktop-app 模式的 OAuth，不开会被拒。）

---

## Part 3 · 写入 SalmonApp 配置文件

SalmonApp 启动时会读取 `oauth_config.toml`。安装版 Mac app 的推荐路径是：

```
~/Library/Application Support/app.salmonapp.desktop/oauth_config.toml
```

创建目录并写入配置：

```bash
mkdir -p "$HOME/Library/Application Support/app.salmonapp.desktop"
cp salmon/src-tauri/oauth_config.toml.example \
  "$HOME/Library/Application Support/app.salmonapp.desktop/oauth_config.toml"
open -e "$HOME/Library/Application Support/app.salmonapp.desktop/oauth_config.toml"
```

然后把前面拿到的值填进去：

```toml
[google]
client_id = "____.apps.googleusercontent.com"
client_secret = "GOCSPX-____"

[microsoft]
client_id = "____-____-____-____"
```

保存后重启 SalmonApp。开发模式仍可使用 `salmon/src-tauri/oauth_config.toml`，
但安装版 Mac app 不读取源码目录里的配置。

---

## 常见坑

- **Google 同意屏幕 "未验证应用"**：测试中状态的正常表现，点"高级" → "继续访问 SalmonApp" 就过。
- **Microsoft "AADSTS50194 application is not configured as multi-tenant"**：注册时账户类型一定要选 "任何组织 + 个人账户"。
- **scope 拿不全**：增量授权可能要重新走一次完整 OAuth flow，不是 bug。
- **token 过期**：refresh token 通常半年内有效（个人账户 90 天不活跃就失效），SalmonApp 会在过期前自动 refresh。

---

## 隐私与安全

- 你注册的 OAuth client 只是"SalmonApp 用什么身份来问用户授权"。
  每个用户授权之后产生的 access / refresh token 跟你的注册项目**无关**
  —— 它们存在用户本机 SalmonApp 的 keyring 里，你看不到。
- 你的 Google Cloud / Azure 项目能看到的是 **API 调用量统计**（请求数、配额用量、错误率），
  看不到任何用户的具体邮件 / 日历 / 联系人内容。
- 邮件正文最终发给 `claude` / `codex` CLI 做 AI 分析 —— 这些 CLI 是用户本机
  已登录的，跟 SalmonApp / 跟你的 OAuth 项目都没数据通道。100% 本机执行。
