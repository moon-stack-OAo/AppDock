# 备份与恢复

对应 PRD §14。一期单机：**一个 api** 写 SQLite，**worker** 只消费 Redis。业务真相源是磁盘上的库 + 安装包，不是 Redis。

## 要备份什么

数据根：宿主机 `./data` → 容器 `/data`（路径以实现为准）。

| 必备     | 路径示例                       | 说明                    |
|--------|----------------------------|-----------------------|
| SQLite | `appdock.db`、`-wal`、`-shm` | 元数据、用户、口令密文、任务        |
| 安装包    | `files/`                   | 与库中 `storageKey` 一一对应 |

**库与 `files/` 必须同次备份。** 只备其一会出现「有记录无文件」或「有文件无记录」。

| 可不备     | 原因            |
|---------|---------------|
| Redis   | 队列可重建，不是真相源   |
| 镜像 / 源码 | 用 Git 与镜像仓库恢复 |

## 密钥（勿只靠 volume）

放在 `.env` 或密钥系统，与数据备份分存。

| 变量                               | 丢了会怎样          | 怎么办             |
|----------------------------------|----------------|-----------------|
| `APPDOCK_JWT_SECRET`             | 全部登录失效         | 换新密钥，用户重登       |
| `APPDOCK_ACCESS_CODE_MASTER_KEY` | 管理端无法「再复制」历史口令 | 口令中心**轮换**后重新分发 |
| `APPDOCK_GITHUB_TOKEN`           | 私有仓同步失败        | 重配              |
| `APPDOCK_WEBHOOK_SECRET`         | Hook 验签失败      | 与 GitHub 同步改密   |
| SMTP 密码                          | 发信失败           | 管理端重填           |

说明：主密钥丢失**不会**立刻让下载站口令失效（校验用哈希），但 reveal 会挂。

## 怎么备

数据库默认在仓库根：`APPDOCK_DATABASE_URL=file:data/appdock.db`。安装包在 `data/files`（或 `APPDOCK_STORAGE_ROOT`）。**库与 files 同次备份。** 密钥（`.env`、JWT、口令主密钥、Token、SMTP 密码）不进备份包。

文件名按天：`appdock-YYYYMMDD.db`。只保留 7 天，更早的删掉。

**冷备（最稳）**

1. 停写：`docker compose stop api worker`（本机开发则停 api 与 worker 进程）
2. 拷贝 `data/appdock.db`（及 `-wal` / `-shm`）和 `data/files`
3. 再启动

**热备：sqlite3 `.backup`（推荐）**

在仓库根执行。`.backup` 得到一致快照，不必先停写。

PowerShell：

```powershell
$stamp = Get-Date -Format "yyyyMMdd"
New-Item -ItemType Directory -Force -Path "data\backups" | Out-Null
sqlite3 "data\appdock.db" ".backup 'data/backups/appdock-$stamp.db'"
Copy-Item -Recurse -Force "data\files" "data\backups\files-$stamp"
Get-ChildItem "data\backups\appdock-*.db" |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
  Remove-Item -Force
```

bash：

```bash
STAMP=$(date +%Y%m%d)
mkdir -p data/backups
sqlite3 data/appdock.db ".backup 'data/backups/appdock-$STAMP.db'"
cp -a data/files "data/backups/files-$STAMP"
find data/backups -name 'appdock-*.db' -mtime +7 -delete
```

每天一次即可（Windows 任务计划程序，或 cron `0 3 * * *`，工作目录为仓库根）。

没有 `sqlite3` 时：低峰拷贝 `data/appdock.db` 以及存在的 `-wal` / `-shm`，再拷贝 `data/files`。管理员也可 `POST /api/v1/admin/maintenance/backup`（仅 admin）：只拷贝数据库文件到 `data/backups`，**不**打包安装包目录；繁忙时文件拷贝可能不一致。

## 怎么恢复

1. 停 api 与 worker（`docker compose stop api worker`，或停本机两个进程）
2. 现网 `data/appdock.db*` 与 `data/files` 先改名留档
3. 用备份替换数据库文件和 `files`（或 `APPDOCK_STORAGE_ROOT`），权限可读写
4. `.env` 中 JWT、口令主密钥与**备份当时**一致，且不要从备份包里找密钥
5. 再启动 api 与 worker
6. 抽查：应用列表、公开下载、口令解锁、失败任务

**禁止**在 api 仍写库时覆盖 db。

## 部署注意

- 一期只跑**一个**写库的 api。
- 多 api 共享同一 SQLite 文件 → 易损坏，不做。
- 二期 worker 扩容也不改变「库 + files 一起备」的规则。

## 上线前勾一下

- [ ] `./data`（或 volume）已挂载可写
- [ ] 做过至少一次备份→恢复演练
- [ ] JWT、口令主密钥、Admin 密码已非默认值
- [ ] 备份包与 `.env` 分开放（包内不要明文 Token）
- [ ] 知道主密钥丢失后如何轮换口令

其余见 PRD §14.3。

## Compose 路径（M0 已落地）

| 项 | 值 |
|----|-----|
| 宿主机数据目录 | `./data` |
| 容器挂载 | `/data` |
| SQLite | `/data/appdock.db`（`APPDOCK_DATABASE_URL=file:/data/appdock.db`） |
| 安装包 | `/data/files` |
| 服务 | `api` · `worker` · `redis`（见仓库根 `docker-compose.yml`） |

本地开发常用：`APPDOCK_DATABASE_URL=file:data/appdock.db`（相对仓库根）。

