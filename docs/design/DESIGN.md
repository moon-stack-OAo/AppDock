# AppDock Design System

## 一句话

深色 DevTools 风的应用构建与分发控制台：石板底 + 电青 accent，信息密度优先，细边框与状态胶囊。

## 色板（OKLch）

| Token         | 值                      | 用途                |
|---------------|------------------------|-------------------|
| `--bg`        | `oklch(15% 0.012 250)` | 页面底               |
| `--surface`   | `oklch(19% 0.014 250)` | 卡片 / 侧栏           |
| `--surface-2` | `oklch(23% 0.014 250)` | 抬升层 / 输入框         |
| `--fg`        | `oklch(94% 0.01 250)`  | 主文字               |
| `--muted`     | `oklch(62% 0.02 250)`  | 次要文字              |
| `--border`    | `oklch(30% 0.016 250)` | 细边框               |
| `--accent`    | `oklch(72% 0.13 195)`  | 电青主色（全站唯一 accent） |
| `--success`   | `oklch(70% 0.14 145)`  | 成功 / 同步完成         |
| `--warn`      | `oklch(78% 0.12 85)`   | 警告 / 排队           |
| `--danger`    | `oklch(65% 0.18 25)`   | 失败 / 危险           |

Hover：背景 L ±0.08，**不**把文字改成 `--muted`。

## 字体

- Display / Body：`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`
- Mono（版本号、文件名、SHA256、slug）：`"JetBrains Mono", "IBM Plex Mono", ui-monospace, Menlo, monospace`

字号阶梯：12 / 13 / 14 / 16 / 20 / 24 / 32。后台表格默认 13px。

## 品牌词标

几何「船坞节点」：左侧竖杆 + 三层水平横档（Dock），右侧圆点节点。可缩放 SVG，单色跟随 `--fg` / `--accent`。

## 关键组件

1. **AppCard** — 下载站首页卡片：图标色块、名称、简介一行、平台徽章、最新版本 mono。
2. **PlatformDownloadGroup** — 按 Windows / macOS / Linux / Android 分组的大下载区。
3. **StatusPill** — `success | warn | danger | muted | info`，浅底 + 同色文字。
4. **DataTable** — 发丝边框、无斑马纹、行 hover 微亮。
5. **Dropzone** — 虚线边框拖拽区 + 已选文件列表。
6. **ConfirmModal** — 覆盖确认（overwrite）危险操作二次确认。
7. **AdminShell** — 240px 左侧导航 + 顶栏用户菜单。
8. **VisibilityBadge** — 公开 / 口令 / 登录。

## 布局

- 下载站：顶栏 56px，内容最大宽 1120px 居中。
- 管理端：侧栏 240px + 主区，桌面优先 1440+。
- 圆角：6px（控件）/ 10px（卡片）。
- 间距基准：4 / 8 / 12 / 16 / 24 / 32。

## 交互约定

- 主 CTA 每视口仅一个实心 accent 按钮。
- 焦点环：`outline: 2px solid var(--accent); outline-offset: 2px`。
- 路由：Hash SPA，便于静态打开与 Vue3 路由映射。
- 同步配置含 Webhook（`syncWebhookEnabled`）+ 轮询（`syncPollEnabled`）双开关，可选应用级轮询间隔覆盖。
- **访问口令中心**统一签发全局 Access Codes（一条可绑定多个 `visibility=password` 应用）；列表仅显示 `codePrefix` 掩码，可通过 reveal 再复制；实现侧为 hash + 主密钥密文双存（管理端随时解密复制，不做用户密钥对）。
- **邮件通知**经 `notify` 队列异步发送（同步成功/失败、手动上传成功）；应用级收件人 = 自定义邮箱 ∪ 成员角色 ∪ 全局回落；成功邮件含 AppDock 各平台下载链接。
- **系统设置**为 Tab 分区（常规 / 同步 / 邮件），支持 `#/admin/settings?tab=mail`；邮件 Tab 为完整可编辑 SMTP 表单（Host/Port/加密/账号/发件人等），密码只写不回显（`passwordSet` + 留空不改）。
- **下载站一期**：UA 智能主下载 + SHA256 一键复制；默认隐藏预发布（「显示预发布」开关，session 记忆）；404 / 403 / 归档（410）空状态；`#/docs/update-check` 更新检查 API 说明。
- **多源 Release**：应用表单「同步源」=`none|github|gitee|gitlab`；一期仅 `github` 可开 Webhook/轮询；Gitee/GitLab 可保存配置但标二期。
- **P0 运维闭环**：归档/取消归档、版本 Yank、上传元数据（标题/changelog/预发布/platform·arch）、任务详情日志、用户系统角色仅 admin|user、公开壳登录/登出与口令会话退出。
- **认证**：登录框文案「用户名或邮箱」；管理端强制改密页 `#/admin/change-password`（种子/演示密码 `changeme`）。
- **定位文案**：页脚写明「一期=Release 同步分发，非 CI 构建」。
