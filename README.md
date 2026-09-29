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

pnpm dev           # 同时起 API + Web；终端会打印实际端口
# 或分开：pnpm dev:server / pnpm dev:web
pnpm dev:worker    # 需本机 Redis；M0 仅连通探测
```

启动后看终端里带 `[urls]` 的绿色摘要（两端就绪后打印，且每分钟重刷一次，避免被 Nest 日志冲掉）：

```text
  AppDock 开发服务已就绪（本机 + 局域网）
  API   http://127.0.0.1:3080/api/v1
        http://192.168.x.x:3080/api/v1
  Web   http://127.0.0.1:5173/admin/login
        http://192.168.x.x:5173/admin/login
```

同一局域网设备用 **Web 的局域网地址** 打开即可（页面 `/api` 仍由 Vite 转到本机 API）。Windows 防火墙若拦截，需放行对应端口。

**M0 验收路径**：用终端打印的 Web 地址打开登录页 → `admin` + 初始密码 → 强制改密（≥8）→ `/admin`。  
Auth 冒烟（可选）：`cd apps/server && node scripts/run-with-env.cjs -- node scripts/auth-smoke.cjs`

> `pnpm seed` 幂等：已改密账号不会被重置。要再演强制改密，删 `data/appdock.db*` 后重新 `prisma:push` + `seed`。

## Docker Compose

```bash
# .env 中 JWT / Admin 等已配置；容器内 DB 固定为 file:/data/appdock.db
docker compose up -d --build
curl http://127.0.0.1:3080/api/v1/health
```

镜像同时提供 API 与 Web（`http://<主机>:3080/`）。

### 服务器自动更新

推送 `v*` tag 后，GitHub Actions 把镜像推到 GHCR。服务器只需拉镜像，不必在机器上编译。

1. `.env` 增加 `APPDOCK_IMAGE=ghcr.io/<owner>/appdock:latest`（仓库名小写）。
2. 发版工作流会把 GHCR 包设为 **public**（匿名可拉，不必 `docker login`）。公开后不能再改回私有。
3. 更新：`bash scripts/update.sh`（或 cron）。`./data` 与 `.env` 不会被覆盖。

不用 Docker、也不想在服务器编译源码：`v*` tag 的 Release 附带 `appdock-node.tgz`（已编译的 API、Worker、Web 和生产依赖）。解压后放 `.env`，本机装好 Redis 与 Node 20+：

```bash
mkdir -p /opt/appdock && cd /opt/appdock
curl -fsSL -o appdock-node.tgz \
  https://github.com/moon-stack-OAo/AppDock/releases/latest/download/appdock-node-linux.tgz
tar -xzf appdock-node.tgz --strip-components=1
cp .env.example .env   # 改密钥；DATABASE 用 file:data/appdock.db，REDIS 用 127.0.0.1
npx prisma db push
npx tsx prisma/seed.ts # 仅首次：按 .env 创建管理员
node dist/main.js      # 另开：node dist/worker.main.js
```

包按平台拆分，只含一套 Prisma 引擎：`linux`（OpenSSL 3 / glibc）、`linux-musl`、`darwin`、`darwin-arm64`、`windows`。文件名是 `appdock-node-<平台>.tgz`。

下次更新：`bash scripts/update-node.sh`。它读安装目录里的 `TARGET`（没有则按系统猜测），对照 `latest-<平台>.yml`；版本与本地 `VERSION` 相同则跳过，否则校验 sha256 后覆盖（保留 `.env` 与 `data/`），再 `prisma db push` 并重启。`scripts/update-host.sh` 仍是拉源码编译的备选。

服务：`api` · `worker` · `redis`；宿主机 `./data` → 容器 `/data`。  
镜像入口：`node dist/main.js` / `node dist/worker.main.js`（工作目录 `apps/server`）。

上线自检勾选见 [docs/ops/BACKUP.md](docs/ops/BACKUP.md) 与 PRD §14.3。

## 数据与备份（速查）

**一起备份**：`data/appdock.db*` + `data/files/`。  
**单独保管**：JWT、口令主密钥、GitHub Token、Webhook Secret、SMTP。  
细则：[docs/ops/BACKUP.md](docs/ops/BACKUP.md)。

## 里程碑

| 状态     | 里程碑                                                                 |
|--------|---------------------------------------------------------------------|
| **完成** | **M0** 脚手架 · Compose · 健康检查 · 种子 Admin · 强制改密 · 最小 Web              |
| **完成** | **M1** 用户(+email) · app_members · App CRUD · Storage · audit_events |
| **完成** | **M2** 手动上传（元数据）· 补传/覆盖 · yank · 删除产物 · 公开下载鉴权 API                  |
| **完成** | **M3** 队列 + GitHub Release 同步 + 任务详情/重试                             |
| **完成** | **M4** GitHub Webhook + 轮询兜底                                        |
| **完成** | **M5** 下载站页面 + 口令                                                   |
| **完成** | **M6** SMTP 通知                                                      |
| **完成** | **M7** 平台规则、队列看板、备份步骤与维护备份 API                                      |
| 下一步    | 二期：Gitee/GitLab                                                     |

## 预览设计稿

```bash
cd docs/design && npx --yes serve .
```

见 [docs/design/README.md](docs/design/README.md)。

## 许可

内部项目；以仓库最终声明为准。
