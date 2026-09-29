<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  getJob,
  listJobs,
  retryJob,
  type SyncJobDetail,
  type SyncJobItem,
} from "@/api/jobs";
import { ApiError } from "@/api/http";

const route = useRoute();
const router = useRouter();

const items = ref<SyncJobItem[]>([]);
const total = ref(0);
const page = ref(1);
const status = ref("");
const appId = ref("");
const queue = ref("");
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

function duration(item: SyncJobItem) {
  if (!item.startedAt || !item.finishedAt) return "—";
  const ms = new Date(item.finishedAt).getTime() - new Date(item.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${Math.round(ms / 1000)}s`;
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

async function onRetry(id: string, reopen = false) {
  busy.value = true;
  detailError.value = "";
  try {
    const result = await retryJob(id);
    if (reopen) await openJob(result.jobId);
    else detail.value = null;
    await loadList();
  } catch (e) {
    detailError.value = e instanceof ApiError ? e.message : "重试失败";
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void loadList();
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
      <div>
        <h1>任务队列</h1>
        <div class="sub">release-sync / asset-download / notify · 点行查看日志</div>
      </div>
    </div>

    <div class="filter-chips" style="margin-bottom: 8px">
      <button type="button" class="chip" :class="{ active: queue === '' }" @click="queue = ''">全部队列</button>
      <button type="button" class="chip" :class="{ active: queue === 'release-sync' }" @click="queue = 'release-sync'">release-sync</button>
      <button type="button" class="chip" :class="{ active: queue === 'asset-download' }" @click="queue = 'asset-download'">asset-download</button>
      <button type="button" class="chip" :class="{ active: queue === 'notify' }" @click="queue = 'notify'">notify</button>
    </div>
    <div class="filter-chips" style="margin-bottom: 16px">
      <button type="button" class="chip" :class="{ active: status === '' }" @click="status = ''">全部状态</button>
      <button type="button" class="chip" :class="{ active: status === 'success' }" @click="status = 'success'">success</button>
      <button type="button" class="chip" :class="{ active: status === 'running' }" @click="status = 'running'">running</button>
      <button type="button" class="chip" :class="{ active: status === 'failed' }" @click="status = 'failed'">failed</button>
    </div>

    <p v-if="loading" class="muted">加载中…</p>
    <div v-else-if="error" class="form-error">{{ error }}</div>
    <div v-else-if="items.length === 0" class="empty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
      <h2>还没有同步任务</h2>
      <p>手动同步、Webhook 或轮询产生任务后会列在这里。</p>
    </div>
    <div v-else class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>ID</th>
            <th>队列</th>
            <th>应用</th>
            <th>Trigger</th>
            <th>状态</th>
            <th>耗时</th>
            <th>时间</th>
            <th>消息</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id" style="cursor: pointer" @click="openJob(item.id)">
            <td class="mono t-12">{{ item.id.slice(0, 8) }}</td>
            <td class="mono">{{ item.queue }}</td>
            <td>{{ item.appName || item.appId }}</td>
            <td><span class="pill pill-muted">{{ triggerLabel[item.trigger] || item.trigger }}</span></td>
            <td><span :class="pillClass(item.status)">{{ statusLabel[item.status] || item.status }}</span></td>
            <td class="mono">{{ duration(item) }}</td>
            <td class="mono muted t-12">{{ formatTime(item.createdAt) }}</td>
            <td class="muted t-12" style="max-width: 220px">{{ item.message || "—" }}</td>
            <td @click.stop>
              <button v-if="item.status === 'failed'" type="button" class="btn btn-sm" :disabled="busy" @click="onRetry(item.id)">重试</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="total > 20" style="display: flex; gap: 8px; margin-top: 12px">
      <button type="button" class="btn btn-sm" :disabled="page <= 1" @click="page -= 1; loadList()">上一页</button>
      <span class="muted t-13">第 {{ page }} 页 / 共 {{ total }} 条</span>
      <button type="button" class="btn btn-sm" :disabled="page * 20 >= total" @click="page += 1; loadList()">下一页</button>
    </div>

    <div v-if="detail" class="modal-backdrop" @click.self="detail = null">
      <div class="modal wide">
        <div class="modal-hd">任务 {{ detail.id.slice(0, 8) }}</div>
        <div class="modal-bd stack" style="font-size: 13px">
          <div>
            <span class="muted">队列</span> · <span class="mono">{{ detail.queue }}</span> · {{ detail.appName || detail.appId }} ·
            <span :class="pillClass(detail.status)">{{ statusLabel[detail.status] || detail.status }}</span>
          </div>
          <div class="muted">{{ detail.message || "—" }}</div>
          <div v-if="detailError" class="form-error">{{ detailError }}</div>
          <div class="panel-title" style="margin-top: 8px">同步日志</div>
          <pre class="log-pre">{{ detail.logs.length ? detail.logs.map((log) => `${formatTime(log.createdAt)} ${log.level} ${log.message}`).join("\n") : "（无日志）" }}</pre>
        </div>
        <div class="modal-ft">
          <button type="button" class="btn" @click="detail = null">关闭</button>
          <button v-if="detail.status === 'failed'" type="button" class="btn btn-primary" :disabled="busy" @click="onRetry(detail.id, true)">
            重试
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
