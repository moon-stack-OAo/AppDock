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
      <h2>应用不存在</h2>
      <p>未知地址，或该应用已归档。</p>
      <RouterLink class="btn" to="/">返回目录</RouterLink>
    </div>
    <div v-else-if="gate === 'password'" class="card card-pad" style="max-width: 480px">
      <h1 class="t-20">需要访问口令</h1>
      <p class="muted" style="margin: 8px 0 16px">该应用为口令可见。请输入管理员签发的访问口令（仅解锁下载站）。</p>
      <form class="auth-stack" @submit.prevent="onUnlock">
        <div class="field">
          <label for="code">访问口令</label>
          <input id="code" v-model="accessCode" class="input mono" autocomplete="off" :disabled="unlocking" />
        </div>
        <div v-if="error" class="form-error">{{ error }}</div>
        <button class="btn btn-primary" type="submit" :disabled="unlocking">
          {{ unlocking ? "校验中…" : "解锁" }}
        </button>
      </form>
    </div>
    <div v-else-if="gate === 'login'" class="empty">
      <h2>需要登录</h2>
      <p>该应用仅对已登录用户开放下载。</p>
      <RouterLink class="btn btn-primary" :to="{ path: '/admin/login', query: { redirect: route.fullPath } }">
        去登录
      </RouterLink>
    </div>
    <div v-else-if="error" class="form-error">{{ error }}</div>
    <template v-else>
      <div class="page-hd">
        <div>
          <h1>{{ appName }}</h1>
          <div class="sub">{{ description || "暂无简介" }}</div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center">
          <label class="t-13 muted" style="display: flex; gap: 6px; align-items: center">
            <input v-model="includePrerelease" type="checkbox" />
            显示预发布
          </label>
          <button v-if="visibility === 'password'" type="button" class="btn btn-sm" @click="onLock">锁定</button>
        </div>
      </div>

      <div v-if="!shown" class="empty">
        <h2>还没有可下载的版本</h2>
        <p>稳定版发布后会显示在这里。</p>
      </div>
      <div v-else class="card card-pad" style="margin-bottom: 20px">
        <div style="display: flex; justify-content: space-between; gap: 12px; align-items: center">
          <div>
            <strong class="mono">{{ shown.tagName }}</strong>
            <span v-if="shown.isPrerelease" class="pill pill-warn" style="margin-left: 8px">预发布</span>
          </div>
          <span v-if="shown.publishedAt" class="muted t-12">{{ shown.publishedAt.slice(0, 10) }}</span>
        </div>
        <p v-if="shown.body" class="t-13" style="margin-top: 12px; white-space: pre-wrap">{{ shown.body }}</p>
        <div v-if="primary" style="margin-top: 16px">
          <a class="btn btn-primary" :href="primary.downloadUrl">
            下载 {{ platformLabel[primary.platform] || primary.platform }} · {{ primary.arch }}
          </a>
          <button type="button" class="btn btn-ghost" style="margin-left: 8px" @click="othersOpen = !othersOpen">
            {{ othersOpen ? "收起其他平台" : "其他平台" }}
          </button>
        </div>
        <div v-if="othersOpen || !primary" style="margin-top: 16px" class="stack">
          <div v-for="group in groups" :key="group.platform" style="margin-bottom: 12px">
            <div class="muted t-12">{{ platformLabel[group.platform] || group.platform }}</div>
            <div v-for="asset in group.assets" :key="asset.id" style="display: flex; gap: 8px; align-items: center; margin-top: 6px; flex-wrap: wrap">
              <a class="btn btn-sm" :href="asset.downloadUrl">{{ asset.name }}</a>
              <span class="muted t-12">{{ formatSize(asset.size) }} · {{ asset.arch }}</span>
              <button type="button" class="btn btn-ghost btn-sm" @click="copySha(asset.checksumSha256)">
                {{ copied === asset.checksumSha256 ? "已复制" : "复制 SHA256" }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <button type="button" class="btn btn-ghost" @click="historyOpen = !historyOpen">
        {{ historyOpen ? "收起历史版本" : "历史版本" }}
      </button>
      <div v-if="historyOpen" style="margin-top: 12px">
        <p v-if="history.length === 0" class="muted">没有其他版本。</p>
        <div v-for="version in history" :key="version.tagName" class="card" style="padding: 12px 16px; margin-bottom: 8px">
          <RouterLink :to="`/a/${slug}/v/${encodeURIComponent(version.tagName)}`" class="mono">
            {{ version.tagName }}
          </RouterLink>
          <span v-if="version.isPrerelease" class="pill pill-warn" style="margin-left: 8px">预发布</span>
        </div>
      </div>
      <p v-if="session.user" class="muted t-12" style="margin-top: 16px">已登录，登录可见的应用可直接下载。</p>
    </template>
  </div>
</template>
