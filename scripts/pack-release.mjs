#!/usr/bin/env node
/**
 * 打 Node 发行包（不含源码）：api / worker / web + 生产依赖。
 * 用法：在仓库根先 pnpm build && pnpm prisma:generate，再 node scripts/pack-release.mjs
 * 产物：dist/appdock-node.tgz，解压后在该目录放 .env 即可启动。
 */
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

const generate = spawnSync("npx", ["prisma", "generate"], {
  cwd: stage,
  stdio: "inherit",
  shell: true,
});
if (generate.status !== 0) process.exit(generate.status ?? 1);

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const archive = path.join(root, "dist", "appdock-node.tgz");
fs.rmSync(archive, { force: true });
const packed = spawnSync("tar", ["-czf", archive, "-C", path.join(root, "dist"), "appdock-node"], {
  stdio: "inherit",
  shell: true,
});
if (packed.status !== 0) process.exit(packed.status ?? 1);
console.log(archive);
