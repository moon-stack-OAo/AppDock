/**
 * 等待 API / Web 就绪后打印一次地址摘要（避免被 Nest watch 清屏冲掉）。
 */
import os from "node:os";

const API_PORT = Number(process.env.APPDOCK_PORT || 3080);
const WEB_PORTS = Array.from({ length: 20 }, (_, i) => 5173 + i);
const TIMEOUT_MS = 90_000;
const INTERVAL_MS = 500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function probe(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1200);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.status > 0;
  } catch {
    return false;
  }
}

async function waitApi() {
  const url = `http://127.0.0.1:${API_PORT}/api/v1/health`;
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probe(url)) return true;
    await sleep(INTERVAL_MS);
  }
  return false;
}

async function waitWeb() {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    for (const port of WEB_PORTS) {
      if (await probe(`http://127.0.0.1:${port}/`)) return port;
    }
    await sleep(INTERVAL_MS);
  }
  return null;
}

function lanIpv4() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address);
    }
  }
  return [...new Set(ips)];
}

function banner(apiOk, webPort) {
  const ips = lanIpv4();
  const lines = [
    "",
    "  ════════════════════════════════════════════════",
    "  AppDock 开发服务已就绪（本机 + 局域网）",
  ];
  if (apiOk) {
    lines.push(`  API   http://127.0.0.1:${API_PORT}/api/v1`);
    for (const ip of ips) lines.push(`        http://${ip}:${API_PORT}/api/v1`);
  } else {
    lines.push(`  API   :${API_PORT} 尚未就绪（请向上翻 [server] 日志）`);
  }
  if (webPort) {
    lines.push(`  Web   http://127.0.0.1:${webPort}/admin/login`);
    for (const ip of ips) lines.push(`        http://${ip}:${webPort}/admin/login`);
  } else {
    lines.push("  Web   尚未就绪（请向上翻 [web] 日志）");
  }
  if (ips.length === 0) lines.push("  （未发现局域网 IPv4，仅可用 127.0.0.1）");
  lines.push("  ════════════════════════════════════════════════", "");
  for (const line of lines) console.log(line);
}

const apiOk = await waitApi();
const webPort = await waitWeb();
banner(apiOk, webPort);

// 保持进程存活，避免 concurrently 误判；每 60s 再探测并刷摘要
setInterval(async () => {
  const ok = await probe(`http://127.0.0.1:${API_PORT}/api/v1/health`);
  let port = webPort;
  if (!port) {
    for (const p of WEB_PORTS) {
      if (await probe(`http://127.0.0.1:${p}/`)) {
        port = p;
        break;
      }
    }
  }
  banner(ok, port);
}, 60_000);
