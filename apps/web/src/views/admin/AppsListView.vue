<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { listApps, type AppView } from "@/api/apps";
import { ApiError } from "@/api/http";
import { session } from "@/auth/session";

const router = useRouter();
const apps = ref<AppView[]>([]);
const error = ref("");
const loading = ref(true);

const isAdmin = computed(() => session.user?.role === "admin");

const visibilityLabel: Record<string, string> = {
  public: "公开",
  password: "口令",
  login: "登录",
};

const iconHues = [195, 145, 250, 85, 25, 310];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0];
  const b = parts[1]?.[0];
  if (a && b) return (a + b).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function iconColor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash + char.charCodeAt(0)) % iconHues.length;
  return `oklch(72% 0.13 ${iconHues[hash]})`;
}

function visTone(v: string) {
  if (v === "public") return "success";
  if (v === "password") return "warn";
  return "info";
}

function syncText(app: AppView) {
  const wh = app.syncWebhookEnabled;
  const poll = app.syncPollEnabled;
  if (wh && poll) return "Webhook+轮询";
  if (wh) return "仅 Webhook";
  if (poll) return "仅轮询";
  return "手动";
}

function syncTone(app: AppView) {
  const text = syncText(app);
  if (text === "手动") return "muted";
  if (text === "Webhook+轮询") return "accent";
  return "info";
}

function releaseRef(app: AppView) {
  if (app.releaseProvider === "none" || !app.releaseOwner) return "未绑定同步源";
  const base = `${app.releaseProvider}:${app.releaseOwner}/${app.releaseRepo ?? ""}`;
  return app.releaseProvider === "gitee" || app.releaseProvider === "gitlab"
    ? `${base} · 二期`
    : base;
}

onMounted(async () => {
  try {
    apps.value = await listApps();
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载应用失败";
  } finally {
    loading.value = false;
  }
});

function open(id: string) {
  void router.push({ name: "admin-app-detail", params: { id } });
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h1>应用</h1>
        <div class="sub">管理可见性、Release 同步源与成员授权</div>
      </div>
      <RouterLink v-if="isAdmin" class="btn btn-primary" to="/admin/apps/new">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        新建应用
      </RouterLink>
    </div>

    <div v-if="error" class="form-error">{{ error }}</div>
    <p v-else-if="loading" class="muted">加载中…</p>
    <div v-else-if="apps.length === 0" class="empty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" /></svg>
      <h2>还没有应用</h2>
      <p>创建一个应用后即可配置可见性与同步源。</p>
      <RouterLink v-if="isAdmin" class="btn btn-primary" to="/admin/apps/new">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        新建应用
      </RouterLink>
    </div>
    <div v-else class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>应用</th>
            <th>Slug</th>
            <th>可见性</th>
            <th>同步</th>
            <th>状态</th>
            <th>最近更新</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="app in apps" :key="app.id" style="cursor: pointer" @click="open(app.id)">
            <td>
              <div style="display: flex; gap: 10px; align-items: center">
                <div class="app-icon sm" :style="{ background: iconColor(app.name) }">{{ initials(app.name) }}</div>
                <div>
                  <div style="font-weight: 600">{{ app.name }}</div>
                  <div class="muted t-12">{{ releaseRef(app) }}</div>
                </div>
              </div>
            </td>
            <td class="mono">{{ app.slug }}</td>
            <td>
              <span class="pill" :class="`pill-${visTone(app.visibility)}`">
                {{ visibilityLabel[app.visibility] ?? app.visibility }}
              </span>
            </td>
            <td>
              <div><span class="pill" :class="`pill-${syncTone(app)}`">{{ syncText(app) }}</span></div>
              <div class="muted t-12" style="margin-top: 4px">{{ releaseRef(app) }}</div>
            </td>
            <td>
              <span class="pill" :class="app.status === 'archived' ? 'pill-muted' : 'pill-success'">
                {{ app.status === "archived" ? "已归档" : "启用" }}
              </span>
            </td>
            <td class="mono t-12">{{ app.updatedAt.slice(0, 10) }}</td>
            <td>
              <RouterLink
                class="btn btn-sm"
                :to="{ name: 'admin-app-detail', params: { id: app.id } }"
                @click.stop
              >
                管理
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
