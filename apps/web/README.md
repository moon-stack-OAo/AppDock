# @appdock/web（M0）

管理端最小 Web：登录 + 强制改密 + 极简仪表盘。对接 Nest Auth API。

## 开发启动

仓库根目录：

```bash
# 1. API（:3080）
pnpm prisma:generate
pnpm prisma:push
pnpm seed
pnpm dev:server

# 2. Web（:5173，/api 代理到 3080）
pnpm dev:web
```

浏览器打开 <http://127.0.0.1:5173/admin/login>。

## 种子账号登录 → 强制改密

默认种子（见 `.env` / `.env.example`）：

| 字段 | 默认值 |
|------|--------|
| 用户名 | `admin` |
| 密码 | `change-me-on-first-boot` |
| 邮箱 | `admin@localhost` |

流程：

1. 登录页输入 `admin`（或邮箱）+ 初始密码。
2. 若 `mustChangePassword=true`，自动跳转 `/admin/change-password`。
3. 填写当前密码 + 新密码（≥8 位）→ 成功后进入 `/admin`。
4. 顶栏可「登出」。

> 若本地曾改过密，`pnpm seed` 不会重置密码（幂等）。需强制改密演示时，可删库后重新 `prisma:push` + `seed`，或直接改 DB 中该用户的 `mustChangePassword` / `passwordHash`。

## 类型检查 / 构建

```bash
pnpm --filter @appdock/web typecheck
pnpm --filter @appdock/web build
```

无需 server 即可通过 typecheck / build。

## 路由

| 路径 | 说明 |
|------|------|
| `/` | 下载站占位（M5） |
| `/admin/login` | 登录 |
| `/admin/change-password` | 强制改密（需已登录） |
| `/admin` | 极简仪表盘；未登录 → 登录；需改密 → 改密页 |

## 已知限制（M0）

- 无侧栏 / 应用管理等页面。
- accessToken 存 memory + `sessionStorage`；refresh 仅 Cookie。
- 401 会尝试 refresh 一次再重试；refresh 失败则清本地会话。
- 设计原型为 Hash 路由，本实现用 History 路由（Vite 开发/生产更自然）。
