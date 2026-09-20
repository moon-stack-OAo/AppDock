# AppDock 产品需求文档（PRD）与接口草案

> 版本：v0.2  
> 日期：2026-09-20  
> 状态：需求冻结（一期范围）  
> 关联结论：自建部署 · **NestJS + Vue3 + SQLite + Redis(BullMQ)** · 一期仅同步 GitHub Release · **多用户应用授权 + 多队列**

---

## 1. 背景与目标

### 1.1 背景

当前项目通过 GitHub Actions / Release 自动构建与发布。国内直连 GitHub 下载产物慢，且多仓库构建状态、版本包分散，缺少统一的内部管理与对外分发入口。

### 1.2 产品定位

**AppDock** = 应用构建与分发中心：

- **对内**：统一管理多应用、版本、同步任务与（二期）构建状态
- **对外**：按应用配置可见性，提供稳定、国内可达的下载入口
- **中间层**：从 GitHub 拉取正式包到自建存储，避免终端用户直连 GitHub

### 1.3 成功标准（一期）

| 指标 | 目标 |
|------|------|
| 同步时效 | Webhook 触发后通常 &lt; 2 分钟完成入库；轮询兜底 ≤ 配置间隔 |
| 下载体验 | 自建带宽可达，不依赖 GitHub CDN |
| 可见性 | 单应用可配：公开 / 口令 / 登录 |
| 可运维 | Docker Compose 一键启动；数据与文件可挂载备份 |

### 1.4 非目标（一期不做）

- GitHub Actions Artifact 同步（二期）
- 构建状态看板、CI 直传客户端 SDK 完善（二期）
- 多租户 SaaS、**自定义权限点**级 RBAC、计费（一期仅角色 + 应用级 permission）
- 自动更新协议完整实现（可预留简易 check-update API，二期深化）
- 替代 GitHub 本身作为源码托管

---

## 2. 用户与场景

### 2.1 角色

| 角色 | 说明 | 主要能力 |
|------|------|----------|
| 管理员（Admin） | 内部运维 | 全局设置、用户管理、**所有**应用 CRUD/同步 |
| 普通用户（User） | 内部成员 | 仅管理/查看**被授权**的应用；可触发同步（视授权） |
| 访客（Visitor） | 未登录 | 仅「公开」应用下载页与文件 |
| 口令用户 | 持有应用口令 | 访问「口令」可见应用（对外分发，非管理端） |

**一期授权模型（非自定义权限点 RBAC）**

- 系统角色：`admin` | `user`
- 应用成员表 `app_members`：`userId + appId + permission`
  - `viewer`：看版本/日志/下载元数据
  - `operator`：viewer + 手动同步、yank
  - `manager`：operator + 编辑应用配置、改可见性/口令、管理该应用成员（不可删应用除非 admin）
- Admin 隐式拥有全部应用的 manager 能力
- 对外 `visibility=login` 的下载：任意已登录用户即可下（与管理授权分离）；若需「仅成员可下」二期再加开关

### 2.2 核心场景

1. **发布同步**：GitHub 打 Tag / 发 Release → AppDock 自动拉取 assets → 管理端可见、下载页可下  
2. **对外分发**：用户打开 `https://dock.example.com/a/{slug}` 下载对应平台安装包  
3. **半公开分发**：内测应用设口令，分享链接 + 口令给测试同学  
4. **内部查看**：管理员查看同步日志、失败重试、手动触发同步  
5. **多应用统一入口**：首页/应用列表按权限展示可访问应用

---

## 3. 分期范围

### 3.1 一期 MVP（本文重点）

- [x] 应用（项目）管理：绑定 GitHub 仓库、slug、可见性、存储路径策略  
- [x] **多用户**：账号 CRUD、角色 admin/user、**按应用分配 viewer/operator/manager**  
- [x] **多队列**：`release-sync` / `asset-download` / `notify` 分队列 + 并发限流（BullMQ + Redis）  
- [x] Release 同步：Webhook + 定时轮询（可按应用开关）  
- [x] **手动上传**：可新建版本并上传多包，也可向已有版本补传；**admin + 应用 manager**；同名覆盖需确认  
- [x] 版本与产物入库：版本号、平台标签、文件元数据、changelog、来源（github/manual）  
- [x] 对外下载页 + 文件下载（鉴权随应用可见性）  
- [x] 管理后台：登录、用户与授权、应用、版本、上传、任务队列监控、同步日志、基础设置  
- [x] 存储：本地目录 + Storage 抽象（接口预留对象存储）  
- [x] 部署：Docker Compose（api + worker + redis + volume）+ SQLite  

### 3.2 二期

- Actions 构建状态聚合看板  
- Artifact 同步  
- CI 直传（workflow 上传 API）  
- 下载统计、旧版本清理策略  
- MinIO / S3 适配  
- 通知渠道落地（飞书/邮件/Webhook；一期队列与接口预留）  
- Worker 多实例水平扩展（同一 Redis 消费组）  
- 对外下载「仅应用成员可下」开关  

### 3.3 三期（可选）

- 客户端更新检测完整协议、灰度渠道  
- 签名校验展示、病毒扫描钩子  
- 自定义权限点 RBAC、完整审计日志  

---

## 4. 功能需求详述

### 4.1 应用（App）管理

**字段（逻辑模型）**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string (ulid/uuid) | 主键 |
| name | string | 展示名称 |
| slug | string | URL 友好唯一标识，如 `appdock` |
| description | string? | 简介 |
| githubOwner | string | 如 `myorg` |
| githubRepo | string | 如 `my-app` |
| visibility | enum | `public` \| `password` \| `login` |
| passwordHash | string? | visibility=password 时必填（存哈希） |
| syncWebhookEnabled | bool | 是否接受 Webhook |
| syncPollEnabled | bool | 是否参与轮询 |
| syncPollIntervalSec | int? | 覆盖全局默认间隔 |
| assetIncludeGlob | string? | 仅同步匹配的 asset 名，如 `*.exe,*.apk` |
| assetExcludeGlob | string? | 排除规则 |
| platformRules | json? | 文件名 → platform 推断规则 |
| latestReleaseOnly | bool | 默认 false；true 时只保留/只同步 latest |
| storagePrefix | string? | 相对存储根的前缀，默认按 slug |
| iconUrl | string? | 应用图标 |
| sortOrder | int | 列表排序 |
| status | enum | `active` \| `archived` |
| createdAt / updatedAt | datetime | |

**行为**

- 创建后可「立即同步一次」  
- 归档后：停止同步，下载页可配置为 404 或只读历史（一期：归档后对外 404，管理端仍可见）  
- slug 变更：一期禁止变更或仅管理员谨慎变更并写迁移说明（建议一期 **创建后不可改 slug**）

### 4.2 可见性与鉴权

| visibility | 下载页 | 文件下载 API | 管理 API |
|------------|--------|--------------|----------|
| public | 无需登录 | 无需登录 | 需 Admin |
| password | 需口令（Cookie/Token 会话） | 同上校验 | 需 Admin |
| login | 需登录用户 | 需登录用户 | 需 Admin |

**口令会话**：校验成功后发放短期 signed cookie / token（如 7 天，可配），仅绑定该 `appId`。

**管理端**：独立 Admin 账号（一期可单管理员 + 环境变量初始化；支持修改密码）。

### 4.3 Release 同步

#### 4.3.1 触发方式

1. **GitHub Webhook**  
   - 事件：`release`（published / edited / deleted 按策略处理）  
   - 校验：`X-Hub-Signature-256`（全局或按应用 secret）  
   - 匹配：payload 中 repository full_name → 绑定应用  

2. **定时轮询**  
   - 全局 cron + 每应用开关/间隔  
   - 调用 GitHub Releases API 比对 `tag_name` / `updated_at` / asset 列表  

3. **手动触发**  
   - 管理端「同步」按钮 → 入队异步任务  

> 一期不做 CI 直传与 Artifact；接口可预留 `POST /api/v1/ingest/...` 返回 501 或文档标注二期。

#### 4.3.2 同步流程

```
触发 → 鉴权/匹配 App → 拉取 Release 列表或单个 Release
     → 过滤 draft/prerelease（可配：默认同步 prerelease，不同步 draft）
     → 对每个 Release：upsert Version
     → 对每个 Asset：匹配 include/exclude → 下载到临时文件
     → 校验 size（及可选 sha256，若 GitHub/本地可提供）
     → 移动到 Storage → upsert Asset 记录
     → 写 SyncJob / SyncLog
```

**删除策略（一期）**

- GitHub Release deleted：标记本地 Version 为 `yanked`，文件默认保留（可手动删）  
- edited：更新 changelog/名称；asset 增删则增量同步  

**并发与限流**

- 同应用同时仅一个同步任务（队列互斥）  
- GitHub API：使用 PAT；尊重 rate limit，失败指数退避  

### 4.4 版本（Version）与产物（Asset）

**Version**

| 字段 | 说明 |
|------|------|
| id | 主键 |
| appId | 所属应用 |
| tagName | 如 `v1.2.3`（唯一：appId+tagName） |
| name | Release 标题 |
| body | changelog（markdown） |
| isPrerelease | bool |
| isLatest | bool（可按 semver 或 GitHub latest 标记维护） |
| publishedAt | GitHub 发布时间 |
| status | `active` \| `yanked` |
| source | `github_release` \| `manual`（二期：`artifact` / `ci_upload`） |
| githubReleaseId | 溯源（manual 可空） |
| createdByUserId | 手动创建时记录操作者 |

**Asset**

| 字段 | 说明 |
|------|------|
| id | 主键 |
| versionId | 所属版本 |
| name | 原始文件名 |
| platform | 归一化：`windows` \| `macos` \| `linux` \| `android` \| `ios` \| `web` \| `unknown` |
| arch | `x64` \| `arm64` \| `universal` \| `unknown` 等 |
| contentType | MIME |
| size | 字节 |
| checksumSha256 | 上传/同步后计算保存（一期建议必填落库） |
| storageKey | 存储路径键 |
| downloadCount | 简单计数 |
| githubAssetId | 溯源（手动上传可空） |
| source | `github_release` \| `manual` |
| uploadedByUserId | 手动上传操作者 |

### 4.4.1 手动上传安装包

**能力**

1. **新建版本并上传**：填写 `tagName` / 标题 / changelog / 是否预发布，一次可多文件  
2. **向已有版本补传**：选择已有 Version，追加平台包  
3. **同名覆盖**：若 `(versionId, fileName)` 已存在，必须显式 `overwrite=true`，否则 409；覆盖后替换存储文件与 size/sha256，**保留** downloadCount 与 asset id（或重建 id——一期约定：**保留 asset 记录 id，更新文件元数据**）

**权限**：仅 `admin` 或该应用 `manager`。

**约束**

- 单文件 ≤ `maxAssetSizeBytes`（全局配置）  
- 支持 `multipart/form-data`；大文件流式写入临时目录再 `Storage.put`  
- 可手动指定 `platform` / `arch`，缺省走文件名推断  
- 纯手动应用：可不填 GitHub 仓库；启用 Webhook/轮询时必须已绑定仓库  
- 与 GitHub 同步并存：同一 `tagName` 下允许既有 github 资产也有 manual 资产；同步时**不删除** `source=manual` 的文件（除非同名且策略另行约定——一期：GitHub 同名 asset 同步**不覆盖** manual，记 warning 日志）

**平台推断（默认规则，可被应用 platformRules 覆盖）**

- 文件名含 `win` / `.exe` / `.msi` / `setup` → windows  
- `mac` / `darwin` / `.dmg` / `.pkg` → macos  
- `linux` / `.AppImage` / `.deb` / `.rpm` → linux  
- `.apk` / `.aab` → android  
- `.ipa` → ios  
- 其余 → unknown（仍可下载）

### 4.5 对外下载页

- 路由建议：  
  - `/` 可访问应用列表（按当前身份过滤）  
  - `/a/:slug` 应用详情：最新版 + 历史版本折叠  
  - `/a/:slug/v/:tag` 指定版本  
- 展示：应用名、简介、changelog、按平台分组的下载按钮、文件大小、发布时间  
- SEO/分享：一期基础 title/description 即可  
- 口令墙：拦截页输入口令  

### 4.6 管理后台

页面（一期）：

1. 登录  
2. 仪表盘：应用数、最近同步、队列失败任务  
3. 用户管理（admin）：创建用户、禁用、重置密码  
4. 应用列表 / 创建编辑（含成员授权）  
5. 应用详情：版本列表、**手动上传**、手动同步、Webhook 说明  
6. 任务 / 同步日志（按队列查看 job）  
7. 系统设置：GitHub PAT、默认轮询间隔、存储根只读、站点名称、上传大小上限  

### 4.7 系统配置（全局）

| 键 | 说明 |
|----|------|
| siteName | 站点名称 |
| publicBaseUrl | 对外根 URL（生成 Webhook/下载链接） |
| githubToken | PAT（server 环境变量优先，DB 可存加密引用） |
| webhookSecret | 默认 Webhook 密钥 |
| defaultPollIntervalSec | 如 300 |
| storageRoot | 容器内路径，如 `/data/files` |
| maxAssetSizeBytes | 单文件上限 |
| sessionSecret | 会话签名 |

敏感项：**优先环境变量**，管理端仅显示「已配置/未配置」。

---

## 5. 技术架构（草案）

### 5.1 技术选型（已定）

| 层 | 选型 | 说明 |
|----|------|------|
| API | **NestJS** | Module/Guard 适合多用户授权；`@nestjs/bullmq`、Schedule 成熟 |
| Web | Vue3 + Vue Router | 管理端 + 下载站单应用分路由 |
| DB | SQLite | 单机零运维；Prisma 或 Drizzle |
| 队列 | **Redis + BullMQ** | 多队列、并发限流、失败重试 |
| 存储 | 本地目录 + Storage 接口 | 二期 MinIO/S3 |

**选型说明**：一期即要应用级授权与多队列编排，选 NestJS 降低长期胶水成本（不再用 Fastify）。

### 5.2 逻辑架构

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Vue3 Web   │────▶│  NestJS API      │────▶│  SQLite     │
│ 管理端+下载页 │     │  Auth / Apps     │     └─────────────┘
└─────────────┘     │  Members / Guard │
                    │  Upload / Sync   │     ┌─────────────┐
                    │  Download        │────▶│ Local FS    │
                    └────────┬─────────┘     └─────────────┘
                             │ enqueue
                             ▼
                    ┌──────────────────┐
                    │ Redis + BullMQ   │
                    │ release-sync     │
                    │ asset-download   │
                    │ notify           │
                    └────────┬─────────┘
                             ▼
                    ┌──────────────────┐
                    │ NestJS Worker    │──▶ GitHub API / Storage
                    │ (同镜像不同入口)  │
                    └──────────────────┘
```

### 5.3 推荐仓库结构

```
AppDock/
  apps/server/                 # NestJS：API + Worker 同包
    src/
      modules/auth|users|apps|sync|storage|queues|upload/
      main.ts                  # API
      worker.main.ts           # Worker
  apps/web/
  packages/shared/
  data/
  docker-compose.yml           # api / worker / redis
  docs/PRD.md
```

### 5.4 进程与队列模型（一期）

- **api**：HTTP、鉴权、入队、**手动上传落盘**、用户下载流式输出  
- **worker**：消费队列（GitHub 拉取等）；同镜像不同 command  
- **redis**：BullMQ  

| 队列名 | 职责 | 建议并发 | 备注 |
|--------|------|----------|------|
| `release-sync` | 拉 Release 元数据、投递 asset 下载 | 1～2，同 app 互斥 | jobId 按 app 去重 |
| `asset-download` | 从 GitHub 下载 asset 落盘 | 2～4 | 限流 + 体积校验 |
| `notify` | 成功/失败通知（一期可写日志） | 2 | 二期接飞书/邮件 |

手动上传**不走** `asset-download`（文件已在请求中），直接 API → Storage → DB；可选事后投递 `notify`。

---

## 6. 数据模型（表草案）

### 6.1 users

| 列 | 类型 | 说明 |
|----|------|------|
| id | text PK | |
| username | text unique | |
| password_hash | text | |
| role | text | `admin` \| `user` |
| status | text | `active` \| `disabled` |
| created_at | text/datetime | |

### 6.1.1 app_members

| 列 | 类型 | 说明 |
|----|------|------|
| id | text PK | |
| app_id | text | |
| user_id | text | |
| permission | text | `viewer` \| `operator` \| `manager` |
| created_at | text/datetime | |

唯一索引：`(app_id, user_id)`。

### 6.2 apps

见 4.1；索引：`slug` unique，`(github_owner, github_repo)` unique。  
说明：应用可不绑定 GitHub（仅手动上传场景）；`githubOwner/Repo` 可空，但开启同步时必填。

### 6.3 versions

唯一索引：`(app_id, tag_name)`。

### 6.4 assets

索引：`version_id`；可选 `(version_id, name)` unique。

### 6.5 sync_jobs

| 列 | 说明 |
|----|------|
| id | |
| app_id | |
| trigger | `webhook` \| `poll` \| `manual` |
| status | `queued` \| `running` \| `success` \| `failed` |
| message | 错误摘要 |
| started_at / finished_at | |
| stats_json | 如 `{ syncedReleases:1, syncedAssets:3 }` |

### 6.6 sync_logs

明细行：job_id、level、message、created_at（可按 job 查询）。

### 6.7 download_events（一期可选轻量）

asset_id、ip_hash、user_agent、created_at；或仅 `assets.download_count++`。

### 6.8 app_password_sessions（或用签名 cookie 无表）

一期可用 **HMAC 签名 cookie**，减少表。

---

## 7. 接口草案（HTTP API）

约定：

- Base：`/api/v1`  
- 管理端 JSON；错误格式统一：

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "人可读说明",
    "details": {}
  }
}
```

- 鉴权：  
  - Admin / User：`Authorization: Bearer <access_token>` 或 HttpOnly Session Cookie  
  - App 口令：`Cookie: app_access=<token>` 或头 `X-App-Password-Token`  
- 分页：`?page=1&pageSize=20` → `{ items, total, page, pageSize }`

---

### 7.1 认证

#### `POST /api/v1/auth/login`

```json
// req
{ "username": "admin", "password": "***" }
// res
{ "token": "...", "user": { "id": "...", "username": "admin", "role": "admin" } }
```

#### `POST /api/v1/auth/logout`

#### `GET /api/v1/auth/me`

---

### 7.2 应用口令

#### `POST /api/v1/public/apps/:slug/unlock`

```json
// req
{ "password": "plain" }
// res
{ "ok": true }  // Set-Cookie
```

#### `POST /api/v1/public/apps/:slug/lock`

清除口令会话。

---

### 7.3 公开/半公开：应用与下载元数据

> 服务端按 visibility + 当前身份过滤；无权限返回 401/403（不暴露是否存在时可统一 404，**一期建议：slug 不存在 404；无权限 401/403**）。

#### `GET /api/v1/public/apps`

列表（仅当前身份可见）。

#### `GET /api/v1/public/apps/:slug`

```json
{
  "app": {
    "name": "My App",
    "slug": "my-app",
    "description": "...",
    "visibility": "public",
    "iconUrl": null
  },
  "latest": {
    "tagName": "v1.2.0",
    "name": "1.2.0",
    "body": "...",
    "publishedAt": "2026-09-01T12:00:00Z",
    "isPrerelease": false,
    "assets": [
      {
        "id": "...",
        "name": "MyApp-Setup-1.2.0.exe",
        "platform": "windows",
        "arch": "x64",
        "size": 12345678,
        "downloadUrl": "/api/v1/public/apps/my-app/assets/{id}/download"
      }
    ]
  }
}
```

#### `GET /api/v1/public/apps/:slug/versions`

分页历史版本（可 `?includePrerelease=true`）。

#### `GET /api/v1/public/apps/:slug/versions/:tag`

#### `GET /api/v1/public/apps/:slug/assets/:assetId/download`

- 鉴权通过后：流式下载，`Content-Disposition: attachment`  
- 校验 Referer 一期不做  
- 计数 +1  

#### `GET /api/v1/public/apps/:slug/updates/check`（一期可选简易）

```
?currentVersion=1.0.0&platform=windows&arch=x64
```

```json
{
  "updateAvailable": true,
  "tagName": "v1.2.0",
  "asset": { "id": "...", "name": "...", "size": 1, "sha256": "..." }
}
```

---

### 7.4 管理端：用户（admin）

#### `GET /api/v1/admin/users`

#### `POST /api/v1/admin/users`

```json
{ "username": "alice", "password": "***", "role": "user" }
```

#### `PATCH /api/v1/admin/users/:id`

可改 `role` / `status`；重置密码传 `password`。

---

### 7.5 管理端：应用与成员

#### `GET /api/v1/admin/apps`

返回当前用户可见应用：admin 全部；user 仅 `app_members` 中的。

#### `POST /api/v1/admin/apps`

权限：admin（一期创建应用仅 admin；二期可放开 manager 自建）。

```json
{
  "name": "My App",
  "slug": "my-app",
  "description": "",
  "githubOwner": "org",
  "githubRepo": "repo",
  "visibility": "password",
  "password": "optional-plain-on-create",
  "syncWebhookEnabled": true,
  "syncPollEnabled": true,
  "assetIncludeGlob": "*.exe,*.apk,*.dmg,*.zip",
  "syncPrerelease": true
}
```

`githubOwner` / `githubRepo` 可省略（纯手动分发应用）。

#### `GET /api/v1/admin/apps/:id`

含 webhookUrl：`{publicBaseUrl}/api/v1/hooks/github`；需对该应用至少 viewer。

#### `PATCH /api/v1/admin/apps/:id`

不可改 slug。需 manager+。改 password 时传新明文。

#### `DELETE /api/v1/admin/apps/:id`

仅 admin。软删/归档；`?purgeFiles=true` 默认 false。

#### `GET /api/v1/admin/apps/:id/members`

#### `PUT /api/v1/admin/apps/:id/members`

```json
{ "userId": "...", "permission": "manager" }
```

权限：admin 或该应用 manager。

#### `DELETE /api/v1/admin/apps/:id/members/:userId`

---

### 7.6 管理端：版本、产物与手动上传

#### `GET /api/v1/admin/apps/:id/versions`

需 viewer+。

#### `POST /api/v1/admin/apps/:id/versions`

仅创建版本元数据（无文件）。需 manager+。

```json
{
  "tagName": "v1.2.0",
  "name": "1.2.0",
  "body": "changelog",
  "isPrerelease": false,
  "publishedAt": "2026-09-20T00:00:00Z"
}
```

#### `POST /api/v1/admin/apps/:id/versions/upload`

**新建版本 + 多文件上传**（multipart）。需 manager+。

- 字段：`tagName`（必填）、`name`、`body`、`isPrerelease`、`overwrite`（默认 false）  
- 文件：`files`（多文件）或 `file`  
- 可选每文件：`platform` / `arch`（JSON 数组字段或 `platforms[]` 与文件顺序对齐）  

成功返回 version + assets。

#### `POST /api/v1/admin/versions/:versionId/assets/upload`

**向已有版本补传**（multipart）。需 manager+。

- 字段：`overwrite`（默认 false；同名无 overwrite → **409**）  
- 文件：`files` / `file`  
- 可选 `platform` / `arch`  

#### `POST /api/v1/admin/versions/:versionId/yank`

需 operator+。

#### `DELETE /api/v1/admin/assets/:assetId`

需 manager+。删除 DB + 存储文件。

---

### 7.7 同步与队列

#### `POST /api/v1/admin/apps/:id/sync`

需 operator+。应用须已绑定 GitHub。

```json
{ "tagName": "v1.2.0" }
```

```json
{ "jobId": "..." }
```

入队 `release-sync`。

#### `GET /api/v1/admin/queue/jobs`

查询参数：`queue`、`status`、`appId`、分页。需对该 app viewer+（或 admin 看全局）。

#### `GET /api/v1/admin/queue/jobs/:jobId`

含 logs。

#### `POST /api/v1/admin/queue/jobs/:jobId/retry`

需 operator+。

#### `GET /api/v1/admin/sync-jobs`（可与 queue 合并实现，保留别名）

#### `POST /api/v1/hooks/github`

- 验签 → 快速 200 → 入队 `release-sync`  
- 未匹配应用：记 ignored，仍 200  

---

### 7.8 系统

#### `GET /api/v1/admin/settings`

脱敏返回。

#### `PATCH /api/v1/admin/settings`

仅非敏感或「轮询间隔、站点名」等；Token 通过环境变量/`PUT` 专门接口写（可选）。

#### `GET /api/v1/health`

```json
{ "ok": true, "db": true, "storage": true, "redis": true }
```

---

### 7.9 二期预留（文档占位，一期可不实现）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/ingest/ci/:appId` | CI 直传，Token 鉴权 |
| POST | `/api/v1/admin/apps/:id/sync-artifacts` | Artifact 同步 |
| GET | `/api/v1/admin/builds` | 构建看板 |

---

## 8. Webhook 配置说明（给管理员）

1. GitHub Repo → Settings → Webhooks → Add  
2. Payload URL：`{publicBaseUrl}/api/v1/hooks/github`  
3. Content type：`application/json`  
4. Secret：与 AppDock 中配置一致  
5. Events：选 `Releases`  
6. 确保 AppDock 能被 GitHub 访问（公网或 tunnel）；若不能，依赖轮询即可  

---

## 9. 存储抽象

```ts
interface Storage {
  put(key: string, srcPath: string): Promise<void>
  openReadStream(key: string): Promise<Readable>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  // 二期: signedUrl(key, ttl): Promise<string>
}
```

**本地键规范**：`{storagePrefix}/{tagName}/{assetFileName}`  
例：`my-app/v1.2.0/MyApp-Setup-1.2.0.exe`

---

## 10. 非功能需求

| 类别 | 要求 |
|------|------|
| 安全 | PAT/口令/管理员密码不明文落库；Webhook 验签；下载鉴权与可见性一致；限制上传/同步体积 |
| 性能 | 下载支持流式；同步不阻塞 API；大文件不整包进内存 |
| 可靠 | 同步失败可重试；任务状态可查；GitHub 限流可感知 |
| 可运维 | Compose 部署；`/data` 挂载；健康检查；结构化日志 |
| 兼容 | Node 20+；现代浏览器；SQLite 单机写为主 |

---

## 11. 页面信息架构（Web）

### 11.1 下载站（公开侧）

- 首页应用列表  
- 应用详情 / 版本详情  
- 口令解锁页  
- 登录页（visibility=login）

### 11.2 管理端

- `/admin/login`  
- `/admin` 仪表盘  
- `/admin/apps`  
- `/admin/apps/:id`  
- `/admin/jobs`  
- `/admin/settings`  

一期可采用 Vue3 + Vue Router + 朴素 UI（如 Naive UI / Element Plus）。

---

## 12. 里程碑建议

| 里程碑 | 交付 | 预估量级 |
|--------|------|----------|
| M0 | NestJS 脚手架、Compose（api/worker/redis）、健康检查、Admin 登录 | 小 |
| M1 | 用户 + app_members 授权、App CRUD、本地 Storage | 中 |
| M2 | **手动上传**（新建版本/补传/覆盖确认）+ 下载鉴权打通 | 中 |
| M3 | BullMQ 多队列 + GitHub Release 同步 + 日志/重试 | 中 |
| M4 | Webhook + 轮询 | 小 |
| M5 | 公开下载页 + 三种可见性 + 极简更新检查 API | 中 |
| M6 | 打磨：平台推断、队列看板、备份说明 | 小 |

---

## 13. 待决事项（实现前可再定，不阻塞 PRD）

1. ~~Fastify vs Nest~~ → **已定 NestJS**。  
2. 前端单体 vs 拆包：一期 **单 Vue 应用分路由**。  
3. 「最新版」：优先 GitHub `latest`，否则最高非 prerelease tag；纯手动应用由管理员标记或按 semver。  
4. 更新检查 API：一期 **做极简版**。  
5. ORM：Prisma vs Drizzle —— 实现时二选一，推荐 **Prisma**（与 Nest 资料多）。  
6. 上传是否支持断点续传：一期 **不做**；超大文件靠调高反向代理/`maxAssetSizeBytes`。  

---

## 14. 附录：环境变量草案

```bash
APPDOCK_PORT=3080
APPDOCK_PUBLIC_BASE_URL=https://dock.example.com
APPDOCK_DATABASE_URL=file:/data/appdock.db
APPDOCK_STORAGE_ROOT=/data/files
APPDOCK_SESSION_SECRET=change-me
APPDOCK_GITHUB_TOKEN=ghp_xxx
APPDOCK_WEBHOOK_SECRET=whsec_xxx
APPDOCK_ADMIN_USERNAME=admin
APPDOCK_ADMIN_PASSWORD=change-me-on-first-boot
APPDOCK_DEFAULT_POLL_INTERVAL_SEC=300
APPDOCK_REDIS_URL=redis://redis:6379
APPDOCK_QUEUE_DOWNLOAD_CONCURRENCY=3
APPDOCK_MAX_ASSET_SIZE_BYTES=1073741824
```

---

## 15. 文档修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-09-20 | 首版：需求冻结 + 接口草案 |
| v0.2 | 2026-09-20 | 改为 NestJS；多用户应用授权；BullMQ 多队列；手动上传 |
| v0.2.1 | 2026-09-20 | 设计稿迁入 `docs/design/`（index.html + DESIGN.md） |
