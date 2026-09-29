<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import {
  archiveApp,
  deleteAsset,
  getApp,
  listMembers,
  listVersions,
  removeMember,
  unarchiveApp,
  uploadAssets,
  uploadVersion,
  upsertMember,
  yankVersion,
  type AppDetail,
  type AppMember,
  type AppVersion,
} from "@/api/apps";
import { listUsers as fetchUsers, type AdminUser } from "@/api/users";
import { syncApp } from "@/api/jobs";
import { getAppNotify, patchAppNotify, testAppNotify, type AppNotify } from "@/api/settings";
import { ApiError } from "@/api/http";
import { session } from "@/auth/session";

const route = useRoute();
const appId = computed(() => String(route.params.id ?? ""));

const app = ref<AppDetail | null>(null);
const members = ref<AppMember[]>([]);
const versions = ref<AppVersion[]>([]);
const tab = ref<"overview" | "versions" | "upload" | "members" | "sync" | "notify">("overview");
const dragOver = ref(false);
const pickInput = ref<HTMLInputElement | null>(null);
const users = ref<AdminUser[]>([]);
const error = ref("");
const memberError = ref("");
const loading = ref(true);
const busy = ref(false);

const userId = ref("");
const permission = ref("viewer");
const tagName = ref("");
const releaseName = ref("");
const changelog = ref("");
const isPrerelease = ref(false);
const appendVersionId = ref("");
const uploadMode = ref<"new" | "append">("new");
const pickedFiles = ref<PickedFile[]>([]);
const pendingOverwrite = ref<File | null>(null);
const uploadError = ref("");
const toast = ref("");
const toastTone = ref<"ok" | "warn">("ok");
let toastTimer = 0;
const notify = ref<AppNotify | null>(null);
const notifyEmailsText = ref("");
const memberRoles = ["viewer", "operator", "manager"] as const;
const permissionLabel: Record<string, string> = {
  viewer: "viewer 查看者",
  operator: "operator 操作员",
  manager: "manager 管理员",
};
const platformOptions = ["windows", "macos", "linux", "android"] as const;
const archOptions = ["x64", "arm64", "universal"] as const;

type PickedFile = {
  file: File;
  platform: string;
  arch: string;
};

const isAdmin = computed(() => session.user?.role === "admin");
const canManage = computed(
  () => app.value?.myPermission === "admin" || app.value?.myPermission === "manager",
);
const canOperate = computed(
  () => canManage.value || app.value?.myPermission === "operator",
);

const visibilityLabel: Record<string, string> = {
  public: "公开",
  password: "口令",
  login: "登录",
};
const providerLabel: Record<string, string> = {
  none: "手动",
  github: "github",
  gitee: "gitee（二期）",
  gitlab: "gitlab（二期）",
};
const statusLabel: Record<string, string> = {
  active: "活跃",
  archived: "已归档",
};
const visibilityTone: Record<string, string> = {
  public: "pill-success",
  password: "pill-warn",
  login: "pill-info",
};

const latestVersion = computed(() => {
  const list = versions.value.filter((version) => version.status !== "yanked");
  return list.find((version) => version.isLatest) ?? list[0] ?? null;
});

function syncModeText(row: AppDetail) {
  if (!canAutoSync(row)) return "手动";
  const webhook = row.syncWebhookEnabled;
  const poll = row.syncPollEnabled;
  if (webhook && poll) return "Webhook+轮询";
  if (webhook) return "仅 Webhook";
  if (poll) return "仅轮询";
  return "手动";
}

function syncModeTone(text: string) {
  if (text === "手动") return "pill-muted";
  if (text === "Webhook+轮询") return "pill-accent";
  return "pill-info";
}

function syncStatusText(row: AppDetail) {
  if (!canAutoSync(row) || (!row.syncWebhookEnabled && !row.syncPollEnabled)) return "仅手动";
  return "同步正常";
}
function label(map: Record<string, string>, value: string) {
  return map[value] ?? value;
}

function releaseRef(row: AppDetail) {
  if (!row.releaseOwner || !row.releaseRepo) return "未绑定同步源";
  return `${row.releaseOwner}/${row.releaseRepo}`;
}

function canAutoSync(row: AppDetail) {
  return row.providerStatus === "implemented" && Boolean(row.releaseOwner && row.releaseRepo);
}

async function load() {
  error.value = "";
  loading.value = true;
  try {
    const [detail, memberRows, versionRows] = await Promise.all([
      getApp(appId.value),
      listMembers(appId.value),
      listVersions(appId.value),
    ]);
    app.value = detail;
    members.value = memberRows;
    versions.value = versionRows;
    if (detail.myPermission === "admin" || detail.myPermission === "manager") {
      try {
        const row = await getAppNotify(appId.value);
        notify.value = row;
        notifyEmailsText.value = row.notifyEmails.join("\n");
      } catch (e) {
        notify.value = null;
        memberError.value = e instanceof ApiError ? e.message : "加载通知设置失败";
      }
    }
    if (isAdmin.value && (detail.myPermission === "admin" || detail.myPermission === "manager")) {
      try {
        users.value = await fetchUsers();
      } catch (e) {
        users.value = [];
        memberError.value = e instanceof ApiError ? e.message : "加载用户列表失败";
      }
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载应用失败";
  } finally {
    loading.value = false;
  }
}

function showToast(message: string, tone: "ok" | "warn" = "ok") {
  toast.value = message;
  toastTone.value = tone;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = "";
  }, 2400);
}

onMounted(() => {
  if (route.query.warning === "PROVIDER_NOT_IMPLEMENTED") {
    showToast("已保存，同步开关已关闭（该 Provider 二期）", "warn");
  } else if (route.query.saved === "1") {
    showToast("应用已保存");
  }
  void load();
});

async function onSync() {
  if (!app.value) return;
  busy.value = true;
  error.value = "";
  try {
    const result = await syncApp(app.value.id);
    showToast(`已入队 ${result.jobId}`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "同步入队失败";
  } finally {
    busy.value = false;
  }
}

async function onArchive() {
  if (!app.value) return;
  busy.value = true;
  error.value = "";
  try {
    app.value =
      app.value.status === "archived"
        ? await unarchiveApp(app.value.id)
        : await archiveApp(app.value.id);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "操作失败";
  } finally {
    busy.value = false;
  }
}

async function onUpsert() {
  memberError.value = "";
  const id = userId.value.trim();
  if (!id) {
    memberError.value = "请选择或填写用户";
    return;
  }
  busy.value = true;
  try {
    await upsertMember(appId.value, { userId: id, permission: permission.value });
    members.value = await listMembers(appId.value);
    userId.value = "";
    permission.value = "viewer";
  } catch (e) {
    memberError.value = e instanceof ApiError ? e.message : "保存成员失败";
  } finally {
    busy.value = false;
  }
}

async function onChangePermission(member: AppMember, next: string) {
  memberError.value = "";
  busy.value = true;
  try {
    await upsertMember(appId.value, { userId: member.userId, permission: next });
    member.permission = next;
  } catch (e) {
    memberError.value = e instanceof ApiError ? e.message : "更新权限失败";
    members.value = await listMembers(appId.value);
  } finally {
    busy.value = false;
  }
}

function addPicked(list: File[]) {
  const next = [...pickedFiles.value];
  for (const file of list) {
    const hit = next.find((item) => item.file.name === file.name);
    if (hit) {
      pendingOverwrite.value = file;
      continue;
    }
    next.push({ file, platform: "auto", arch: "auto" });
  }
  pickedFiles.value = next;
}

function confirmOverwrite() {
  const incoming = pendingOverwrite.value;
  if (!incoming) return;
  pickedFiles.value = pickedFiles.value.map((item) =>
    item.file.name === incoming.name ? { ...item, file: incoming } : item,
  );
  pendingOverwrite.value = null;
}

function onPickFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  addPicked(Array.from(input.files ?? []));
  input.value = "";
}

function onDropFiles(event: DragEvent) {
  dragOver.value = false;
  addPicked(Array.from(event.dataTransfer?.files ?? []));
}

function removePicked(name: string) {
  pickedFiles.value = pickedFiles.value.filter((item) => item.file.name !== name);
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    showToast("已复制 Webhook URL");
  } catch {
    error.value = "复制失败，请手动选择地址";
  }
}

function buildUploadForm(includeTag: boolean) {
  const form = new FormData();
  if (includeTag) {
    form.set("tagName", tagName.value.trim());
    form.set("name", releaseName.value.trim());
    form.set("body", changelog.value);
    form.set("isPrerelease", String(isPrerelease.value));
  }
  form.set("overwrite", "true");
  form.set(
    "platforms",
    JSON.stringify(pickedFiles.value.map((item) => (item.platform === "auto" ? "" : item.platform))),
  );
  form.set(
    "arches",
    JSON.stringify(pickedFiles.value.map((item) => (item.arch === "auto" ? "" : item.arch))),
  );
  for (const item of pickedFiles.value) form.append("files", item.file);
  return form;
}

async function onUploadNew() {
  uploadError.value = "";
  if (!tagName.value.trim() || pickedFiles.value.length === 0) {
    uploadError.value = "填写 tag，并至少选择一个文件";
    return;
  }
  busy.value = true;
  try {
    await uploadVersion(appId.value, buildUploadForm(true));
    versions.value = await listVersions(appId.value);
    tagName.value = "";
    releaseName.value = "";
    changelog.value = "";
    isPrerelease.value = false;
    pickedFiles.value = [];
    tab.value = "versions";
  } catch (e) {
    uploadError.value = e instanceof ApiError ? e.message : "上传失败";
  } finally {
    busy.value = false;
  }
}

async function onUploadMore() {
  uploadError.value = "";
  if (!appendVersionId.value || pickedFiles.value.length === 0) {
    uploadError.value = "选择已有版本，并至少选择一个文件";
    return;
  }
  busy.value = true;
  try {
    await uploadAssets(appendVersionId.value, buildUploadForm(false));
    versions.value = await listVersions(appId.value);
    pickedFiles.value = [];
    tab.value = "versions";
  } catch (e) {
    uploadError.value = e instanceof ApiError ? e.message : "补传失败";
  } finally {
    busy.value = false;
  }
}

async function onYank(version: AppVersion) {
  uploadError.value = "";
  busy.value = true;
  try {
    await yankVersion(version.id);
    versions.value = await listVersions(appId.value);
  } catch (e) {
    uploadError.value = e instanceof ApiError ? e.message : "撤回失败";
  } finally {
    busy.value = false;
  }
}

async function onDeleteAsset(assetId: string) {
  uploadError.value = "";
  busy.value = true;
  try {
    await deleteAsset(assetId);
    versions.value = await listVersions(appId.value);
  } catch (e) {
    uploadError.value = e instanceof ApiError ? e.message : "删除失败";
  } finally {
    busy.value = false;
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

function toggleRole(role: string) {
  if (!notify.value) return;
  const has = notify.value.notifyMemberRoles.includes(role);
  notify.value.notifyMemberRoles = has
    ? notify.value.notifyMemberRoles.filter((item) => item !== role)
    : [...notify.value.notifyMemberRoles, role];
}

async function onSaveNotify() {
  if (!notify.value) return;
  busy.value = true;
  error.value = "";
  try {
    const emails = notifyEmailsText.value
      .split(/[\s,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    notify.value = await patchAppNotify(appId.value, { ...notify.value, notifyEmails: emails });
    notifyEmailsText.value = notify.value.notifyEmails.join("\n");
    showToast("通知设置已保存");
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "保存通知失败";
  } finally {
    busy.value = false;
  }
}

async function onTestNotify() {
  busy.value = true;
  error.value = "";
  try {
    const result = await testAppNotify(appId.value);
    showToast(`测试信已发送（${result.recipients} 个收件人）`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "发送测试通知失败";
  } finally {
    busy.value = false;
  }
}

async function onRemove(member: AppMember) {
  memberError.value = "";
  busy.value = true;
  try {
    await removeMember(appId.value, member.userId);
    members.value = members.value.filter((row) => row.userId !== member.userId);
  } catch (e) {
    memberError.value = e instanceof ApiError ? e.message : "移除失败";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <p v-if="loading" class="muted">加载中…</p>
    <div v-else-if="error && !app" class="form-error">{{ error }}</div>
    <template v-else-if="app">
      <div class="breadcrumb">
        <RouterLink to="/admin/apps">应用</RouterLink><span>/</span><span>{{ app.name }}</span>
      </div>
      <div class="page-hd">
        <div style="display: flex; gap: 14px; align-items: center">
          <div class="app-icon" :style="{ background: iconColor(app.name) }">{{ app.name.slice(0, 2) }}</div>
          <div>
            <h1>{{ app.name }}</h1>
            <div class="sub mono">{{ app.slug }} · {{ releaseRef(app) }}</div>
          </div>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap">
          <RouterLink v-if="isAdmin" class="btn btn-sm" :to="{ name: 'admin-app-edit', params: { id: app.id } }">编辑</RouterLink>
          <button
            v-if="canOperate"
            type="button"
            class="btn btn-sm"
            :disabled="busy || !canAutoSync(app)"
            @click="onSync"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.36 6.36M3 12a9 9 0 0 1 15.36-6.36M3 16.5V21h4.5M21 7.5V3H16.5" /></svg>
            手动同步
          </button>
          <button v-if="isAdmin" type="button" class="btn btn-sm" :disabled="busy" @click="onArchive">
            {{ app.status === "archived" ? "取消归档" : "归档" }}
          </button>
          <RouterLink class="btn btn-sm" :to="`/a/${app.slug}`">预览下载页</RouterLink>
        </div>
      </div>
      <div v-if="app.status === 'archived'" class="banner-warn">此应用已归档：同步已停；对外下载站返回归档空状态。</div>

      <div class="tabs">
        <button type="button" class="tab" :class="{ active: tab === 'overview' }" @click="tab = 'overview'">概览</button>
        <button type="button" class="tab" :class="{ active: tab === 'versions' }" @click="tab = 'versions'">版本</button>
        <button v-if="canManage" type="button" class="tab" :class="{ active: tab === 'upload' }" @click="tab = 'upload'">手动上传</button>
        <button v-if="canManage" type="button" class="tab" :class="{ active: tab === 'members' }" @click="tab = 'members'">成员授权</button>
        <button type="button" class="tab" :class="{ active: tab === 'sync' }" @click="tab = 'sync'">同步</button>
        <button v-if="canManage" type="button" class="tab" :class="{ active: tab === 'notify' }" @click="tab = 'notify'">通知</button>
      </div>

      <div v-if="error" class="form-error" style="margin-bottom: 12px">{{ error }}</div>
      <div v-if="uploadError" class="form-error" style="margin-bottom: 12px">{{ uploadError }}</div>

      <div v-if="tab === 'versions'">
        <div v-if="versions.length === 0" class="empty">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" /></svg>
          <h2>还没有版本</h2>
          <p>可在「手动上传」新建，或从同步源拉取。</p>
        </div>
        <div v-else class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Tag</th>
                <th>标记</th>
                <th>发布日期</th>
                <th>资产数</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="version in versions" :key="version.id" :style="{ opacity: version.status === 'yanked' ? 0.55 : 1 }">
                <td class="mono">{{ version.tagName }}</td>
                <td>
                  <span class="platform-badges">
                    <span v-if="version.isLatest" class="pill pill-accent">最新</span>
                    <span v-if="version.isPrerelease" class="pill pill-warn">预发布</span>
                    <span v-if="version.status === 'yanked'" class="pill pill-danger">已撤回</span>
                    <span v-if="version.source === 'manual'" class="pill pill-muted">手动</span>
                  </span>
                </td>
                <td class="mono">{{ version.publishedAt ? version.publishedAt.slice(0, 10) : "—" }}</td>
                <td>{{ version.assets.length }}</td>
                <td>
                  <div style="display: flex; gap: 6px">
                    <RouterLink class="btn btn-sm" :to="`/a/${app.slug}/v/${version.tagName}`">查看</RouterLink>
                    <button
                      v-if="canOperate"
                      type="button"
                      class="btn btn-sm"
                      :disabled="busy || version.status === 'yanked'"
                      @click="onYank(version)"
                    >
                      撤回
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-else-if="tab === 'upload' && canManage">
        <div class="filter-chips" style="margin-bottom: 16px">
          <button type="button" class="chip" :class="{ active: uploadMode === 'new' }" @click="uploadMode = 'new'">新建版本 + 多文件</button>
          <button type="button" class="chip" :class="{ active: uploadMode === 'append' }" @click="uploadMode = 'append'">向已有版本补传</button>
        </div>
        <div v-if="uploadMode === 'new'" class="form-grid" style="margin-bottom: 14px; max-width: 720px">
          <div class="field">
            <label for="tag">版本 Tag</label>
            <input id="tag" v-model="tagName" class="input mono" placeholder="v1.0.0" :disabled="busy" />
          </div>
          <div class="field">
            <label for="rel-name">标题</label>
            <input id="rel-name" v-model="releaseName" class="input" placeholder="可选，默认=Tag" :disabled="busy" />
          </div>
          <div class="field span-2">
            <label for="log">更新说明</label>
            <textarea id="log" v-model="changelog" class="textarea" rows="3" placeholder="Markdown 发布说明" :disabled="busy" />
          </div>
          <div class="span-2 switch-row">
            <div>
              <div style="font-weight: 500">标记为预发布</div>
              <div class="hint">isPrerelease · 下载站默认隐藏</div>
            </div>
            <label class="switch">
              <input v-model="isPrerelease" type="checkbox" :disabled="busy" />
              <span></span>
            </label>
          </div>
        </div>
        <div v-else class="field" style="max-width: 320px; margin-bottom: 14px">
          <label for="append-ver">目标版本</label>
          <select id="append-ver" v-model="appendVersionId" class="select" :disabled="busy">
            <option value="">选择版本</option>
            <option v-for="version in versions" :key="version.id" :value="version.id">
              {{ version.tagName }}{{ version.status === "yanked" ? "（已撤回）" : "" }}
            </option>
          </select>
        </div>
        <div
          class="dropzone"
          :class="{ drag: dragOver }"
          @click="pickInput?.click()"
          @dragover.prevent="dragOver = true"
          @dragleave.prevent="dragOver = false"
          @drop.prevent="onDropFiles"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21V9m0 0l4 4m-4-4l-4 4M5 3h14" /></svg>
          <div class="dz-title" style="margin-top: 10px">拖拽安装包到此处，或点击选择</div>
          <div class="muted t-13">支持多文件 · 可指定 platform/arch · 同名将二次确认覆盖</div>
        </div>
        <input ref="pickInput" type="file" multiple hidden :disabled="busy" @change="onPickFiles" />
        <div v-if="pickedFiles.length" class="file-list">
          <div v-for="item in pickedFiles" :key="item.file.name" class="file-row" style="flex-wrap: wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" /></svg>
            <span class="name" :title="item.file.name">{{ item.file.name }}</span>
            <span class="mono muted t-12">{{ formatSize(item.file.size) }}</span>
            <select v-model="item.platform" class="select" style="width: 120px" :disabled="busy">
              <option value="auto">平台·推断</option>
              <option v-for="platform in platformOptions" :key="platform" :value="platform">{{ platform }}</option>
            </select>
            <select v-model="item.arch" class="select" style="width: 110px" :disabled="busy">
              <option value="auto">架构·推断</option>
              <option v-for="arch in archOptions" :key="arch" :value="arch">{{ arch }}</option>
            </select>
            <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="removePicked(item.file.name)">移除</button>
          </div>
        </div>
        <button
          v-if="pickedFiles.length"
          type="button"
          class="btn btn-primary"
          style="margin-top: 12px"
          :disabled="busy"
          @click="uploadMode === 'new' ? onUploadNew() : onUploadMore()"
        >
          {{ busy ? "上传中…" : "提交上传" }}
        </button>
        <div v-if="pendingOverwrite" class="modal-backdrop" @click.self="pendingOverwrite = null">
          <div class="modal">
            <div class="modal-hd">确认覆盖同名文件？</div>
            <div class="modal-bd">
              文件 <span class="mono">{{ pendingOverwrite.name }}</span> 已在列表中。继续将替换本地待上传文件，此操作不可撤销。
            </div>
            <div class="modal-ft">
              <button type="button" class="btn" @click="pendingOverwrite = null">取消</button>
              <button type="button" class="btn btn-danger" @click="confirmOverwrite">覆盖 Overwrite</button>
            </div>
          </div>
        </div>
      </div>

      <form v-else-if="tab === 'notify' && notify && canManage" class="form-grid card card-pad" style="max-width: 640px" @submit.prevent="onSaveNotify">
        <div class="switch-row span-2">
          <div>
            <div>启用通知</div>
            <div class="hint muted t-12">关闭后三个事件都不会发信。</div>
          </div>
          <label class="switch">
            <input v-model="notify.notifyEnabled" type="checkbox" :disabled="busy" />
            <span></span>
          </label>
        </div>
        <label class="field" style="flex-direction: row; align-items: center; gap: 8px">
          <input v-model="notify.notifyOnSyncSuccess" type="checkbox" :disabled="busy" />
          同步成功
        </label>
        <label class="field" style="flex-direction: row; align-items: center; gap: 8px">
          <input v-model="notify.notifyOnSyncFailure" type="checkbox" :disabled="busy" />
          同步失败
        </label>
        <label class="field" style="flex-direction: row; align-items: center; gap: 8px">
          <input v-model="notify.notifyOnUploadSuccess" type="checkbox" :disabled="busy" />
          手动上传成功
        </label>
        <label class="field" style="flex-direction: row; align-items: center; gap: 8px">
          <input v-model="notify.notifyUseGlobalFallback" type="checkbox" :disabled="busy" />
          自定义邮箱为空时回落全局
        </label>
        <div class="field span-2">
          <label for="notify-emails">自定义邮箱</label>
          <textarea id="notify-emails" v-model="notifyEmailsText" class="textarea" placeholder="每行一个" :disabled="busy" />
        </div>
        <div class="field span-2 stack">
          <div class="muted t-12">同时通知这些角色的成员</div>
          <label v-for="role in memberRoles" :key="role" style="display: flex; gap: 8px; align-items: center">
            <input
              type="checkbox"
              :checked="notify.notifyMemberRoles.includes(role)"
              :disabled="busy"
              @change="toggleRole(role)"
            />
            {{ permissionLabel[role] }}
          </label>
        </div>
        <div class="form-actions span-2">
          <button class="btn btn-primary" type="submit" :disabled="busy">保存</button>
          <button class="btn" type="button" :disabled="busy" @click="onTestNotify">发送测试</button>
        </div>
      </form>

      <div v-else-if="tab === 'sync'" class="stack">
        <div v-if="!canAutoSync(app)" class="banner-warn">
          {{ app.providerStatus === "not_implemented" ? "该 Provider 一期未实现，可保存配置，不可自动同步。" : "未绑定已实现的同步源，仅手动上传。" }}
          可在「编辑」中修改。
        </div>
        <div class="card card-pad">
          <div class="panel-title">Webhook（近实时）</div>
          <div class="switch-row" style="margin-bottom: 14px">
            <div>
              <div style="font-weight: 500">接受 Webhook</div>
              <div class="hint">{{ label(providerLabel, app.releaseProvider) }} Release 事件推送到本站</div>
            </div>
            <span class="pill" :class="app.syncWebhookEnabled ? 'pill-success' : 'pill-muted'">
              {{ app.syncWebhookEnabled ? "已启用" : "未启用" }}
            </span>
          </div>
          <ol class="hint" style="padding-left: 18px; line-height: 1.7; margin-bottom: 14px">
            <li>在仓库 Settings → Webhooks 新建 Hook</li>
            <li>Payload URL 填入下方地址，Content type 选 application/json</li>
            <li>事件勾选 Releases</li>
            <li>Secret 与环境变量中的 Webhook Secret 保持一致</li>
          </ol>
          <div v-if="app.webhookUrl" class="webhook-box">{{ app.webhookUrl }}</div>
          <p v-else class="muted">当前 Provider 没有 Webhook 地址。</p>
          <button v-if="app.webhookUrl" type="button" class="btn btn-sm" style="margin-top: 12px" @click="copyText(app.webhookUrl)">复制 URL</button>
        </div>
        <div class="card card-pad">
          <div class="panel-title">定时轮询（兜底）</div>
          <div class="switch-row">
            <div>
              <div style="font-weight: 500">参与定时轮询</div>
              <div class="hint">{{ app.syncPollEnabled ? `间隔 ${app.syncPollIntervalSec || "默认"} 秒` : "无公网时依赖轮询" }}</div>
            </div>
            <span class="pill" :class="app.syncPollEnabled ? 'pill-success' : 'pill-muted'">
              {{ app.syncPollEnabled ? "已启用" : "未启用" }}
            </span>
          </div>
          <p class="hint" style="margin-top: 12px">开关在编辑页修改。签名密钥不在页面回显。</p>
        </div>
      </div>

      <template v-else-if="tab === 'overview'">
      <div class="stack" style="margin-bottom: 16px">
        <div class="card card-pad">
          <div class="panel-title" style="display: flex; justify-content: space-between; align-items: center">
            <span>同步方式</span>
            <span class="pill" :class="syncModeTone(syncModeText(app))">{{ syncModeText(app) }}</span>
          </div>
          <div class="sync-modes">
            <div class="sync-mode">
              <div class="sync-mode-title">Webhook</div>
              <div class="muted t-12">近实时 · {{ label(providerLabel, app.releaseProvider) }} Release 推送</div>
              <span class="pill" :class="app.syncWebhookEnabled && canAutoSync(app) ? 'pill-success' : 'pill-muted'">{{ app.syncWebhookEnabled && canAutoSync(app) ? "已启用" : "未启用" }}</span>
            </div>
            <div class="sync-mode">
              <div class="sync-mode-title">定时轮询</div>
              <div class="muted t-12">兜底 · 尤其无公网时</div>
              <span class="pill" :class="app.syncPollEnabled && canAutoSync(app) ? 'pill-success' : 'pill-muted'">{{ app.syncPollEnabled && canAutoSync(app) ? "已启用" : "未启用" }}</span>
            </div>
            <div class="sync-mode">
              <div class="sync-mode-title">手动同步</div>
              <div class="muted t-12">随时可点顶部「手动同步」</div>
              <span class="pill pill-accent">始终可用</span>
            </div>
          </div>
          <p v-if="syncModeText(app) === '手动'" class="hint" style="margin-top: 12px">
            当前未启用 Webhook / 轮询{{ canAutoSync(app) ? "" : "，且未绑定已实现的同步源" }}，版本更新依赖手动上传或手动同步。
          </p>
        </div>
        <div class="split even">
          <div class="card card-pad">
            <div class="panel-title">状态</div>
            <div class="kv">
              <div><span class="muted">状态</span><span class="pill" :class="app.status === 'archived' ? 'pill-warn' : 'pill-success'">{{ label(statusLabel, app.status) }}</span></div>
              <div><span class="muted">可见性</span><span class="pill" :class="visibilityTone[app.visibility] || 'pill-muted'">{{ label(visibilityLabel, app.visibility) }}</span></div>
              <div><span class="muted">同步源</span><span class="mono t-12">{{ releaseRef(app) }}</span></div>
              <div><span class="muted">同步状态</span><span class="pill" :class="syncStatusText(app) === '同步正常' ? 'pill-success' : 'pill-muted'">{{ syncStatusText(app) }}</span></div>
              <div><span class="muted">同步模式</span><span class="pill" :class="syncModeTone(syncModeText(app))">{{ syncModeText(app) }}</span></div>
              <div><span class="muted">最新版本</span><span class="mono">{{ latestVersion?.tagName || "—" }}</span></div>
              <div><span class="muted">最近同步</span><span class="mono">{{ latestVersion?.publishedAt ? latestVersion.publishedAt.slice(0, 16).replace("T", " ") : "—" }}</span></div>
              <div><span class="muted">Include</span><span class="mono t-12">{{ app.assetIncludeGlob || "—" }}</span></div>
            </div>
          </div>
          <div class="card card-pad">
            <div class="panel-title">简介</div>
            <p class="muted">{{ app.description || "暂无简介" }}</p>
          </div>
        </div>
        <div v-if="app.visibility === 'password'" class="card card-pad">
          <div class="panel-title" style="display: flex; justify-content: space-between; align-items: center">
            <span>绑定的访问口令</span>
            <RouterLink class="btn btn-sm" to="/admin/access-codes">去口令中心</RouterLink>
          </div>
          <p v-if="!app.boundAccessCodes?.length" class="hint">尚未绑定任何访问口令。设为「口令」可见后须在口令中心签发并绑定。</p>
          <div v-else class="stack">
            <div v-for="code in app.boundAccessCodes" :key="code.id" class="code-row">
              <span class="mono">{{ code.prefix }}…</span>
              <span class="pill" :class="code.status === 'active' ? 'pill-success' : 'pill-muted'">{{ code.status === "active" ? "启用" : "停用" }}</span>
              <span class="muted" style="flex: 1">{{ code.note || "无备注" }}</span>
            </div>
          </div>
        </div>
      </div>
      </template>

      <template v-else-if="tab === 'members'">
      <div v-if="memberError" class="form-error" style="margin-bottom: 8px">{{ memberError }}</div>
      <form v-if="canManage" class="card card-pad" style="margin-bottom: 16px" @submit.prevent="onUpsert">
        <div class="panel-title">添加成员</div>
        <div style="display: flex; gap: 10px; flex-wrap: wrap">
          <select v-if="isAdmin" v-model="userId" class="select" style="width: 220px" :disabled="busy">
            <option value="">选择用户…</option>
            <option v-for="user in users" :key="user.id" :value="user.id">{{ user.username }} · {{ user.email }}</option>
          </select>
          <input v-else v-model="userId" class="input mono" style="width: 220px" placeholder="用户 ID" :disabled="busy" />
          <select v-model="permission" class="select" style="width: 180px" :disabled="busy">
            <option value="viewer">viewer 查看者</option>
            <option value="operator">operator 操作员</option>
            <option value="manager">manager 管理员</option>
          </select>
          <button class="btn btn-primary" type="submit" :disabled="busy">添加</button>
        </div>
      </form>
      <div v-if="members.length === 0" class="empty">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /></svg>
        <h2>还没有成员</h2>
        <p>添加用户后，才能按 viewer、operator、manager 授权。</p>
      </div>
      <div v-else style="margin-bottom: 16px">
        <div v-for="member in members" :key="member.userId" class="member-row">
          <span class="avatar">{{ member.username.slice(0, 1).toUpperCase() }}</span>
          <div style="flex: 1; min-width: 0">
            <div style="font-weight: 600">{{ member.username }}</div>
            <div class="muted t-12">{{ member.email }}</div>
          </div>
          <select
            v-if="canManage"
            class="select"
            style="width: 160px"
            :value="member.permission"
            :disabled="busy"
            @change="onChangePermission(member, ($event.target as HTMLSelectElement).value)"
          >
            <option value="viewer">viewer 查看者</option>
            <option value="operator">operator 操作员</option>
            <option value="manager">manager 管理员</option>
          </select>
          <span v-else class="pill pill-accent">{{ permissionLabel[member.permission] || member.permission }}</span>
          <button v-if="canManage" type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="onRemove(member)">
            移除
          </button>
        </div>
      </div>
      </template>
    </template>

    <div v-if="toast" class="toast" :class="toastTone === 'warn' ? 'warn' : 'ok'">
      <svg v-if="toastTone === 'warn'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" /></svg>
      <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      {{ toast }}
    </div>
  </div>
</template>
