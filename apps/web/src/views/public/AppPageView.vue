<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { ApiError } from "@/api/http";
import {
  getPublicApp,
  getPublicVersion,
  listPublicVersions,
  lockApp,
  unlockApp,
  type PublicAsset,
  type PublicVersion,
} from "@/api/public";
import { session } from "@/auth/session";

const PRE_KEY = "appdock.includePrerelease";
const route = useRoute();
const slug = computed(() => String(route.params.slug ?? ""));
const tag = computed(() => (route.params.tag ? String(route.params.tag) : ""));

const appName = ref("");
const description = ref("");
const visibility = ref("");
const latest = ref<PublicVersion | null>(null);
const versions = ref<PublicVersion[]>([]);
const focused = ref<PublicVersion | null>(null);
const includePrerelease = ref(false);
const historyOpen = ref(false);
const othersOpen = ref(false);
const accessCode = ref("");
const error = ref("");
const gate = ref<"" | "password" | "login" | "notfound">("");
const loading = ref(true);
const unlocking = ref(false);
const copied = ref("");

const platformOrder = ["windows", "macos", "linux", "android", "ios", "web", "unknown"];
const platformLabel: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  android: "Android",
  ios: "iOS",
  web: "Web",
  unknown: "其他",
};

function detectPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("android")) return "android";
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "macos";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

const shown = computed(() => focused.value ?? latest.value);
const groups = computed(() => {
  const assets = shown.value?.assets ?? [];
  const map = new Map<string, PublicAsset[]>();
  for (const asset of assets) {
    const key = asset.platform || "unknown";
    const list = map.get(key) ?? [];
    list.push(asset);
    map.set(key, list);
  }
  return platformOrder
    .filter((key) => map.has(key))
    .map((key) => ({ platform: key, assets: map.get(key)! }));
});
const preferred = computed(() => detectPlatform());
const primary = computed(() => {
  const group = groups.value.find((item) => item.platform === preferred.value);
  return group?.assets[0] ?? null;
});
const history = computed(() =>
  versions.value.filter((item) => item.tagName !== shown.value?.tagName),
);

function errGate(e: unknown) {
  if (!(e instanceof ApiError)) return "加载失败";
  if (e.status === 404) {
    gate.value = "notfound";
    return "";
  }
  if (e.code === "PASSWORD_REQUIRED") {
    gate.value = "password";
    return "";
  }
  if (e.code === "LOGIN_REQUIRED" || (e.status === 403 && visibility.value !== "password")) {
    gate.value = "login";
    return "";
  }
  if (e.status === 401 || e.status === 403) {
    gate.value = visibility.value === "login" ? "login" : "password";
    return "";
  }
  return e.message;
}

async function load() {
  loading.value = true;
  error.value = "";
  gate.value = "";
  focused.value = null;
  try {
    const detail = await getPublicApp(slug.value);
    appName.value = detail.app.name;
    description.value = detail.app.description ?? "";
    visibility.value = detail.app.visibility;
    latest.value = detail.latest;
    versions.value = await listPublicVersions(slug.value, includePrerelease.value);
    if (tag.value) {
      focused.value = await getPublicVersion(slug.value, tag.value);
    }
  } catch (e) {
    error.value = errGate(e);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  includePrerelease.value = localStorage.getItem(PRE_KEY) === "1";
  void load();
});

watch([slug, tag], () => {
  void load();
});

watch(includePrerelease, async (value) => {
  localStorage.setItem(PRE_KEY, value ? "1" : "0");
  if (gate.value || loading.value) return;
  try {
    versions.value = await listPublicVersions(slug.value, value);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载版本失败";
  }
});

async function onUnlock() {
  error.value = "";
  if (!accessCode.value.trim()) {
    error.value = "请输入访问口令";
    return;
  }
  unlocking.value = true;
  try {
    await unlockApp(slug.value, accessCode.value.trim());
    accessCode.value = "";
    await load();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "口令无效或已失效";
  } finally {
    unlocking.value = false;
  }
}

async function onLock() {
  await lockApp(slug.value).catch(() => undefined);
  gate.value = "password";
  latest.value = null;
  versions.value = [];
  focused.value = null;
}

async function copySha(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    copied.value = value;
  } catch {
    copied.value = "";
  }
}

const iconHues = [195, 145, 250, 85, 25, 310];

function iconColor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash + char.charCodeAt(0)) % iconHues.length;
  return `oklch(72% 0.13 ${iconHues[hash]})`;
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<template>
  <div>
    <p v-if="loading" class="muted">加载中…</p>
    <div v-else-if="gate === 'notfound'" class="empty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 9v4m0 4h.01M10.3 4.3L2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      </svg>
      <h2>应用不存在</h2>
      <p>未知地址，或该应用已归档。</p>
      <div class="empty-actions">
        <RouterLink class="btn" to="/">返回首页</RouterLink>
        <RouterLink class="btn btn-ghost" to="/docs/update-check">更新 API 文档</RouterLink>
      </div>
    </div>
    <div v-else-if="gate === 'password'" class="gate-wrap">
      <div class="auth-card">
        <h1>需要访问口令</h1>
        <p class="lead">「{{ appName || slug }}」为口令可见。请输入管理员签发的访问口令继续（仅解锁下载站）。</p>
        <form class="auth-stack" @submit.prevent="onUnlock">
          <div class="field">
            <label for="code">访问口令</label>
            <input id="code" v-model="accessCode" class="input mono" type="password" autocomplete="off" placeholder="例如 dock_…" :disabled="unlocking" />
          </div>
          <div v-if="error" class="form-error">{{ error }}</div>
          <button class="btn btn-primary btn-block" type="submit" :disabled="unlocking">
            {{ unlocking ? "校验中…" : "继续访问" }}
          </button>
          <RouterLink class="btn btn-ghost btn-block" to="/">返回首页</RouterLink>
        </form>
      </div>
    </div>
    <div v-else-if="gate === 'login'" class="gate-wrap">
      <div class="auth-card">
        <h1>登录后下载</h1>
        <p class="lead">此应用仅对已登录用户可见。登录成功后会回到应用详情。</p>
        <div class="auth-stack">
          <RouterLink class="btn btn-primary btn-block" :to="{ path: '/admin/login', query: { redirect: route.fullPath } }">
            去登录
          </RouterLink>
          <RouterLink class="btn btn-ghost btn-block" to="/">返回首页</RouterLink>
        </div>
      </div>
    </div>
    <div v-else-if="error" class="form-error">{{ error }}</div>
    <template v-else-if="tag && shown">
      <div class="breadcrumb">
        <RouterLink to="/">应用目录</RouterLink><span>/</span>
        <RouterLink :to="`/a/${slug}`">{{ appName }}</RouterLink><span>/</span>
        <span class="mono">{{ shown.tagName }}</span>
      </div>
      <div class="page-hd">
        <div>
          <h1 class="t-24">{{ appName }} <span class="mono muted">{{ shown.tagName }}</span>
            <span v-if="shown.isPrerelease" class="pill pill-warn">预发布</span>
          </h1>
          <div class="sub">{{ shown.publishedAt ? `发布于 ${shown.publishedAt.slice(0, 10)} · ` : "" }}{{ shown.assets.length }} 个安装包</div>
        </div>
      </div>
      <div class="table-wrap" style="margin-bottom: 24px">
        <table class="data">
          <thead>
            <tr><th>文件名</th><th>平台</th><th>大小</th><th>SHA256</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="asset in shown.assets" :key="asset.id">
              <td class="mono">{{ asset.name }}</td>
              <td>{{ platformLabel[asset.platform] || asset.platform }}</td>
              <td class="mono">{{ formatSize(asset.size) }}</td>
              <td class="mono muted t-12" :title="asset.checksumSha256">{{ asset.checksumSha256.slice(0, 20) }}…</td>
              <td style="white-space: nowrap">
                <button type="button" class="btn btn-sm" @click="copySha(asset.checksumSha256)">
                  {{ copied === asset.checksumSha256 ? "已复制" : "校验和" }}
                </button>
                <a class="btn btn-primary btn-sm" :href="asset.downloadUrl" style="margin-left: 6px">下载</a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="shown.body" class="changelog">{{ shown.body }}</div>
    </template>
    <template v-else>
      <div class="breadcrumb">
        <RouterLink to="/">应用目录</RouterLink><span>/</span><span>{{ appName }}</span>
      </div>
      <div class="app-hero">
        <div class="app-icon lg" :style="{ background: iconColor(appName || 'A') }">{{ (appName || "A").slice(0, 2) }}</div>
        <div style="flex: 1">
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap">
            <h1>{{ appName }}</h1>
            <span v-if="shown" class="mono muted">{{ shown.tagName }}</span>
            <span v-if="shown?.isPrerelease" class="pill pill-warn">预发布</span>
          </div>
          <p class="muted" style="margin-top: 6px; max-width: 640px">{{ description || "暂无简介" }}</p>
          <div style="display: flex; gap: 16px; align-items: center; margin-top: 12px; flex-wrap: wrap">
            <label class="t-13 muted" style="display: inline-flex; align-items: center; gap: 8px">
              <input v-model="includePrerelease" type="checkbox" />
              显示预发布版本
            </label>
            <button v-if="visibility === 'password'" type="button" class="btn btn-sm" @click="onLock">锁定</button>
          </div>
        </div>
      </div>

      <div v-if="!shown" class="empty">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
        </svg>
        <h2>暂无版本</h2>
        <p>该应用尚未发布任何安装包。</p>
        <div class="empty-actions">
          <RouterLink class="btn" to="/">返回首页</RouterLink>
        </div>
      </div>
      <template v-else>
        <div v-if="primary" class="card card-pad" style="margin-bottom: 20px">
          <div style="display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: center">
            <div>
              <div style="font-weight: 650; font-size: 15px">推荐下载 · {{ platformLabel[preferred] || preferred }}</div>
              <div class="mono t-13" style="margin-top: 6px">{{ primary.name }}</div>
              <div class="muted t-12" style="margin-top: 4px">{{ formatSize(primary.size) }} · 根据当前设备推荐，可切换其他平台</div>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap">
              <button type="button" class="btn" @click="copySha(primary.checksumSha256)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 8h12v12H8V8zm-4 4h2v10h10v2H4V12z" /></svg>
                {{ copied === primary.checksumSha256 ? "已复制" : "复制校验和" }}
              </button>
              <a class="btn btn-primary" :href="primary.downloadUrl">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" /></svg>
                下载 {{ platformLabel[preferred] || preferred }} 版
              </a>
            </div>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px">
          <h2 class="t-16" style="font-weight: 600">全部平台 · {{ shown.tagName }}</h2>
          <button type="button" class="btn btn-sm btn-ghost" @click="othersOpen = !othersOpen">
            {{ othersOpen ? "收起" : "展开其他平台" }}
          </button>
        </div>
        <div v-if="othersOpen" class="dl-groups">
          <div v-for="group in groups" :key="group.platform" class="dl-group" :class="{ featured: group.platform === preferred }">
            <div class="dl-group-hd">
              <strong>{{ platformLabel[group.platform] || group.platform }}{{ group.platform === preferred ? " · 推荐" : "" }}</strong>
              <span class="muted mono t-12">{{ group.assets.length }} 个文件</span>
            </div>
            <div v-for="asset in group.assets" :key="asset.id" class="dl-asset">
              <div class="dl-meta">
                <div class="dl-name">{{ asset.name }}</div>
                <div class="dl-sub">{{ formatSize(asset.size) }} · {{ asset.arch }} · sha256:{{ asset.checksumSha256.slice(0, 16) }}…</div>
              </div>
              <div style="display: flex; gap: 6px">
                <button type="button" class="btn btn-sm" @click="copySha(asset.checksumSha256)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 8h12v12H8V8zm-4 4h2v10h10v2H4V12z" /></svg>
                  {{ copied === asset.checksumSha256 ? "已复制" : "校验和" }}
                </button>
                <a class="btn btn-primary btn-sm" :href="asset.downloadUrl">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" /></svg>
                  下载
                </a>
              </div>
            </div>
          </div>
        </div>

        <h2 v-if="shown.body" class="t-16" style="font-weight: 600; margin: 28px 0 12px">更新说明</h2>
        <div v-if="shown.body" class="changelog">{{ shown.body }}</div>

        <div style="margin-top: 28px">
          <button type="button" class="collapse-hd" @click="historyOpen = !historyOpen">
            <span>历史版本（{{ history.length }}）</span>
            <span class="muted">{{ historyOpen ? "收起" : "展开" }}</span>
          </button>
          <div v-if="historyOpen" class="ver-list">
            <p v-if="history.length === 0" class="muted t-13" style="padding: 12px">没有更多历史版本（或已隐藏预发布）。</p>
            <div v-for="version in history" :key="version.tagName" class="ver-row">
              <div style="flex: 1">
                <RouterLink :to="`/a/${slug}/v/${encodeURIComponent(version.tagName)}`" class="mono" style="font-weight: 600">
                  {{ version.tagName }}
                </RouterLink>
                <span v-if="version.isPrerelease" class="pill pill-warn" style="margin-left: 8px">预发布</span>
                <div class="muted t-12">{{ version.publishedAt?.slice(0, 10) || "未标注日期" }} · {{ version.assets.length }} 个资产</div>
              </div>
              <RouterLink class="btn btn-sm" :to="`/a/${slug}/v/${encodeURIComponent(version.tagName)}`">查看</RouterLink>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
