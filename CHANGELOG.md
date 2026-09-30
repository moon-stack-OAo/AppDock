# 更新日志

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。发版时按 tag 截取对应 `## [x.y.z]` 章节写入 GitHub Release。

## [0.2.0] - 2026-09-30

### 新增

- 手动上传显示传输进度与「正在合并」，并用局部遮罩挡住上传表单

### 修复

- 分片上传完成时流式写入存储并同时计算 sha256，不再多次整文件拷贝
- Redis 不可用时通知入队超时，不再让上传一直停在合并中
- 轮询在远程没有更新时跳过入队；同步进行中不再重复建任务
- 最新版按 semver 重新计算，而不是把刚同步的版本直接标为最新

## [0.1.0] - 2026-09-29

### 新增

- 自托管分发：应用、版本、手动上传、GitHub Release 同步（Webhook + 轮询）
- 下载站：公开 / 口令 / 登录，以及按文件名的稳定下载直链
- 口令中心、应用成员授权、SMTP 通知（可用未保存的草稿发测试信）
- Docker 镜像推送到 GHCR，并在发版后设为公开
- Node 运行包按平台拆分（linux / linux-musl / darwin / darwin-arm64 / windows），各自带 `latest-<平台>.yml` 供自更新比对版本与 sha256
- 应用表单可粘贴 GitHub 仓库或 Release 地址，自动填入同步源、名称、slug 与简介
- 手动上传改为 50MB 分片，避开 100MB 限制

### 修复

- CI 在全新环境先生成 Prisma Client 再编译
- Node 运行包支持首次 seed，并打包多平台 Prisma 引擎
