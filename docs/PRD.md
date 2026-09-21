# AppDock 产品需求文档（PRD）与接口草案

> 版本：v0.5.1  
> 日期：2026-09-21  
> 状态：需求冻结（一期范围）  
> 关联结论：自建部署 · **NestJS + Vue3 + SQLite + Redis(BullMQ)** · **多源 Release 模型（一期仅实现 GitHub；Gitee/GitLab 二期）** · **多用户应用授权 + 多队列** · **一期=分发/同步，非 CI 构建** · 登录标识 username\|email

---

## 1. 背景与目标

### 1.1 背景

当前项目通过各托管平台的 CI / Release 自动构建与发布。国内直连 GitHub 下载产物慢；团队也可能使用 Gitee、GitLab 等同类 Release。多仓库版本包分散，缺少统一的内部管理与对外分发入口。

### 1.2 产品定位

**AppDock** = 应用**分发**中心（对外可称「构建与分发」，一期实际范围见 §1.2.1）：

- **对内**：多应用、版本、同步任务的统一管理（构建看板 / CI 直传 → 二期）
- **对外**：按可见性提供稳定、国内可达的下载入口
- **中间层**：从可配置的 Release 源拉取**已发布**安装包到自建存储，避免终端直连上游 CDN（尤其 GitHub）

#### 1.2.1 一期范围声明（必读）

| 一期是                                | 一期不是                          |
|------------------------------------|-------------------------------|
| Release **镜像 / 同步** + 手动上传 + 门禁下载站 | CI 流水线、编译、Actions Artifact 拉取 |
| 自建落盘与国内可达下载                        | CDN / 对象存储落地（仅接口预留）           |
| 口令中心 + 应用成员授权                      | 完整审计平台、SSO、多租户 SaaS           |
| 极简 `updates/check`                 | Sparkle / 灰度 / 强制更新完整协议       |

上游「各平台 CI 已构建好的 Release」是输入；AppDock 一期是 **分发与同步层**，不是构建系统。

### 1.3 成功标准（一期）

| 指标   | 目标                                      |
|------|-----------------------------------------|
| 同步时效 | Webhook 触发后通常 &lt; 2 分钟完成入库；轮询兜底 ≤ 配置间隔 |
| 下载体验 | 自建带宽可达，不依赖上游（如 GitHub）CDN               |
| 可见性  | 单应用可配：公开 / 口令 / 登录（见 4.2 语义注意）          |
| 可运维  | Compose 一键启动；`/data` 可挂载备份；敏感操作有最低审计    |

### 1.4 非目标（一期不做）

- **Gitee / GitLab Release 同步的具体实现**（模型与接口预留；实现放二期）
- GitHub Actions Artifact 同步（二期）
- **构建状态看板、CI 直传**（二期；勿按「构建中心」理解一期交付）
- 多租户 SaaS、**自定义权限点**级 RBAC、计费（一期仅角色 + 应用级 permission）
- 自动更新协议完整实现（可预留简易 check-update API，二期深化）
- 替代各托管平台本身作为源码托管
- 下载防盗链 / IP 限流报表 / 断点续传（刻意不做；`download_count` 仅简单计数）
- 多 API 实例并发写同一 SQLite（一期 **单机单写**）

---

## 2. 用户与场景

### 2.1 角色

| 角色          | 说明         | 主要能力                                               |
|-------------|------------|----------------------------------------------------|
| 管理员（Admin）  | 内部运维       | 全局设置、用户管理、**所有**应用 CRUD/同步                         |
| 普通用户（User）  | 内部成员       | 仅管理/查看**被授权**的应用；可触发同步（视授权）                        |
| 访客（Visitor） | 未登录        | 仅「公开」应用下载页与文件                                      |
| 口令访客        | 持有**访问口令** | 仅解锁下载站中被该口令授权的 `visibility=password` 应用；**不能**进管理端 |

**一期授权模型（非自定义权限点 RBAC）**

- 系统角色：`admin` | `user`
- 应用成员表 `app_members`：`userId + appId + permission`
    - `viewer`：看版本/日志/下载元数据
    - `operator`：viewer + 手动同步、yank
    - `manager`：operator + 编辑应用配置、改可见性、管理该应用成员（不可删应用除非 admin）；**不可**全局签发跨应用口令（除非 admin）
- Admin 隐式拥有全部应用的 manager 能力
- **访问口令**：由 admin（一期）在「口令中心」统一签发；一条口令可绑定多个 `password` 应用
- 用户须有 **email**（通知「通知应用成员」依赖此字段；无邮箱则该成员不进入收件人并记 warning）

### 2.2 核心场景

1. **发布同步**：上游（一期 GitHub）打 Tag / 发 Release → AppDock 按 Provider 拉取 assets → 管理端可见、下载页可下
2. **对外分发**：用户打开 `https://dock.example.com/a/{slug}` 下载对应平台安装包
3. **半公开分发**：应用设为「口令」可见 → 管理员在口令中心生成带期限/次数的访问口令 → 分享链接 + 口令给测试同学
4. **内部查看**：管理员查看同步日志、失败重试、手动触发同步
5. **多应用统一入口**：首页/应用列表按权限展示可访问应用
6. **口令运维**：停用泄露口令、查看最近使用、到期自动失效

---

## 3. 分期范围

### 3.1 一期 MVP（本文重点）

- [x] 应用（项目）管理：绑定 **Release 源**（`releaseProvider` + owner/repo）、slug、可见性、存储路径策略
- [x] **多源模型**：`ReleaseProvider` 抽象（`none` | `github` | `gitee` | `gitlab`）；一期 **仅实现 `github`**；选 `gitee`/`gitlab` 时管理端提示「二期」且同步 API 返回明确错误
- [x] **多用户**：账号 CRUD、角色 admin/user、**按应用分配 viewer/operator/manager**
- [x] **多队列**：`release-sync` / `asset-download` / `notify` 分队列 + 并发限流（BullMQ + Redis）
- [x] Release 同步（GitHub）：Webhook + 定时轮询（可按应用开关）
- [x] **手动上传**：可新建版本并上传多包，也可向已有版本补传；**admin + 应用 manager**；同名覆盖需确认
- [x] 版本与产物入库：版本号、平台标签、文件元数据、changelog、来源（`github_release` / `manual`；二期扩展 gitee/gitlab）
- [x] 对外下载页 + 文件下载（鉴权随应用可见性）
- [x] **访问口令中心**：生成/复制/启用停用、过期时间、绑定多应用、最大使用次数、备注、创建人、最近使用；仅解锁下载站
- [x] 管理后台：登录、用户与授权、应用、版本、上传、**口令**、任务队列监控、同步日志、基础设置
- [x] **邮件通知（SMTP）**：同步成功/失败、手动上传成功；应用级开关与收件人；成功邮件含各平台下载链接；走 `notify` 队列
- [x] 存储：本地目录 + Storage 抽象（接口预留对象存储）
- [x] 部署：Docker Compose（api + worker + redis + volume）+ SQLite

### 3.2 二期

- **Gitee Release 同步**（Webhook + API 轮询 + Token）
- **GitLab Release / Package 同步**（含自建实例 `releaseBaseUrl`；Webhook + API）
- Actions 构建状态聚合看板
- Artifact 同步
- CI 直传（workflow 上传 API）
- 下载统计、旧版本清理策略
- 口令增强：一次性口令、IP 限制、按应用 manager 自助签发（仅本应用）
- **口令即将过期 / 次数将尽**邮件提醒（定时扫描）
- MinIO / S3 适配
- 飞书 / 自定义 Webhook 通知渠道
- 通知发送日志页与手动重试打磨
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

| 字段                    | 类型                 | 说明                                                       |
|-----------------------|--------------------|----------------------------------------------------------|
| id                    | string (ulid/uuid) | 主键                                                       |
| name                  | string             | 展示名称                                                     |
| slug                  | string             | URL 友好唯一标识，如 `appdock`                                   |
| description           | string?            | 简介                                                       |
| releaseProvider       | enum               | `none` \| `github` \| `gitee` \| `gitlab`；默认 `none`（纯手动） |
| releaseOwner          | string?            | 用户/组织/命名空间，如 `myorg`（对应原 githubOwner）                    |
| releaseRepo           | string?            | 仓库名，如 `my-app`（对应原 githubRepo）                           |
| releaseBaseUrl        | string?            | 自建实例根 URL（主要用于 `gitlab`；`github`/`gitee` 公有云可空）          |
| releaseProjectId      | string?            | 可选；GitLab 数字 project id（二期；有则优先于 owner/repo 解析）          |
| visibility            | enum               | `public` \| `password` \| `login`                        |
| syncWebhookEnabled    | bool               | 是否接受 Webhook（仅已实现 Provider）                              |
| syncPollEnabled       | bool               | 是否参与轮询                                                   |
| syncPollIntervalSec   | int?               | 覆盖全局默认间隔                                                 |
| assetIncludeGlob      | string?            | 仅同步匹配的 asset 名，如 `*.exe,*.apk`                           |
| assetExcludeGlob      | string?            | 排除规则                                                     |
| platformRules         | json?              | 文件名 → platform 推断规则                                      |
| latestReleaseOnly     | bool               | 默认 false；true 时只保留/只同步 latest                            |
| storagePrefix         | string?            | 相对存储根的前缀，默认按 slug                                        |
| iconUrl               | string?            | 应用图标                                                     |
| sortOrder             | int                | 列表排序                                                     |
| status                | enum               | `active` \| `archived`                                   |
| createdAt / updatedAt | datetime           |                                                          |

> **兼容说明**：接口/文档中可继续接受别名 `githubOwner` / `githubRepo`（写入时映射为 `releaseOwner` / `releaseRepo`，并隐含 `releaseProvider=github`）；新实现以 `release*` 字段为准。**已废弃**应用级 `passwordHash`。

**行为**

- 创建后可「立即同步一次」（仅当 Provider 已实现）
- 归档后：停止同步；**对外统一 404**（不暴露「已归档」细节亦可，原型可用 410 示意）；管理端仍可见并可取消归档
- slug 变更：一期 **创建后不可改 slug**（编辑表单锁定）
- `releaseProvider=none`：仅手动上传；禁止开启 Webhook/轮询
- `releaseProvider` 为 `gitee` / `gitlab`：一期允许保存配置与展示，但 **同步/Webhook 入队返回 `501 PROVIDER_NOT_IMPLEMENTED`**；UI 标注「二期」
- 唯一约束：当 Provider ≠ `none` 时，`(release_provider, release_owner, release_repo, coalesce(release_base_url,''))` 唯一

### 4.2 可见性与鉴权

| visibility | 下载页           | 文件下载 API | 管理 API       |
|------------|---------------|----------|--------------|
| public     | 无需登录          | 无需登录     | 需登录用户 + 应用授权 |
| password   | 需有效**访问口令**会话 | 同上       | 需登录用户 + 应用授权 |
| login      | 需登录用户         | 需登录用户    | 需登录用户 + 应用授权 |

> **⚠ `login` ≠「仅应用成员可下」**  
> 一期：`visibility=login` = **任意已登录系统账号**均可打开下载页并下载（与 `app_members` **无关**）。  
> 「仅该应用成员可下」属二期开关。配置时勿把 login 当成成员门禁。

应用设为 `password` **不再**在应用表存单一固定口令；改为「需要访问口令中心签发的、且绑定了本应用的有效口令」。

下载站另须支持：

- 口令会话 **退出**（`POST .../lock` 清 cookie）
- 登录用户顶栏展示身份与 **登出**（与管理端 JWT 会话可共用 refresh，UI 分区）

### 4.2.1 访问口令中心（Access Codes）

**定位**：对外半公开分发的凭证池；**仅解锁下载站**，与管理端账号体系完全分离。

**推荐模型（已定）**：全局「访问口令」→ 可绑定 1～N 个 `visibility=password` 的应用。

| 字段                    | 说明                                  |
|-----------------------|-------------------------------------|
| id                    | 主键                                  |
| label / note          | 备注（如「Q3 内测群」）                       |
| codeHash              | 口令哈希（用于校验解锁，不可逆）                    |
| codeEnc               | 服务端主密钥加密的明文密文（AES-GCM），供管理端「再复制」解密  |
| codePrefix            | 明文前缀，列表展示 `dock_ab12••••` 便于辨认      |
| status                | `active` \| `disabled` \| `expired` |
| expiresAt             | 过期时间（可空=永不过期，不推荐默认）                 |
| maxUses               | 最大成功解锁次数（可空=不限）                     |
| usedCount             | 已成功解锁次数                             |
| lastUsedAt            | 最近成功使用时间                            |
| createdByUserId       | 创建人                                 |
| createdAt / updatedAt |                                     |
| appIds                | 绑定应用列表（关联表 `access_code_apps`）      |

**生成规则（一期）**

- 系统生成高熵口令（如 `dock_` + 24 字符 URL-safe）
- 也允许管理员自定义口令（需满足最小长度/复杂度，并查重哈希）
- **双存**：`codeHash`（校验）+ `codeEnc`（主密钥 AES-GCM 加密，供管理端再复制）
- 创建/轮换成功弹窗展示明文并可复制；**列表也可「复制口令」**（服务端解密后返回一次，一期原型/实现可点一下即复制；生产可后续加确认/审计）
- 主密钥：`APPDOCK_ACCESS_CODE_MASTER_KEY`（环境变量，丢失则无法再解密历史口令，只能轮换）
- **不做**用户侧密钥对：自建单机场景成本高、密钥托管复杂，收益有限

**校验流程（下载站）**

```
用户打开 password 应用 → 口令墙输入
  → 查 active 且未过期且（maxUses 空或 usedCount < maxUses）
  → 且绑定了当前 appId
  → 成功：usedCount++、lastUsedAt、发会话 cookie
  → 会话携带 allowedAppIds（或按次校验），TTL 可配（默认 7 天）
  → 失败：统一「口令无效或已失效」（不区分原因，防枚举）
```

**停用 / 过期**

- 手动停用立即失效（已发会话：一期可接受至 cookie 过期；二期可加会话吊销列表）
- `expiresAt` 过后 status 视为 expired（读时计算即可）

**权限**

- 一期：仅 **admin** 可进入 `/admin/access-codes` 管理
- 应用 manager 在应用详情只读看到「有哪些口令绑定了本应用」+ 链接去口令中心（可选）

**管理页信息架构**

- 列表：备注、前缀、状态、过期、次数、绑定应用、创建人、最近使用；操作含 **复制口令**、停用/启用、编辑绑定、轮换
- 新建抽屉/页：备注、过期、最大次数、多选应用（仅 password 应用可选）
- 空状态：引导「先将应用可见性设为口令，再签发访问口令」

**与旧「每应用一个 password 字段」关系**：废弃应用级 `passwordHash`；迁移时无历史数据。

### 4.3 Release 同步（多源 Provider）

#### 4.3.0 Provider 抽象

实现侧统一接口（逻辑名，非强制包名）：

```
ReleaseProviderAdapter
  - id: github | gitee | gitlab
  - listReleases(app) / getRelease(app, tag)
  - downloadAsset(app, remoteAsset) → stream
  - verifyWebhook(headers, rawBody, secret) → matchedRepoKey | null
  - mapToCanonical(release) → { tagName, name, body, isPrerelease, publishedAt, assets[] }
```

| Provider | 一期         | Webhook 路径（建议）                  | 鉴权 / Token                                      | 备注                 |
|----------|------------|---------------------------------|-------------------------------------------------|--------------------|
| `none`   | ✅          | —                               | —                                               | 纯手动                |
| `github` | ✅ **唯一实现** | `POST /api/v1/hooks/github`     | `APPDOCK_GITHUB_TOKEN`；签名 `X-Hub-Signature-256` | Releases API       |
| `gitee`  | ❌ 二期       | `POST /api/v1/hooks/gitee`（预留）  | `APPDOCK_GITEE_TOKEN`                           | API/签名与 GitHub 不同  |
| `gitlab` | ❌ 二期       | `POST /api/v1/hooks/gitlab`（预留） | `APPDOCK_GITLAB_TOKEN` + 可选 `releaseBaseUrl`    | 支持自建；可用 project id |

Canonical asset：`name` / `size` / `downloadUrl` / `remoteId` / 可选 `sha256`。  
Version/Asset 落库的 `source`：一期 `github_release` \| `manual`；二期增加 `gitee_release` \| `gitlab_release`。

#### 4.3.1 触发方式

1. **上游 Webhook**（一期仅 GitHub）
    - 事件：`release`（published / edited / deleted 按策略处理）
    - 校验：Provider 各自签名头（GitHub：`X-Hub-Signature-256`）
    - 匹配：payload 仓库标识 → `(releaseProvider, releaseOwner, releaseRepo[, releaseBaseUrl])`

2. **定时轮询**
    - 全局 cron + 每应用开关/间隔
    - 调用对应 Provider Releases API 比对 `tag_name` / `updated_at` / asset 列表
    - 跳过未实现 Provider（记日志，不入队失败风暴）

3. **手动触发**
    - 管理端「同步」→ 入队；未实现 Provider → `501 PROVIDER_NOT_IMPLEMENTED`

> 一期不做 CI 直传与 Artifact；`POST /api/v1/ingest/...` 可预留 501。

#### 4.3.2 同步流程

```
触发 → 解析 Provider →（未实现则失败/501）→ 鉴权/匹配 App
     → 拉取 Release 列表或单个 Release
     → 过滤 draft/prerelease（可配：默认同步 prerelease，不同步 draft）
     → 对每个 Release：upsert Version（source 按 Provider）
     → 对每个 Asset：匹配 include/exclude → 下载到临时文件
     → 校验 size（及可选 sha256）
     → 移动到 Storage → upsert Asset 记录
     → 写 SyncJob / SyncLog
```

**删除策略（一期 · GitHub）**

- 上游 Release deleted：标记本地 Version 为 `yanked`，文件默认保留（可手动删）
- edited：更新 changelog/名称；asset 增删则增量同步

**并发与限流**

- 同应用同时仅一个同步任务（队列互斥）
- 各 Provider API：独立 Token；尊重 rate limit，失败指数退避

### 4.4 版本（Version）与产物（Asset）

**Version**

| 字段              | 说明                                                                                               |
|-----------------|--------------------------------------------------------------------------------------------------|
| id              | 主键                                                                                               |
| appId           | 所属应用                                                                                             |
| tagName         | 如 `v1.2.3`（唯一：appId+tagName）                                                                     |
| name            | Release 标题                                                                                       |
| body            | changelog（markdown）                                                                              |
| isPrerelease    | bool                                                                                             |
| isLatest        | bool（可按 semver 或上游 latest 标记维护）                                                                  |
| publishedAt     | 上游发布时间                                                                                           |
| status          | `active` \| `yanked`                                                                             |
| source          | `github_release` \| `manual`（二期：`gitee_release` \| `gitlab_release` \| `artifact` / `ci_upload`） |
| remoteReleaseId | 上游 Release id（manual 可空；原 githubReleaseId）                                                       |
| createdByUserId | 手动创建时记录操作者                                                                                       |

**Asset**

| 字段               | 说明                                                                              |
|------------------|---------------------------------------------------------------------------------|
| id               | 主键                                                                              |
| versionId        | 所属版本                                                                            |
| name             | 原始文件名                                                                           |
| platform         | 归一化：`windows` \| `macos` \| `linux` \| `android` \| `ios` \| `web` \| `unknown` |
| arch             | `x64` \| `arm64` \| `universal` \| `unknown` 等                                  |
| contentType      | MIME                                                                            |
| size             | 字节                                                                              |
| checksumSha256   | 上传/同步后计算保存（一期建议必填落库）                                                            |
| storageKey       | 存储路径键                                                                           |
| downloadCount    | 简单计数                                                                            |
| remoteAssetId    | 上游 asset id（手动上传可空；原 githubAssetId）                                             |
| source           | `github_release` \| `manual`（二期扩展 gitee/gitlab）                                 |
| uploadedByUserId | 手动上传操作者                                                                         |

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
- 纯手动应用：`releaseProvider=none`，可不填 owner/repo；启用 Webhook/轮询时必须已绑定**已实现**的 Provider 仓库
- 与上游同步并存：同一 `tagName` 下允许既有上游资产也有 manual 资产；同步时**不删除** `source=manual` 的文件（一期：上游同名 asset **不覆盖** manual，记 warning 日志）

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
    - `/docs/update-check`（或站内「开发者」页）：极简更新检查 API 说明
- 展示：应用名、简介、changelog、按平台分组的下载按钮、文件大小、发布时间、**SHA256 一键复制**
- **智能主下载（一期）**：根据 UA / 可选 `?platform=` 推荐主按钮（Windows/macOS/Linux/Android）；旁路保留「其他平台」展开
- **预发布（一期）**：默认只展示非 prerelease 为「最新」；提供「显示预发布」开关（query 或本地偏好）；历史列表默认可折叠 prerelease
- **空状态（一期）**：真 404（未知 slug）、无权限（401/403 友好页）、归档应用对外 404、无匹配搜索结果
- **首页列表**：按当前身份过滤——访客只见 `public`；口令会话可见已解锁的 `password`；登录用户另见 `login`（未登录不把 password/login 应用当可下卡片露出详情内容，卡片可显示「需口令/需登录」或直接隐藏——一期建议：**password/login 仍可出现在目录但点进后拦墙**，避免目录空荡；实现二选一写进设置亦可，默认「展示卡片 + 进页鉴权」）
- SEO/分享：一期基础 title/description 即可
- 口令墙：拦截页输入访问口令
- **更新检查 API**：见 `GET /api/v1/public/apps/:slug/updates/check`；对外文档页给客户端对接示例（curl / 字段说明）

### 4.6 邮件通知

**目标**：把「同步/上传结果」推到邮箱，邮件内可直接点各平台下载链接（国内走 AppDock，不链 GitHub）。

#### 4.6.1 事件（一期）

| 事件               | 触发                        | 邮件要点                               |
|------------------|---------------------------|------------------------------------|
| `sync.success`   | Release 同步成功且有新版本或新 asset | 应用名、tag、changelog 摘要、按平台下载链接、任务 id |
| `sync.failure`   | 同步/下载失败（含重试耗尽）            | 应用名、错误摘要、任务链接（管理端）                 |
| `upload.success` | 手动上传落盘成功                  | 版本、文件列表、下载链接                       |

二期：`access_code.expiring` / `access_code.quota_low`（定时扫描）。

#### 4.6.2 收件人（可组合勾选）

全局默认 + **按应用覆盖**：

1. **自定义邮箱列表**（逗号/多行，应用级优先，空则用全局默认）
2. **通知应用成员**：可勾选角色 `viewer` / `operator` / `manager`（用用户账号邮箱；无邮箱则跳过）
3. **额外抄送**：可选固定邮箱

解析去重后入队；无任何收件人则跳过并打日志。

#### 4.6.3 应用级开关

| 配置                      | 说明                         |
|-------------------------|----------------------------|
| notifyEnabled           | 总开关                        |
| notifyOnSyncSuccess     |                            |
| notifyOnSyncFailure     |                            |
| notifyOnUploadSuccess   |                            |
| notifyEmails            | 自定义邮箱[]                    |
| notifyMemberRoles       | 如 `["manager","operator"]` |
| notifyUseGlobalFallback | 自定义为空时是否回落全局默认（默认 true）    |

#### 4.6.4 发送通道与 SMTP 配置（管理端可编辑）

- 一期仅 **SMTP**；投递走队列 **`notify`**
- **配置以管理端表单为准**（自建场景）；可加密落库。环境变量仅作「首次引导/覆盖」可选，不是唯一来源
- 系统设置 → **邮件** Tab 完整字段：

| 字段                   | 说明                                |
|----------------------|-----------------------------------|
| enabled              | 是否启用邮件发送                          |
| host                 | SMTP 主机                           |
| port                 | 端口（常见 465 / 587 / 25）             |
| encryption           | `ssl_tls` \| `starttls` \| `none` |
| username             | 认证用户名（可空=匿名，少见）                   |
| password             | **只写不回显**；已设置时显示「已设置」+「更改密码」      |
| fromName / fromEmail | 发件人显示名与邮箱                         |
| replyTo              | 可选回信地址                            |
| connectTimeoutSec    | 连接超时（默认如 15）                      |
| notifyGlobalEmails   | 全局默认收件人                           |

- 操作：保存、**发送测试邮件**（可选指定 to；校验连通与认证）
- 应用详情「通知」分区不变：开关 + 收件人 + 事件 + 测试
- 成功模板必须含 AppDock 下载链接（非 GitHub）

#### 4.6.5 权限

- 改全局 SMTP / 默认收件人：admin
- 改应用通知配置：admin 或该应用 manager

### 4.7 管理后台

页面（一期）：

1. 登录（用户名或邮箱）  
2. **强制改密**（`must_change_password`；未完成不可进其他管理页）  
3. 仪表盘：应用数、最近同步、队列失败任务  
4. 用户管理（admin）：系统角色仅 `admin` \| `user`（应用 permission 不在此配置）
4. 应用列表 / 创建编辑（含成员授权、**归档/取消归档**）
6. 应用详情：版本（含 **yank**）、上传（含标题/changelog/预发布/platform）、同步、**通知**、成员、Webhook/轮询
7. 访问口令中心
8. 任务 / 同步日志（**任务详情含 logs**、失败重试）
9. 系统设置：站点、轮询、上传上限、GitHub、**SMTP / 全局通知默认**、storageRoot 只读展示

### 4.7.1 最低审计（一期）

完整审计属三期；一期须对下列敏感操作写一条 `audit_events`（或等价表），字段至少：`actorUserId`、`action`、`targetType`、`targetId`、`meta`（json）、`createdAt`。

| action 示例                                              | 说明              |
|--------------------------------------------------------|-----------------|
| `access_code.reveal` / `rotate` / `create` / `disable` | 口令中心            |
| `app.archive` / `unarchive` / `visibility_change`      | 应用              |
| `version.yank` / `asset.delete`                        | 版本与产物           |
| `user.create` / `disable` / `role_change` / `password_change` | 用户       |
| `settings.smtp_change`                                 | SMTP 变更（不含密码明文） |

管理端可不做独立审计 UI（可 SQL / 日志查看）；二期再做查询页。

### 4.8 系统配置（全局）

| 键                      | 说明                           |
|------------------------|------------------------------|
| siteName               | 站点名称                         |
| publicBaseUrl          | 对外根 URL（Webhook / 下载 / 邮件链接） |
| githubToken            | PAT（环境变量优先）                  |
| webhookSecret          | 默认 Webhook 密钥                |
| defaultPollIntervalSec | 如 300                        |
| storageRoot            | 如 `/data/files`              |
| maxAssetSizeBytes      | 单文件上限                        |
| notifyGlobalEmails     | 全局默认收件人[]                    |
| smtp.*                 | 见 4.6.4；密码加密存储，GET 永不回传明文    |

敏感项：SMTP 密码、JWT secret、口令主密钥等 **GET 脱敏**；密码类字段仅 PATCH 时提交新值。

---

## 5. 技术架构（草案）

### 5.1 技术选型（已定）

| 层   | 选型                 | 说明                                                |
|-----|--------------------|---------------------------------------------------|
| API | **NestJS**         | Module/Guard 适合多用户授权；`@nestjs/bullmq`、Schedule 成熟 |
| Web | Vue3 + Vue Router  | 管理端 + 下载站单应用分路由                                   |
| DB  | SQLite             | 单机零运维；Prisma 或 Drizzle                            |
| 队列  | **Redis + BullMQ** | 多队列、并发限流、失败重试                                     |
| 存储  | 本地目录 + Storage 接口  | 二期 MinIO/S3                                       |

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
                    │ NestJS Worker    │──▶ Release Provider API / Storage
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
- **worker**：消费队列（按 Provider 拉取上游 Release 等）；同镜像不同 command
- **redis**：BullMQ

| 队列名              | 职责                        | 建议并发         | 备注                   |
|------------------|---------------------------|--------------|----------------------|
| `release-sync`   | 拉 Release 元数据、投递 asset 下载 | 1～2，同 app 互斥 | jobId 按 app 去重       |
| `asset-download` | 从上游 Provider 下载 asset 落盘  | 2～4          | 限流 + 体积校验            |
| `notify`         | 邮件等通知投递                   | 2            | 一期 SMTP；二期飞书/Webhook |

手动上传**不走** `asset-download`（文件已在请求中），直接 API → Storage → DB；可选事后投递 `notify`。

---

## 6. 数据模型（表草案）

### 6.1 users

| 列                    | 类型            | 说明                                                |
|----------------------|---------------|---------------------------------------------------|
| id                   | text PK       |                                                   |
| username             | text unique   |                                                   |
| email                | text unique   | **必填**；通知成员、找回展示用                                 |
| display_name         | text?         | 展示名；可空则用 username                                 |
| password_hash        | text          |                                                   |
| role                 | text          | `admin` \| `user`（**不是** viewer/operator/manager） |
| status               | text          | `active` \| `disabled`                            |
| must_change_password | int/bool      | 种子账号首次登录强制改密                                      |
| created_at           | text/datetime |                                                   |

### 6.1.0 audit_events（一期最低）

| 列             | 类型            | 说明                                 |
|---------------|---------------|------------------------------------|
| id            | text PK       |                                    |
| actor_user_id | text?         | 系统任务可空                             |
| action        | text          | 见 4.7.1                            |
| target_type   | text          | `user` / `app` / `access_code` / … |
| target_id     | text?         |                                    |
| meta_json     | text          | 脱敏后的上下文                            |
| created_at    | text/datetime |                                    |

### 6.1.1 app_members

| 列          | 类型            | 说明                                  |
|------------|---------------|-------------------------------------|
| id         | text PK       |                                     |
| app_id     | text          |                                     |
| user_id    | text          |                                     |
| permission | text          | `viewer` \| `operator` \| `manager` |
| created_at | text/datetime |                                     |

唯一索引：`(app_id, user_id)`。

### 6.1.2 access_codes

| 列                       | 类型             | 说明                     |
|-------------------------|----------------|------------------------|
| id                      | text PK        |                        |
| note                    | text           | 备注                     |
| code_hash               | text unique    | 校验用                    |
| code_enc                | text           | 主密钥加密密文（含 nonce）       |
| code_prefix             | text           | 展示用前缀                  |
| status                  | text           | `active` \| `disabled` |
| expires_at              | text/datetime? |                        |
| max_uses                | int?           |                        |
| used_count              | int            | 默认 0                   |
| last_used_at            | text/datetime? |                        |
| created_by_user_id      | text           |                        |
| created_at / updated_at |                |                        |

### 6.1.3 access_code_apps

| 列              | 类型   | 说明                           |
|----------------|------|------------------------------|
| access_code_id | text |                              |
| app_id         | text | 仅应绑定 visibility=password 的应用 |

唯一索引：`(access_code_id, app_id)`。

### 6.2 apps

见 4.1；索引：`slug` unique；部分唯一索引 `(release_provider, release_owner, release_repo, release_base_url)`（仅 `release_provider ≠ 'none'` 且 owner/repo 非空时生效，实现可用生成列或应用层校验）。  
说明：`releaseProvider=none` 时为纯手动；开启 Webhook/轮询时必须绑定**已实现**的 Provider。**不再**存应用级 `password_hash`。列名以 `release_*` 为准（迁移时可从旧 `github_*` 改名）。

### 6.3 versions

唯一索引：`(app_id, tag_name)`。

### 6.4 assets

索引：`version_id`；可选 `(version_id, name)` unique。

### 6.5 sync_jobs

| 列                        | 说明                                             |
|--------------------------|------------------------------------------------|
| id                       |                                                |
| app_id                   |                                                |
| trigger                  | `webhook` \| `poll` \| `manual`                |
| status                   | `queued` \| `running` \| `success` \| `failed` |
| message                  | 错误摘要                                           |
| started_at / finished_at |                                                |
| stats_json               | 如 `{ syncedReleases:1, syncedAssets:3 }`       |

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
    - **管理端 / 登录用户（已定 JWT）**：`Authorization: Bearer <access_token>`
    - **访问口令会话**：HttpOnly Cookie `access_session`（与 JWT 分离，仅下载站）

- 分页：`?page=1&pageSize=20` → `{ items, total, page, pageSize }`

---

### 7.1 认证（JWT · 已定）

管理端与 `visibility=login` 的下载站登录使用 **JWT**（与访问口令 Cookie 分离）。

| 令牌            | 存放                          | TTL（建议）  | 用途        |
|---------------|-----------------------------|----------|-----------|
| access_token  | 请求头 `Authorization: Bearer` | 15～60 分钟 | API 鉴权    |
| refresh_token | **HttpOnly Secure Cookie**  | 7～30 天   | 换发 access |

- 算法：HS256 + `APPDOCK_JWT_SECRET`（单机）；多实例可再升 RS256
- access 建议字段：`sub`、`role`、`typ:"access"`、`iat`/`exp`
- refresh 建议：`sub`、`jti`；一期可无状态，登出清 Cookie；二期可用 Redis 吊销
- **不要**把 refresh 长期放 localStorage

#### `POST /api/v1/auth/login`

登录标识支持 **username 或 email**（同一字段 `login`，二选一即可）：

- 含 `@`：优先按 `email` 精确匹配，未命中再试 `username`
- 否则：按 `username` 匹配，未命中再试 `email`

```json
// req
{ "login": "admin", "password": "***" }
// 或
{ "login": "qi@moonlab.io", "password": "***" }
// res
{
  "accessToken": "...",
  "expiresIn": 3600,
  "user": {
    "id": "...",
    "username": "admin",
    "email": "qi@moonlab.io",
    "displayName": "陈启明",
    "role": "admin",
    "mustChangePassword": true
  }
}
// Set-Cookie: refresh_token=...; HttpOnly; Path=/api/v1/auth; SameSite=Lax
```

- `mustChangePassword=true` 时：除 `change-password` / `logout` / `me` 外，其余需鉴权接口返回 `403 PASSWORD_CHANGE_REQUIRED`
- 管理端 / 下载站登录 UI 文案统一为「用户名或邮箱」

#### `POST /api/v1/auth/refresh`

Cookie refresh → 新 `accessToken`（可轮换 refresh）。

#### `POST /api/v1/auth/logout`

清 refresh Cookie；若有 jti 白名单则作废。

#### `GET /api/v1/auth/me`

需有效 Bearer accessToken。返回字段同 login 的 `user`（含 `mustChangePassword`）。

#### `POST /api/v1/auth/change-password`

需已登录（Bearer）。种子 Admin 首次进入前必须成功调用本接口。

```json
// req
{ "currentPassword": "***", "newPassword": "***" }
// res 200
{ "ok": true }
```

规则：校验旧密 → 新密强度（一期：≥8 位即可）→ 更新 `password_hash` → 清 `must_change_password` → **写审计** `user.password_change` → 可选轮换 refresh。失败统一 `400`（旧密错误不细分枚举防探测，可与「新密不合规」用 `code` 区分）。

---

### 7.2 访问口令（下载站解锁）

#### `POST /api/v1/public/apps/:slug/unlock`

```json
// req
{
  "accessCode": "dock_...."
}
// res 200
{
  "ok": true,
  "expiresAt": "..."
}
// 401 统一文案，防枚举
{
  "error": {
    "code": "INVALID_ACCESS_CODE",
    "message": "口令无效或已失效"
  }
}
```

成功时 Set-Cookie 访问会话。仅当应用为 `password` 且口令绑定该应用且未过期/未超次。

#### `POST /api/v1/public/apps/:slug/lock`

清除访问口令会话。

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
  "asset": {
    "id": "...",
    "name": "...",
    "size": 1,
    "sha256": "..."
  }
}
```

---

### 7.4 管理端：访问口令中心（admin）

#### `GET /api/v1/admin/access-codes`

分页列表（不含明文）。项含：prefix、note、status、expiresAt、maxUses、usedCount、lastUsedAt、appIds、createdBy。

#### `POST /api/v1/admin/access-codes`

```json
{
  "note": "Q3 内测群",
  "expiresAt": "2026-12-31T23:59:59Z",
  "maxUses": 50,
  "appIds": [
    "app_forgedesk",
    "app_pixelsync"
  ],
  "customCode": null
}
```

```json
{
  "id": "...",
  "plainCode": "dock_xxxx....",
  "prefix": "dock_xxxx"
}
```

创建/轮换响应含 `plainCode`；之后仍可通过 `reveal` 再取。

#### `PATCH /api/v1/admin/access-codes/:id`

可改 note、expiresAt、maxUses、appIds、status（active/disabled）。

#### `POST /api/v1/admin/access-codes/:id/rotate`

作废旧哈希/密文并生成新明文（响应同创建，含 `plainCode` 一次）。

#### `POST /api/v1/admin/access-codes/:id/reveal`

解密并返回明文供复制（admin）：

```json
{
  "plainCode": "dock_...."
}
```

一期可无二次密码确认，但 **必须写审计**（`access_code.reveal`）。二期可加确认框。主密钥缺失或密文损坏时返回 503/410，引导轮换。

#### `DELETE /api/v1/admin/access-codes/:id`

硬删或停用；一期建议停用（status=disabled）。

---

### 7.5 管理端：用户（admin）

#### `GET /api/v1/admin/users`

#### `POST /api/v1/admin/users`

```json
{
  "username": "...",
  "email": "user@example.com",
  "displayName": "林晓",
  "password": "...",
  "role": "user"
}
```

`role` 仅允许 `admin` \| `user`。

#### `PATCH /api/v1/admin/users/:id`

可改 `role` / `status`；重置密码传 `password`。

---

### 7.6 管理端：应用与成员

> 注：原「应用级 password 字段」已废弃，口令一律走 7.4 访问口令中心。

#### `GET /api/v1/admin/apps`

返回当前用户可见应用：admin 全部；user 仅 `app_members` 中的。

#### `POST /api/v1/admin/apps`

权限：admin（一期创建应用仅 admin；二期可放开 manager 自建）。

```json
{
  "name": "My App",
  "slug": "my-app",
  "description": "",
  "releaseProvider": "github",
  "releaseOwner": "org",
  "releaseRepo": "repo",
  "releaseBaseUrl": null,
  "visibility": "password",
  "syncWebhookEnabled": true,
  "syncPollEnabled": true,
  "assetIncludeGlob": "*.exe,*.apk,*.dmg,*.zip",
  "syncPrerelease": true
}
```

- `releaseProvider` 缺省为 `none`（纯手动）；也可省略 owner/repo。
- 兼容别名：仍可传 `githubOwner` / `githubRepo` → 映射为 `releaseOwner` / `releaseRepo` 且 `releaseProvider=github`。
- 一期创建/更新时若 `releaseProvider` 为 `gitee`/`gitlab`：**允许保存**，但若同时 `syncWebhookEnabled` 或 `syncPollEnabled` 为 true → `400` 提示二期未实现（或保存时强制关闭同步开关并 warning）。
- 设为 `password` 后须在**口令中心**签发并绑定应用，否则对外无法解锁。

#### `GET /api/v1/admin/apps/:id`

含 `webhookUrl`：按 Provider 返回对应 hooks 路径（一期 github：`{publicBaseUrl}/api/v1/hooks/github`；未实现 Provider 可为 `null` + `providerStatus: "not_implemented"`）。需对该应用至少 viewer。  
可附带 `boundAccessCodes[]`（前缀/状态/过期，无明文）。

#### `PATCH /api/v1/admin/apps/:id`

不可改 slug。需 manager+。可见性变更不接收口令明文。

#### `DELETE /api/v1/admin/apps/:id`

仅 admin。软删/归档；`?purgeFiles=true` 默认 false。

#### `GET /api/v1/admin/apps/:id/members`

#### `PUT /api/v1/admin/apps/:id/members`

```json
{
  "userId": "...",
  "permission": "manager"
}
```

权限：admin 或该应用 manager。

#### `DELETE /api/v1/admin/apps/:id/members/:userId`

---

### 7.7 管理端：版本、产物与手动上传

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

### 7.8 同步与队列

#### `POST /api/v1/admin/apps/:id/sync`

需 operator+。应用须绑定**已实现**的 Release Provider（一期：`github`）；否则 `501 PROVIDER_NOT_IMPLEMENTED` 或 `400`。

```json
{
  "tagName": "v1.2.0"
}
```

```json
{
  "jobId": "..."
}
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
- 仅匹配 `releaseProvider=github` 的应用

#### `POST /api/v1/hooks/gitee` / `POST /api/v1/hooks/gitlab`（二期）

一期可注册路由并固定返回 `501 PROVIDER_NOT_IMPLEMENTED`，避免管理员配错 URL 得到 404。

---

### 7.9 系统与邮件

#### `GET /api/v1/admin/settings`

脱敏返回。SMTP 段示例：

```json
{
  "smtp": {
    "enabled": true,
    "host": "smtp.example.com",
    "port": 465,
    "encryption": "ssl_tls",
    "username": "noreply@example.com",
    "passwordSet": true,
    "fromName": "AppDock",
    "fromEmail": "noreply@example.com",
    "replyTo": null,
    "connectTimeoutSec": 15
  },
  "notifyGlobalEmails": [
    "ops@example.com"
  ]
}
```

#### `PATCH /api/v1/admin/settings`

可改站点、轮询、`notifyGlobalEmails`、完整 `smtp` 对象。  
`smtp.password`：省略=不修改；传空字符串可表示清除（需产品确认）；传新值则更新。

#### `POST /api/v1/admin/settings/smtp/test`

```json
{
  "to": "you@example.com"
}
```

使用**当前已保存**配置发测试信；也可接受临时覆盖字段做「保存前试连」（一期：仅已保存配置）。

#### `GET /api/v1/admin/apps/:id/notify`

#### `PATCH /api/v1/admin/apps/:id/notify`

```json
{
  "notifyEnabled": true,
  "notifyOnSyncSuccess": true,
  "notifyOnSyncFailure": true,
  "notifyOnUploadSuccess": true,
  "notifyEmails": [
    "ops@example.com"
  ],
  "notifyMemberRoles": [
    "manager",
    "operator"
  ],
  "notifyUseGlobalFallback": true
}
```

权限：admin 或应用 manager。

#### `POST /api/v1/admin/apps/:id/notify/test`

按当前配置解析收件人并发测试通知。

#### `GET /api/v1/health`

```json
{
  "ok": true,
  "db": true,
  "storage": true,
  "redis": true,
  "smtp": true
}
```

`smtp` 未配置时可为 `false`/`null`，不强制整体 unhealthy。

---

### 7.10 二期预留（文档占位，一期可不实现）

| 方法   | 路径                                      | 说明                     |
|------|-----------------------------------------|------------------------|
| POST | `/api/v1/hooks/gitee`                   | Gitee Release Webhook  |
| POST | `/api/v1/hooks/gitlab`                  | GitLab Release Webhook |
| POST | `/api/v1/ingest/ci/:appId`              | CI 直传，Token 鉴权         |
| POST | `/api/v1/admin/apps/:id/sync-artifacts` | Artifact 同步            |
| GET  | `/api/v1/admin/builds`                  | 构建看板                   |

---

## 8. Webhook 配置说明（给管理员）

### 8.1 GitHub（一期）

1. Repo → Settings → Webhooks → Add
2. Payload URL：`{publicBaseUrl}/api/v1/hooks/github`  
3. Content type：`application/json`  
4. Secret：与 AppDock 中配置一致  
5. Events：选 `Releases`  
6. 确保 AppDock 能被 GitHub 访问（公网或 tunnel）；若不能，依赖轮询即可  

### 8.2 Gitee / GitLab（二期）

- 应用表单选择对应 `releaseProvider`，填 Owner/Repo（GitLab 自建另填 `releaseBaseUrl`）
- Webhook URL 分别为 `/api/v1/hooks/gitee`、`/api/v1/hooks/gitlab`
- Token / 签名校验以各平台文档为准；实现前管理端同步按钮应禁用或提示二期

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

| 类别  | 要求                                                   |
|-----|------------------------------------------------------|
| 安全  | PAT/口令/管理员密码不明文落库；Webhook 验签；下载鉴权与可见性一致；限制上传/同步体积    |
| 性能  | 下载支持流式；同步不阻塞 API；大文件不整包进内存                           |
| 可靠  | 同步失败可重试；任务状态可查；GitHub 限流可感知                          |
| 可运维 | Compose 部署；`/data` 挂载备份；健康检查；结构化日志；最低审计落库            |
| 兼容  | Node 20+；现代浏览器；**一期单机单写 SQLite**（禁止多 api 实例并发写同一库文件） |

---

## 11. 页面信息架构（Web）

### 11.1 下载站（公开侧）

- 首页应用列表（搜索 / 平台筛选）
- 应用详情（智能主下载 + 校验和复制 + 预发布开关）/ 版本详情
- 口令解锁页 / 登录页（visibility=login）
- 404 / 无权限 / 归档空状态
- 更新检查 API 说明页

### 11.2 管理端

- `/admin/login`
- `/admin` 仪表盘
- `/admin/apps`
- `/admin/apps/:id`
- `/admin/access-codes`（访问口令中心）
- `/admin/users`
- `/admin/jobs`
- `/admin/settings`

一期可采用 Vue3 + Vue Router + 朴素 UI（如 Naive UI / Element Plus）。

---

## 12. 里程碑建议

| 里程碑 | 交付                                                     | 预估量级 |
|-----|--------------------------------------------------------|------|
| M0  | NestJS 脚手架、Compose、健康检查、种子 Admin + **强制改密**（`login`=username\|email）、上线自检清单、最小 Web 登录/改密 | 小    |
| M1  | 用户（含 email）+ app_members、App CRUD、本地 Storage、**最低审计表** | 中    |
| M2  | **手动上传**（元数据齐全）+ yank/归档 + 下载鉴权打通                      | 中    |
| M3  | BullMQ 多队列 + **ReleaseProvider** + GitHub + 任务详情/日志/重试 | 中    |
| M4  | GitHub Webhook + 轮询（Gitee/GitLab hooks 可先 501）         | 小    |
| M5  | 公开下载页 + 三种可见性 + 口令中心 + 会话退出/登出 + 极简更新检查                | 中    |
| M6  | **SMTP 邮件通知**（成功/失败/上传 + 应用级收件人）                       | 中    |
| M7  | 打磨：平台推断、队列看板、**备份/恢复附录落地**                             | 小    |

---

## 13. 待决事项（实现前可再定，不阻塞 PRD）

1. ~~Fastify vs Nest~~ → **已定 NestJS**。
2. 前端单体 vs 拆包：一期 **单 Vue 应用分路由**。
3. 「最新版」：优先上游 `latest`（一期 GitHub），否则最高非 prerelease tag；纯手动应用由管理员标记或按 semver。
4. 更新检查 API：一期 **做极简版**。
5. ORM：Prisma vs Drizzle —— 实现时二选一，推荐 **Prisma**（与 Nest 资料多）。
6. 上传是否支持断点续传：一期 **不做**；超大文件靠调高反向代理/`maxAssetSizeBytes`。
7. GitLab 二期：优先 Releases API 还是 Generic Packages —— 实现前再定；PRD 先按 Releases 对齐。
8. 多源 Token：全局 env 够用，还是按应用覆盖 —— 一期全局；二期可加应用级覆盖。

---

## 14. 附录：备份、引导与上线自检

### 14.1 `/data` 目录约定（Compose volume）

| 路径                                  | 内容        | 备份优先级             |
|-------------------------------------|-----------|-------------------|
| `/data/appdock.db`（及 `-wal`/`-shm`） | SQLite 主库 | **P0**            |
| `/data/files/`                      | 安装包实体     | **P0**            |
| Redis                               | 队列状态      | 可不备份（可重建）；勿当唯一真相源 |

**不在 volume、必须另行保管的密钥**（丢失后果）：

| 密钥                                                | 丢失后果                        |
|---------------------------------------------------|-----------------------------|
| `APPDOCK_JWT_SECRET`                              | 全部登录会话失效，需用户重登              |
| `APPDOCK_ACCESS_CODE_MASTER_KEY`                  | **历史口令无法 reveal**，只能轮换生成新口令 |
| `APPDOCK_GITHUB_TOKEN` / Webhook Secret / SMTP 密码 | 同步或发信中断，可重配                 |

**备份建议**：停写或 SQLite online backup 后打包 `appdock.db*` + `files/`；恢复时先停 api/worker，还原文件再启。运维细则见仓库 **[docs/ops/BACKUP.md](ops/BACKUP.md)** 与根 [README.md](../README.md)。

**部署约束**：一期 **仅一个 api 进程** 写 SQLite；worker 只经 Redis 消费，不直连多写库。

### 14.2 首次启动引导

1. 用 `APPDOCK_ADMIN_USERNAME` / `APPDOCK_ADMIN_PASSWORD` 种子创建 admin（`must_change_password=true`）
2. 首次登录 **强制修改密码** 后方可进入其他页
3. 空站引导（可轻量）：创建第一个应用 → 配置 GitHub Token / Webhook（设置页只读态）→ 或纯手动上传
4. 可选：SMTP 未配置时通知相关开关提示「邮件不可用」

### 14.3 上线自检清单（M0/M7）

- [ ] Compose：api / worker / redis 健康检查通过
- [ ] `/data` 已挂载且可写
- [ ] Admin 已改密；JWT / 口令主密钥已换默认值
- [ ] （若用同步）`APPDOCK_GITHUB_TOKEN` 可读私有 Release；Webhook Secret 与 GitHub 一致
- [ ] （若用邮件）SMTP 测试信成功
- [ ] 备份脚本/卷快照已演练至少一次恢复

---

## 15. 附录：环境变量草案

```bash
APPDOCK_PORT=3080
APPDOCK_PUBLIC_BASE_URL=https://dock.example.com
APPDOCK_DATABASE_URL=file:/data/appdock.db
APPDOCK_STORAGE_ROOT=/data/files
APPDOCK_JWT_SECRET=change-me-long-random
APPDOCK_JWT_ACCESS_TTL_SEC=3600
APPDOCK_JWT_REFRESH_TTL_SEC=604800
APPDOCK_GITHUB_TOKEN=ghp_xxx
APPDOCK_WEBHOOK_SECRET=whsec_xxx
# 二期启用时再配
# APPDOCK_GITEE_TOKEN=
# APPDOCK_GITLAB_TOKEN=
# APPDOCK_GITEE_WEBHOOK_SECRET=
# APPDOCK_GITLAB_WEBHOOK_SECRET=
APPDOCK_ADMIN_USERNAME=admin
APPDOCK_ADMIN_PASSWORD=change-me-on-first-boot
APPDOCK_DEFAULT_POLL_INTERVAL_SEC=300
APPDOCK_REDIS_URL=redis://redis:6379
APPDOCK_QUEUE_DOWNLOAD_CONCURRENCY=3
APPDOCK_MAX_ASSET_SIZE_BYTES=1073741824
APPDOCK_ACCESS_CODE_MASTER_KEY=base64-or-hex-32bytes-min
APPDOCK_ACCESS_CODE_SESSION_TTL_SEC=604800
# 可选：首次启动种子 SMTP（之后以管理端配置为准）
APPDOCK_SMTP_HOST=
APPDOCK_SMTP_PORT=
APPDOCK_SMTP_ENCRYPTION=
APPDOCK_SMTP_USER=
APPDOCK_SMTP_PASS=
APPDOCK_SMTP_FROM_NAME=
APPDOCK_SMTP_FROM_EMAIL=
```

---

## 16. 文档修订记录

| 版本     | 日期         | 说明                                                                                                           |
|--------|------------|--------------------------------------------------------------------------------------------------------------|
| v0.1   | 2026-09-20 | 首版：需求冻结 + 接口草案                                                                                               |
| v0.2   | 2026-09-20 | 改为 NestJS；多用户应用授权；BullMQ 多队列；手动上传                                                                            |
| v0.2.1 | 2026-09-20 | 设计稿迁入 `docs/design/`（index.html + DESIGN.md）                                                                 |
| v0.3   | 2026-09-21 | **访问口令中心**：多应用绑定、期限、次数、备注；废弃应用级单口令                                                                           |
| v0.3.1 | 2026-09-21 | 口令可列表再复制：主密钥加密存库 + reveal API；不做用户密钥对                                                                        |
| v0.3.2 | 2026-09-21 | 管理端登录定为 JWT access + HttpOnly refresh                                                                        |
| v0.4   | 2026-09-21 | 邮件通知：SMTP + 同步/上传事件 + 应用级收件人组合                                                                               |
| v0.4.1 | 2026-09-21 | SMTP 改为管理端完整可编辑表单（host/port/加密/账密/From/超时）                                                                   |
| v0.4.2 | 2026-09-21 | 下载站一期补齐：智能主下载、校验和复制、预发布开关、空状态、更新检查文档页                                                                        |
| v0.5   | 2026-09-21 | **多源 Release 模型**：`releaseProvider` + Owner/Repo/BaseUrl；一期仅实现 GitHub；Gitee/GitLab 二期；兼容 githubOwner/Repo 别名 |
| v0.5.1 | 2026-09-21 | **P0 补强**：一期=分发非构建；`login` 语义；users.email；最低审计；备份/引导/单机写约束；归档/yank/会话退出写入需求                                  |
| v0.5.2 | 2026-09-21 | 登录标识 `login`=username\|email；补 `POST /auth/change-password` 与强制改密拦截                                               |
