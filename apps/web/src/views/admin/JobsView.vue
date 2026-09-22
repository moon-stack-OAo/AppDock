<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { listApps, type AppView } from "@/api/apps";
import {
  getJob,
  listJobs,
  queueSummary,
  retryJob,
  type QueueSummary,
  type SyncJobDetail,
  type SyncJobItem,
} from "@/api/jobs";
import { ApiError } from "@/api/http";

const route = useRoute();
const router = useRouter();

const QUEUE_CARDS = [
  { name: "release-sync", label: "release-sync", note: "对应下方 SyncJob 列表" },
  { name: "asset-download", label: "asset-download", note: "无独立数据库行，仅 BullMQ 计数" },
  { name: "notify", label: "notify", note: "无独立数据库行，仅 BullMQ 计数" },
] as const;

const items = ref<SyncJobItem[]>([]);
const apps = ref<AppView[]>([]);
const summary = ref<QueueSummary | null>(null);
const total = ref(0);
const page = ref(1);
const status = ref("");
const appId = ref("");
const queue = ref("release-sync");
const loading = ref(true);
const error = ref("");
const detail = ref<SyncJobDetail | null>(null);
const detailError = ref("");
const busy = ref(false);

const statusLabel: Record<string, string> = {
  queued: "排队",
  running: "进行中",
  success: "成功",
  failed: "失败",
};
const triggerLabel: Record<string, string> = {
  manual: "手动",
  webhook: "Webhook",
  poll: "轮询",
};

function pillClass(value: string) {
  if (value === "success") return "pill pill-success";
  if (value === "failed") return "pill pill-danger";
  if (value === "running") return "pill pill-info";
  return "pill pill-muted";
}

function formatTime(value: string | null) {
  if (!value) return "—";
  return value.replace("T", " ").slice(0, 19);
}

function countsOf(name: string) {
  const row = summary.value?.queues?.[name];
  if (!summary.value?.redis || !row) return null;
  return row.waiting + row.active + row.failed;
}

async function loadSummary() {
  try {
    summary.value = await queueSummary();
  } catch {
    summary.value = { redis: false, queues: null };
  }
}

async function loadList() {
  error.value = "";
  loading.value = true;
  try {
    const result = await listJobs({
      queue: queue.value || undefined,
      status: status.value || undefined,
      appId: appId.value || undefined,
      page: page.value,
      pageSize: 20,
    });
    items.value = result.items;
    total.value = result.total;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载任务失败";
  } finally {
    loading.value = false;
  }
}

async function openJob(id: string) {
  detailError.value = "";
  try {
    detail.value = await getJob(id);
    await router.replace({ query: { ...route.query, job: id } });
  } catch (e) {
    detailError.value = e instanceof ApiError ? e.message : "加载详情失败";
  }
}

async function onRetry() {
  if (!detail.value) return;
  busy.value = true;
  detailError.value = "";
  try {
    const result = await retryJob(detail.value.id);
    await openJob(result.jobId);
    await Promise.all([loadList(), loadSummary()]);
  } catch (e) {
    detailError.value = e instanceof ApiError ? e.message : "重试失败";
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void loadList();
  void loadSummary();
  void listApps()
    .then((rows) => {
      apps.value = rows;
    })
    .catch(() => undefined);
  const job = typeof route.query.job === "string" ? route.query.job : "";
  if (job) void openJob(job);
});

watch([status, appId, queue], () => {
  page.value = 1;
  void loadList();
});
</script>

<template>
  <div>
    <div class="page-hd">
      <h1>同步任务</h1>
      <div class="sub">列表以数据库 SyncJob 为主。asset-download 与 notify 没有独立任务行，只在顶部计数。</div>
    </div>

    <div class="form-grid" style="margin-bottom: 16px; align-items: stretch">
      <div v-for="card in QUEUE_CARDS" :key="card.name" class="card card-pad">
        <div class="muted t-12">{{ card.label }}</div>
        <div class="t-16" style="font-weight: 600; margin-top: 6px">
          {{ summary === null ? "…" : countsOf(card.name) === null ? "队列不可用" : countsOf(card.name) }}
        </div>
        <div class="muted t-13" style="margin-top: 4px">
          <template v-if="countsOf(card.name) !== null && summary?.queues">
            等待 {{ summary.queues[card.name]?.waiting ?? 0 }}
            · 进行 {{ summary.queues[card.name]?.active ?? 0 }}
            · 失败 {{ summary.queues[card.name]?.failed ?? 0 }}
          </template>
          <template v-else>{{ card.note }}</template>
        </div>
      </div>
    </div>

    <div class="form-grid" style="margin-bottom: 16px; align-items: end">
      <div class="field">
        <label for="job-status">状态</label>
        <select id="job-status" v-model="status" class="select">
          <option value="">全部</option>
          <option value="queued">排队</option>
          <option value="running">进行中</option>
          <option value="success">成功</option>
          <option value="failed">失败</option>
        </select>
      </div>
      <div class="field">
        <label for="job-app">应用</label>
        <select id="job-app" v-model="appId" class="select">
          <option value="">全部</option>
          <option v-for="app in apps" :key="app.id" :value="app.id">{{ app.name }}</option>
        </select>
      </div>
      <div class="field">
        <label for="job-queue">队列</label>
        <select id="job-queue" v-model="queue" class="select">
          <option value="release-sync">release-sync</option>
          <option value="asset-download">asset-download</option>
          <option value="notify">notify</option>
        </select>
      </div>
    </div>
    <p v-if="queue !== 'release-sync'" class="muted t-13" style="margin-bottom: 12px">
      {{ queue }} 没有数据库任务行，计数见顶部。下列仍是 SyncJob。
    </p>

    <p v-if="loading" class="muted">加载中…</p>
    <div v-else-if="error" class="form-error">{{ error }}</div>
    <p v-else-if="items.length === 0" class="muted">还没有同步任务。</p>
    <div v-else class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>应用</th>
            <th>触发</th>
            <th>状态</th>
            <th>说明</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id" style="cursor: pointer" @click="openJob(item.id)">
            <td>{{ item.appName || item.appId }}</td>
            <td>{{ triggerLabel[item.trigger] || item.trigger }}</td>
            <td><span :class="pillClass(item.status)">{{ statusLabel[item.status] || item.status }}</span></td>
            <td class="muted">{{ item.message || "—" }}</td>
            <td class="mono t-12">{{ formatTime(item.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="total > 20" style="display: flex; gap: 8px; margin-top: 12px">
      <button type="button" class="btn btn-sm" :disabled="page <= 1" @click="page -= 1; loadList()">上一页</button>
      <span class="muted t-13">第 {{ page }} 页 / 共 {{ total }} 条</span>
      <button type="button" class="btn btn-sm" :disabled="page * 20 >= total" @click="page += 1; loadList()">下一页</button>
    </div>

    <div v-if="detail" class="card card-pad" style="margin-top: 20px">
      <div style="display: flex; justify-content: space-between; gap: 12px; align-items: center">
        <div>
          <strong>{{ detail.appName || detail.appId }}</strong>
          <span :class="pillClass(detail.status)" style="margin-left: 8px">{{ statusLabel[detail.status] || detail.status }}</span>
        </div>
        <button
          v-if="detail.status === 'failed'"
          type="button"
          class="btn btn-sm"
          :disabled="busy"
          @click="onRetry"
        >
          重试
        </button>
      </div>
      <p v-if="detail.stats" class="muted t-13" style="margin-top: 8px">
        版本 {{ detail.stats.syncedReleases ?? 0 }} · 产物 {{ detail.stats.syncedAssets ?? 0 }} · 跳过 {{ detail.stats.skippedAssets ?? 0 }} · 警告 {{ detail.stats.warnings ?? 0 }}
      </p>
      <div v-if="detailError" class="form-error" style="margin-top: 8px">{{ detailError }}</div>
      <div class="stack" style="margin-top: 12px">
        <div v-for="log in detail.logs" :key="log.id" class="t-13">
          <span class="mono muted">{{ formatTime(log.createdAt) }}</span>
          <span :class="log.level === 'error' ? 'pill pill-danger' : log.level === 'warning' ? 'pill pill-warn' : 'pill pill-muted'" style="margin: 0 8px">{{ log.level }}</span>
          {{ log.message }}
        </div>
        <p v-if="detail.logs.length === 0" class="muted">暂无日志。</p>
      </div>
    </div>
  </div>
</template>
