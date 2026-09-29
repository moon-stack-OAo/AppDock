#!/usr/bin/env node
/**
 * 打 Node 发行包（不含源码）：api / worker / web + 生产依赖。
 * 用法：在仓库根先 pnpm build && pnpm prisma:generate，再 node scripts/pack-release.mjs
 * 产物：dist/appdock-node-<平台>.tgz、dist/latest-<平台>.yml。解压后在该目录放 .env 即可启动。
 * 平台：linux（glibc/OpenSSL 3）、linux-musl、darwin、darwin-arm64、windows。
 * APPDOCK_PACK_TARGETS 可覆盖，逗号分隔。
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TARGETS = {
  linux: "debian-openssl-3.0.x",
  "linux-musl": "linux-musl-openssl-3.0.x",
  darwin: "darwin",
  "darwin-arm64": "darwin-arm64",
  windows: "windows",
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPkg = JSON.parse(
  fs.readFileSync(path.join(root, "apps/server/package.json"), "utf8"),
);
const selected = (process.env.APPDOCK_PACK_TARGETS || Object.keys(TARGETS).join(","))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const prodDeps = { ...serverPkg.dependencies };
delete prodDeps["@appdock/shared"];
prodDeps["@prisma/client"] = serverPkg.dependencies["@prisma/client"];
prodDeps.prisma = serverPkg.devDependencies.prisma;
prodDeps.bcryptjs = serverPkg.dependencies.bcryptjs;
prodDeps.tsx = "^4.20.3";

const version = (process.env.APPDOCK_VERSION || serverPkg.version || "0.0.0").replace(/^v/, "");
const repo =
  process.env.GITHUB_REPOSITORY ||
  process.env.APPDOCK_REPOSITORY ||
  "moon-stack-OAo/AppDock";
const base =
  process.env.APPDOCK_RELEASE_BASE?.replace(/\/$/, "") ||
  `https://github.com/${repo}/releases/download`;

fs.mkdirSync(path.join(root, "dist"), { recursive: true });

for (const name of selected) {
  const binary = TARGETS[name];
  if (!binary) {
    console.error(`未知平台 ${name}，可选：${Object.keys(TARGETS).join(", ")}`);
    process.exit(1);
  }
  const stage = path.join(root, "dist", "appdock-node");
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, "web"), { recursive: true });
  fs.cpSync(path.join(root, "apps/server/dist"), path.join(stage, "dist"), { recursive: true });
  fs.cpSync(path.join(root, "apps/web/dist"), path.join(stage, "web"), { recursive: true });
  fs.cpSync(path.join(root, "apps/server/prisma"), path.join(stage, "prisma"), { recursive: true });
  fs.copyFileSync(path.join(root, ".env.example"), path.join(stage, ".env.example"));
  fs.writeFileSync(path.join(stage, "TARGET"), `${name}\n`);

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

  const generate = spawnSync("npx", ["prisma", "generate", "--generator", "client"], {
    cwd: stage,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, PRISMA_CLI_BINARY_TARGETS: binary },
  });
  if (generate.status !== 0) process.exit(generate.status ?? 1);

  const file = `appdock-node-${name}.tgz`;
  const archive = path.join(root, "dist", file);
  fs.rmSync(archive, { force: true });
  const packed = spawnSync("tar", ["-czf", archive, "-C", path.join(root, "dist"), "appdock-node"], {
    stdio: "inherit",
    shell: true,
  });
  if (packed.status !== 0) process.exit(packed.status ?? 1);

  const sha256 = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
  const size = fs.statSync(archive).size;
  const manifest = [
    `version: ${version}`,
    `target: ${name}`,
    "files:",
    `  - url: ${file}`,
    `    sha256: ${sha256}`,
    `    size: ${size}`,
    `path: ${file}`,
    `sha256: ${sha256}`,
    `releaseDate: ${new Date().toISOString()}`,
    `downloadUrl: ${base}/v${version}/${file}`,
    "",
  ].join("\n");
  const latest = path.join(root, "dist", `latest-${name}.yml`);
  fs.writeFileSync(latest, manifest);
  console.log(`${archive} ${size}`);
  console.log(latest);
}

fs.rmSync(path.join(root, "dist", "appdock-node"), { recursive: true, force: true });
