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
    <div class="page-hd">
      <div>
        <h1>应用目录</h1>
        <div class="sub">公开、口令、登录应用都会列出。点进详情后再按可见性拦截。</div>
      </div>
      <input v-model="query" class="input" style="max-width: 240px" placeholder="搜索名称" />
    </div>
    <p v-if="loading" class="muted">加载中…</p>
    <div v-else-if="error" class="form-error">{{ error }}</div>
    <div v-else-if="filtered.length === 0" class="empty">
      <h2>没有匹配的应用</h2>
      <p>换个关键词，或等管理员发布应用。</p>
    </div>
    <div v-else class="form-grid">
      <RouterLink
        v-for="app in filtered"
        :key="app.id"
        class="card card-pad"
        :to="`/a/${app.slug}`"
        style="color: inherit; text-decoration: none"
      >
        <div style="display: flex; justify-content: space-between; gap: 12px; align-items: center">
          <strong>{{ app.name }}</strong>
          <span class="pill" :class="visibilityTone[app.visibility] || 'pill-muted'">
            {{ visibilityLabel[app.visibility] || app.visibility }}
          </span>
        </div>
        <p class="muted t-13" style="margin-top: 8px">{{ app.description || "暂无简介" }}</p>
      </RouterLink>
    </div>
  </div>
</template>
