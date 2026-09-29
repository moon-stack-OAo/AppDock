<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { listApps, type AppView } from "@/api/apps";
import { listJobs, queueSummary, type QueueSummary, type SyncJobItem } from "@/api/jobs";
import { ApiError } from "@/api/http";

const apps = ref<AppView[]>([]);
const jobs = ref<SyncJobItem[]>([]);
const summary = ref<QueueSummary | null>(null);
const error = ref("");

const statusLabel: Record<string, string> = {
  queued: "排队",
  running: "进行中",
  success: "成功",
  failed: "失败",
};

const publicApps = computed(() => apps.value.filter((app) => app.visibility === "public").length);
const syncing = computed(
  () => apps.value.filter((app) => app.syncWebhookEnabled || app.syncPollEnabled).length,
);
const failedCount = computed(() => {
  const queues = summary.value?.queues;
  if (!queues) return jobs.value.filter((job) => job.status === "failed").length;
  return Object.values(queues).reduce((sum, row) => sum + row.failed, 0);
});
const todayKey = new Date().toISOString().slice(0, 10);
const todayNotify = computed(() =>
  jobs.value.filter((job) => job.queue === "notify" && job.createdAt.startsWith(todayKey)),
);
const notifyFail = computed(() => todayNotify.value.filter((job) => job.status === "failed").length);
const recent = computed(() => jobs.value.slice(0, 4));
const firstFailed = computed(() => jobs.value.find((job) => job.status === "failed") ?? null);

function duration(job: SyncJobItem) {
  if (!job.startedAt || !job.finishedAt) return "—";
  const ms = new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${Math.round(ms / 1000)}s`;
}

function pillClass(value: string) {
  if (value === "success") return "pill pill-success";
  if (value === "failed") return "pill pill-danger";
  if (value === "running") return "pill pill-info";
  return "pill pill-muted";
}

onMounted(async () => {
  try {
    const [appRows, jobPage, queue] = await Promise.all([
      listApps(),
      listJobs({ page: 1, pageSize: 5 }),
      queueSummary().catch(() => ({ redis: false, queues: null }) as QueueSummary),
    ]);
    apps.value = appRows;
    jobs.value = jobPage.items;
    summary.value = queue;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载概览失败";
  }
});
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h1>仪表盘</h1>
        <div class="sub">今日同步与队列概览</div>
      </div>
      <RouterLink class="btn btn-primary" to="/admin/apps/new">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        新建应用
      </RouterLink>
    </div>
    <div v-if="error" class="form-error" style="margin-bottom: 16px">{{ error }}</div>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">应用数</div>
        <div class="value">{{ apps.length }}</div>
        <div class="delta">公开 {{ publicApps }} · 受限 {{ apps.length - publicApps }}</div>
      </div>
      <div class="stat-card">
        <div class="label">自动同步</div>
        <div class="value">{{ syncing }}</div>
        <div class="delta">Webhook / 轮询</div>
      </div>
      <div class="stat-card">
        <div class="label">队列失败</div>
        <div class="value" :style="failedCount ? { color: 'var(--danger)' } : undefined">{{ failedCount }}</div>
        <div class="delta">{{ summary?.redis === false ? "队列不可用" : "需关注同步与通知失败" }}</div>
      </div>
      <div class="stat-card">
        <div class="label">今日邮件</div>
        <div class="value">{{ todayNotify.length }}</div>
        <div class="delta">{{ notifyFail ? `${notifyFail} 封失败` : "notify 队列 · 含下载链接" }}</div>
      </div>
    </div>
    <div class="split" :class="{ stretch: recent.length === 0 }">
      <div class="card card-pad">
        <div class="panel-title">最近任务</div>
        <div class="table-wrap" style="border: none">
          <table class="data">
            <thead>
              <tr><th>队列</th><th>应用</th><th>触发</th><th>状态</th><th>耗时</th></tr>
            </thead>
            <tbody>
              <tr v-if="recent.length === 0">
                <td colspan="5" class="muted">还没有同步任务。</td>
              </tr>
              <tr v-for="job in recent" :key="job.id">
                <td class="mono">{{ job.queue }}</td>
                <td>{{ job.appName || job.appSlug || "—" }}</td>
                <td><span class="pill pill-muted">{{ job.trigger }}</span></td>
                <td><span :class="pillClass(job.status)">{{ statusLabel[job.status] || job.status }}</span></td>
                <td class="mono muted">{{ duration(job) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style="margin-top: 12px"><RouterLink to="/admin/jobs">查看全部任务 →</RouterLink></div>
      </div>
      <div class="card card-pad">
        <div class="panel-title">快捷入口</div>
        <div style="display: flex; flex-direction: column; gap: 8px">
          <RouterLink class="btn" to="/admin/apps" style="justify-content: flex-start">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" /></svg>
            管理应用
          </RouterLink>
          <RouterLink class="btn" to="/admin/jobs" style="justify-content: flex-start">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
            任务队列
            <span v-if="failedCount" class="pill pill-danger">{{ failedCount }} 失败</span>
          </RouterLink>
          <RouterLink class="btn" to="/admin/settings" style="justify-content: flex-start">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></svg>
            系统设置
          </RouterLink>
        </div>
        <div v-if="firstFailed" class="fail-box">
          <strong>失败任务</strong>
          <div class="muted t-13" style="margin-top: 6px">{{ firstFailed.message || firstFailed.appName || "有任务失败" }}</div>
          <RouterLink class="btn btn-sm" to="/admin/jobs" style="margin-top: 10px">去重试</RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>
