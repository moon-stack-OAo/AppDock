/**
 * 加载仓库根 .env，并把相对 file: 路径解析到仓库根，再执行子命令。
 * 用法: node scripts/run-with-env.cjs -- prisma db push
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const serverDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(serverDir, "../..");
const envPath = path.join(repoRoot, ".env");

if (fs.existsSync(envPath)) {
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

function isAbs(p) {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

const dbUrl = process.env.APPDOCK_DATABASE_URL;
if (dbUrl && dbUrl.startsWith("file:")) {
  const raw = dbUrl.slice("file:".length);
  if (!isAbs(raw)) {
    const marker = raw.replace(/\\/g, "/").match(/(?:^|\/)(data\/.*)$/);
    const rel = marker ? marker[1] : raw.replace(/^\.\//, "");
    process.env.APPDOCK_DATABASE_URL = `file:${path.resolve(repoRoot, rel)}`;
  }
}

const args = process.argv.slice(2);
const dash = args.indexOf("--");
const cmdArgs = dash >= 0 ? args.slice(dash + 1) : args;
if (cmdArgs.length === 0) {
  console.error("usage: node scripts/run-with-env.cjs -- <command> [args...]");
  process.exit(1);
}

const result = spawnSync(cmdArgs[0], cmdArgs.slice(1), {
  stdio: "inherit",
  env: process.env,
  cwd: serverDir,
  shell: true,
});
process.exit(result.status ?? 1);
