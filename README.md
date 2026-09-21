# AppDock

自托管**应用分发中心**：同步上游 Release（一期仅 GitHub）或手动上传安装包到自建存储，再按「公开 / 口令 / 登录」对外提供国内可达下载。

**一期做什么 / 不做什么**

| 做                     | 不做                          |
|-----------------------|-----------------------------|
| Release 同步、手动上传、门禁下载站 | CI 构建、Actions Artifact、构建看板 |
| 本地落盘 + 队列（BullMQ）     | CDN / 对象存储落地（仅预留接口）         |
| 口令中心、应用成员授权、SMTP 通知   | 完整审计平台、SSO、多租户 SaaS         |

细节见 [docs/PRD.md](docs/PRD.md)（当前 **v0.5.2**）。

|    |                                                |
|----|------------------------------------------------|
| 需求 | 已冻结（PRD v0.5.2）                                |
| 设计 | [`docs/design/`](docs/design/) 可交互原型           |
| 代码 | **M0 完成**：脚手架 · Auth · 强制改密 · 最小 Web · Compose |

## 文档索引

| 文档                                       | 内容              |
|------------------------------------------|-----------------|
| [docs/PRD.md](docs/PRD.md)               | 需求、模型、API、环境变量  |
| [docs/design/](docs/design/)             | UI 原型与设计约定      |
| [docs/ops/BACKUP.md](docs/ops/BACKUP.md) | 备份、恢复、密钥（上线前必读） |
| [apps/web/README.md](apps/web/README.md) | Web 开发与登录流程     |
| [.env.example](.env.example)             | 环境变量模板          |

## 技术栈（一期）

- **API / Worker**：NestJS（同镜像、不同入口）
- **Web**：Vue3 + Vue Router + Vite
- **数据库**：SQLite + **Prisma**（**单机单写**）
- **队列**：Redis + BullMQ（M3 起消费；M0 Worker 仅探测 Redis）
- **文件**：本地目录；Storage 抽象预留二期 S3/MinIO

## 目录结构

```text
apps/server/      NestJS API + Worker
apps/web/         Vue3（登录 / 强制改密 / 仪表盘占位）
packages/shared/  共用常量
data/             SQLite + files（勿提交）
docker-compose.yml
Dockerfile
docs/
```

## 本地开发

```bash
cp .env.example .env
```

本地 `.env` 建议：

```env
APPDOCK_DATABASE_URL=file:data/appdock.db
APPDOCK_STORAGE_ROOT=data/files
APPDOCK_REDIS_URL=redis://127.0.0.1:6379
APPDOCK_JWT_SECRET=dev-only-change-me
APPDOCK_ADMIN_USERNAME=admin
APPDOCK_ADMIN_PASSWORD=change-me-on-first-boot
```

```bash
pnpm install
pnpm build:shared
pnpm prisma:generate
pnpm prisma:push
pnpm seed

pnpm dev:server    # :3080  → GET /api/v1/health
pnpm dev:web       # :5173  → /admin/login（/api 代理到 3080）
pnpm dev:worker    # 需本机 Redis；M0 仅连通探测
```

**M0 验收路径**：打开 `http://127.0.0.1:5173/admin/login` → `admin` + 初始密码 → 强制改密（≥8）→ `/admin`。  
Auth 冒烟（可选）：`cd apps/server && node scripts/run-with-env.cjs -- node scripts/auth-smoke.cjs`

> `pnpm seed` 幂等：已改密账号不会被重置。要再演强制改密，删 `data/appdock.db*` 后重新 `prisma:push` + `seed`。

## Docker Compose

```bash
# .env 中 JWT / Admin 等已配置；容器内 DB 固定为 file:/data/appdock.db
docker compose up -d --build
curl http://127.0.0.1:3080/api/v1/health
```

服务：`api` · `worker` · `redis`；宿主机 `./data` → 容器 `/data`。  
镜像入口：`node dist/main.js` / `node dist/worker.main.js`（工作目录 `apps/server`）。

上线自检勾选见 [docs/ops/BACKUP.md](docs/ops/BACKUP.md) 与 PRD §14.3。

## 数据与备份（速查）

**一起备份**：`data/appdock.db*` + `data/files/`。  
**单独保管**：JWT、口令主密钥、GitHub Token、Webhook Secret、SMTP。  
细则：[docs/ops/BACKUP.md](docs/ops/BACKUP.md)。

## 里程碑

| 状态     | 里程碑                                                                  |
|--------|----------------------------------------------------------------------|
| **完成** | **M0** 脚手架 · Compose · 健康检查 · 种子 Admin · 强制改密 · 最小 Web               |
| 下一步    | **M1** 用户(+email) · app_members · App CRUD · Storage · audit_events  |
| 其后     | M2 上传/yank/归档 → M3 队列+GitHub → M4 Hook → M5 下载站+口令 → M6 SMTP → M7 打磨 |

## 预览设计稿

```bash
cd docs/design && npx --yes serve .
```

见 [docs/design/README.md](docs/design/README.md)。

## 许可

内部项目；以仓库最终声明为准。
