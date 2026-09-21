# AppDock 设计稿

来源：OpenDesign 项目 `appdock-design` · 迁入日期 2026-09-20。

## 文件

| 文件           | 说明                      |
|--------------|-------------------------|
| `index.html` | 可交互 Hash SPA（下载站 + 管理端） |
| `DESIGN.md`  | 色板、字体、组件约定              |

## 本地预览

浏览器直接打开 `index.html`，或：

```bash
npx --yes serve .
```

- 管理端：任意非空密码可登录；密码填 **`changeme`** 可演示强制改密
- 登录标识：**用户名或邮箱**（与 PRD `login` 字段一致）
- 口令演示：`dock_demo_forge_2026`（应用 ForgeDesk）

### 公开侧

| 页面        | 路径                                                         |
|-----------|------------------------------------------------------------|
| 首页        | `#/`                                                       |
| 应用        | `#/a/moonnotes` · `#/a/forgedesk`（口令）· `#/a/pixelsync`（登录） |
| 指定版本      | `#/a/moonnotes/v/v2.4.0`                                   |
| 更新 API 说明 | `#/docs/update-check`                                      |
| 404 / 归档  | `#/a/not-found-demo` · `#/a/archivedemo`                   |
| 无权限       | `#/forbidden`                                              |

### 管理端

| 页面                     | 路径                                                      |
|------------------------|---------------------------------------------------------|
| 登录                     | `#/admin/login`                                         |
| 强制改密                   | `#/admin/change-password`（密码 `changeme` 触发）             |
| 仪表盘                    | `#/admin`                                               |
| 应用列表 / 新建              | `#/admin/apps` · `#/admin/apps/new`                     |
| 应用详情（归档 · Yank · 上传）   | `#/admin/apps/app_moonnotes`                            |
| 编辑（slug 锁定）            | `#/admin/apps/app_moonnotes/edit`                       |
| 访问口令                   | `#/admin/access-codes`                                  |
| 任务队列（点行看日志）            | `#/admin/jobs`                                          |
| 用户（系统角色 admin \| user） | `#/admin/users`                                         |
| 设置                     | `#/admin/settings` · `?tab=general` \| `sync` \| `mail` |

业务规则以 [docs/PRD.md](../PRD.md) **v0.5.2** 为准。

## 与实现的关系

Vue3 实现时对齐本目录的信息架构与视觉；接口与权限以 PRD 为准。
