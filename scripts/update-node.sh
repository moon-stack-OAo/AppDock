#!/usr/bin/env bash
# 不用 Docker：对照 GitHub Release 的 latest.yml，有新版本才下载 appdock-node.tgz。
# 在已解压的安装目录执行。保留 .env 与 data/。
# 可选：APPDOCK_LATEST_URL、APPDOCK_CHANNEL=v0.2.0（固定版本，默认 latest）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CHANNEL="${APPDOCK_CHANNEL:-latest}"
LATEST_URL="${APPDOCK_LATEST_URL:-https://github.com/moon-stack-OAo/AppDock/releases/${CHANNEL}/download/latest.yml}"

if [[ ! -f .env ]]; then
  echo "缺少 .env" >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

echo "读取 ${LATEST_URL}"
curl -fsSL "$LATEST_URL" -o "$tmpdir/latest.yml"

version="$(awk '/^version:/{print $2; exit}' "$tmpdir/latest.yml")"
remote="$(awk '/^sha256:/{print $2; exit}' "$tmpdir/latest.yml")"
url="$(awk '/^downloadUrl:/{print $2; exit}' "$tmpdir/latest.yml")"

if [[ -z "$version" || -z "$remote" || -z "$url" ]]; then
  echo "latest.yml 缺少 version / sha256 / downloadUrl" >&2
  exit 1
fi

if [[ -f VERSION && "$(tr -d '[:space:]' < VERSION)" == "$version" ]]; then
  echo "已是 ${version}，跳过"
  exit 0
fi

echo "下载 ${version}"
curl -fsSL "$url" -o "$tmpdir/appdock-node.tgz"
local="$(sha256sum "$tmpdir/appdock-node.tgz" | awk '{print $1}')"
if [[ "$local" != "$remote" ]]; then
  echo "sha256 不一致：${local} != ${remote}" >&2
  exit 1
fi

tar -xzf "$tmpdir/appdock-node.tgz" -C "$tmpdir"
cp -a "$tmpdir/appdock-node/." "$ROOT/"
printf '%s\n' "$version" > VERSION

npx prisma db push

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
  nohup node "$script" >>"$log" 2>&1 &
  echo $! >"$pidfile"
}

restart_one appdock-api dist/main.js data/run/api.pid data/run/api.log
restart_one appdock-worker dist/worker.main.js data/run/worker.pid data/run/worker.log

PORT="$(grep -E '^APPDOCK_PORT=' .env | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
PORT="${PORT:-3080}"
echo "已更新到 ${version}。健康检查：curl -fsS http://127.0.0.1:${PORT}/api/v1/health"
