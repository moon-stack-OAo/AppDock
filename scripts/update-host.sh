#!/usr/bin/env bash
# 不用 Docker：在服务器仓库根拉代码、编译、推 schema、重启 API 与 Worker。
# 依赖：git、Node 20+、pnpm、本机 Redis。
# 进程：优先 systemctl（appdock-api / appdock-worker），否则 nohup 到 data/run。
# 不覆盖 .env 与 data/。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
BRANCH="${APPDOCK_BRANCH:-main}"

if [[ ! -f .env ]]; then
  echo "缺少 .env" >&2
  exit 1
fi

echo "拉取 ${BRANCH}"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

corepack enable
corepack prepare pnpm@10.9.0 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm prisma:push

restart_one() {
  local unit="$1"
  local script="$2"
  local pidfile="$3"
  local log="$4"
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "${unit}.service" >/dev/null 2>&1; then
    sudo systemctl restart "$unit"
    return
  fi
  mkdir -p data/run
  if [[ -f "$pidfile" ]]; then
    local old
    old="$(cat "$pidfile" || true)"
    if [[ -n "$old" ]] && kill -0 "$old" 2>/dev/null; then
      kill "$old" || true
      sleep 1
    fi
  fi
  nohup pnpm --filter @appdock/server "$script" >>"$log" 2>&1 &
  echo $! >"$pidfile"
}

restart_one appdock-api start:prod data/run/api.pid data/run/api.log
restart_one appdock-worker start:worker data/run/worker.pid data/run/worker.log

PORT="$(grep -E '^APPDOCK_PORT=' .env | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
PORT="${PORT:-3080}"
echo "已更新。健康检查：curl -fsS http://127.0.0.1:${PORT}/api/v1/health"
