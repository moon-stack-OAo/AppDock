#!/usr/bin/env bash
# 在服务器仓库根执行：拉取 GHCR 镜像并重建 api / worker。
# 依赖：docker compose、已 docker login ghcr.io（私有镜像时）。
# 环境变量（可写在 .env）：APPDOCK_IMAGE=ghcr.io/<owner>/<repo>:latest
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "缺少 .env，请先 cp .env.example .env 并填写密钥" >&2
  exit 1
fi

IMAGE="$(grep -E '^APPDOCK_IMAGE=' .env | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
if [[ -z "${IMAGE}" ]]; then
  echo "请在 .env 设置 APPDOCK_IMAGE=ghcr.io/<owner>/<repo>:latest" >&2
  exit 1
fi

echo "拉取 ${IMAGE}"
docker compose pull api worker
docker compose up -d --remove-orphans
docker image prune -f >/dev/null || true
echo "已更新。健康检查：curl -fsS http://127.0.0.1:\${APPDOCK_PORT:-3080}/api/v1/health"
