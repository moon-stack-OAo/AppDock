<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { listPublicApps, type PublicAppCard } from "@/api/public";
import { ApiError } from "@/api/http";

const apps = ref<PublicAppCard[]>([]);
const query = ref("");
const error = ref("");
const loading = ref(true);

const visibilityLabel: Record<string, string> = {
  public: "公开",
  password: "需口令",
  login: "需登录",
};
const visibilityTone: Record<string, string> = {
  public: "pill-success",
  password: "pill-warn",
  login: "pill-info",
};

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return apps.value;
  return apps.value.filter(
    (app) => app.name.toLowerCase().includes(q) || app.slug.toLowerCase().includes(q),
  );
});

const iconHues = [195, 145, 250, 85, 25, 310];

function initials(name: string) {
  const chars = name.trim().slice(0, 2);
  return chars || "A";
}

function iconColor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash + char.charCodeAt(0)) % iconHues.length;
  return `oklch(72% 0.13 ${iconHues[hash]})`;
}

onMounted(async () => {
  try {
    apps.value = await listPublicApps();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载应用目录失败";
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div>
    <div class="hero">
      <h1>应用下载中心</h1>
      <p>从 GitHub Release 同步安装包到自建存储，提供国内可达下载。支持公开、口令与登录可见性。</p>
      <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap">
        <RouterLink class="btn btn-sm" to="/docs/update-check">更新检查 API</RouterLink>
      </div>
    </div>
    <div class="toolbar">
      <div class="search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input v-model="query" class="input" placeholder="搜索应用名称或 slug…" />
      </div>
    </div>
    <p v-if="loading" class="muted">加载中…</p>
    <div v-else-if="error" class="form-error">{{ error }}</div>
    <div v-else-if="filtered.length === 0" class="empty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" />
      </svg>
      <h2>没有匹配的应用</h2>
      <p>调整搜索关键词后再试，或等管理员发布应用。</p>
    </div>
    <div v-else class="app-grid">
      <RouterLink v-for="app in filtered" :key="app.id" class="app-card" :to="`/a/${app.slug}`">
        <div style="display: flex; gap: 14px; align-items: flex-start">
          <div class="app-icon" :style="{ background: iconColor(app.name) }">{{ initials(app.name) }}</div>
          <div style="flex: 1; min-width: 0">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px">
              <strong class="t-16">{{ app.name }}</strong>
              <span class="pill" :class="visibilityTone[app.visibility] || 'pill-muted'">
                {{ visibilityLabel[app.visibility] || app.visibility }}
              </span>
            </div>
            <div class="muted t-13 line-clamp">{{ app.description || "暂无简介" }}</div>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span class="mono muted t-12">{{ app.slug }}</span>
          <span class="muted t-12">查看详情 →</span>
        </div>
      </RouterLink>
    </div>
  </div>
</template>
