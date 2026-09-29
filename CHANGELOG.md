# 更新日志

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。发版时按 tag 截取对应 `## [x.y.z]` 章节写入 GitHub Release。

## [0.1.0] - 2026-09-29

### 新增

- 自托管分发：应用、版本、手动上传、GitHub Release 同步（Webhook + 轮询）
- 下载站：公开 / 口令 / 登录，以及按文件名的稳定下载直链
- 口令中心、应用成员授权、SMTP 通知（可用未保存的草稿发测试信）
- Docker 镜像推送到 GHCR，并在发版后设为公开
- Node 运行包 `appdock-node.tgz`（不含源码，解压即可启动 API 与 Worker）

### 修复

- CI 在全新环境先生成 Prisma Client 再编译
