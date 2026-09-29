#!/usr/bin/env node
/**
 * 打 Node 发行包（不含源码）：api / worker / web + 生产依赖。
 * 用法：在仓库根先 pnpm build && pnpm prisma:generate，再 node scripts/pack-release.mjs
 * 产物：dist/appdock-node.tgz、dist/latest.yml。解压后在该目录放 .env 即可启动。
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = path.join(root, "dist", "appdock-node");
const serverPkg = JSON.parse(
  fs.readFileSync(path.join(root, "apps/server/package.json"), "utf8"),
);

const prodDeps = { ...serverPkg.dependencies };
delete prodDeps["@appdock/shared"];
prodDeps["@prisma/client"] = serverPkg.dependencies["@prisma/client"];
prodDeps.prisma = serverPkg.devDependencies.prisma;
prodDeps.bcryptjs = serverPkg.dependencies.bcryptjs;
prodDeps.tsx = "^4.20.3";

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, "web"), { recursive: true });

fs.cpSync(path.join(root, "apps/server/dist"), path.join(stage, "dist"), { recursive: true });
fs.cpSync(path.join(root, "apps/web/dist"), path.join(stage, "web"), { recursive: true });
fs.cpSync(path.join(root, "apps/server/prisma"), path.join(stage, "prisma"), { recursive: true });
fs.copyFileSync(path.join(root, ".env.example"), path.join(stage, ".env.example"));

const pkg = {
  name: "appdock",
  private: true,
  type: "commonjs",
  scripts: {
    start: "node dist/main.js",
    worker: "node dist/worker.main.js",
    "prisma:push": "prisma db push",
    seed: "tsx prisma/seed.ts",
  },
  dependencies: prodDeps,
};
fs.writeFileSync(path.join(stage, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

const install = spawnSync("npm", ["install", "--omit=dev", "--ignore-scripts"], {
  cwd: stage,
  stdio: "inherit",
  shell: true,
});
if (install.status !== 0) process.exit(install.status ?? 1);

const generate = spawnSync(
  "npx",
  ["prisma", "generate", "--generator", "client"],
  {
    cwd: stage,
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      PRISMA_CLI_BINARY_TARGETS:
        "debian-openssl-3.0.x,rhel-openssl-3.0.x,linux-musl-openssl-3.0.x,darwin,darwin-arm64,windows",
    },
  },
);
if (generate.status !== 0) process.exit(generate.status ?? 1);

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const archive = path.join(root, "dist", "appdock-node.tgz");
fs.rmSync(archive, { force: true });
const packed = spawnSync("tar", ["-czf", archive, "-C", path.join(root, "dist"), "appdock-node"], {
  stdio: "inherit",
  shell: true,
});
if (packed.status !== 0) process.exit(packed.status ?? 1);

const version = (process.env.APPDOCK_VERSION || serverPkg.version || "0.0.0").replace(/^v/, "");
const sha256 = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
const size = fs.statSync(archive).size;
const repo =
  process.env.GITHUB_REPOSITORY ||
  process.env.APPDOCK_REPOSITORY ||
  "moon-stack-OAo/AppDock";
const base =
  process.env.APPDOCK_RELEASE_BASE?.replace(/\/$/, "") ||
  `https://github.com/${repo}/releases/download`;
const manifest = [
  `version: ${version}`,
  "files:",
  "  - url: appdock-node.tgz",
  `    sha256: ${sha256}`,
  `    size: ${size}`,
  `path: appdock-node.tgz`,
  `sha256: ${sha256}`,
  `releaseDate: ${new Date().toISOString()}`,
  `downloadUrl: ${base}/v${version}/appdock-node.tgz`,
  "",
].join("\n");
const latest = path.join(root, "dist", "latest.yml");
fs.writeFileSync(latest, manifest);
console.log(archive);
console.log(latest);
