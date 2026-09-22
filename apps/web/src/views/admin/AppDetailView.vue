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
const tab = ref<"overview" | "versions" | "upload" | "notify">("overview");
const users = ref<AdminUser[]>([]);
const error = ref("");
const memberError = ref("");
const warning = ref("");
const loading = ref(true);
const busy = ref(false);

const userId = ref("");
const permission = ref("viewer");
const tagName = ref("");
const releaseName = ref("");
const changelog = ref("");
const isPrerelease = ref(false);
const overwrite = ref(false);
const appendVersionId = ref("");
const pickedFiles = ref<File[]>([]);
const uploadError = ref("");
const syncMessage = ref("");
const notify = ref<AppNotify | null>(null);
const notifyEmailsText = ref("");
const notifyMessage = ref("");
const memberRoles = ["viewer", "operator", "manager"] as const;

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
  active: "启用",
  archived: "已归档",
};
const providerStatusLabel: Record<string, string> = {
  manual: "手动，无远程同步",
  implemented: "同步已实现",
  not_implemented: "该 Provider 同步为二期",
};

function label(map: Record<string, string>, value: string) {
  return map[value] ?? value;
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

onMounted(() => {
  if (route.query.warning === "PROVIDER_NOT_IMPLEMENTED") {
    warning.value = "已保存，同步开关已关闭（该 Provider 二期）";
  }
  void load();
});

async function onSync() {
  if (!app.value) return;
  busy.value = true;
  error.value = "";
  syncMessage.value = "";
  try {
    const result = await syncApp(app.value.id);
    syncMessage.value = `已入队 ${result.jobId}`;
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

function onPickFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  pickedFiles.value = Array.from(input.files ?? []);
}

function buildUploadForm(includeTag: boolean) {
  const form = new FormData();
  if (includeTag) {
    form.set("tagName", tagName.value.trim());
    form.set("name", releaseName.value.trim());
    form.set("body", changelog.value);
    form.set("isPrerelease", String(isPrerelease.value));
  }
  form.set("overwrite", String(overwrite.value));
  for (const file of pickedFiles.value) form.append("files", file);
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
    overwrite.value = false;
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
    overwrite.value = false;
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
  notifyMessage.value = "";
  error.value = "";
  try {
    const emails = notifyEmailsText.value
      .split(/[\s,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    notify.value = await patchAppNotify(appId.value, { ...notify.value, notifyEmails: emails });
    notifyEmailsText.value = notify.value.notifyEmails.join("\n");
    notifyMessage.value = "通知设置已保存";
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "保存通知失败";
  } finally {
    busy.value = false;
  }
}

async function onTestNotify() {
  busy.value = true;
  notifyMessage.value = "";
  error.value = "";
  try {
    const result = await testAppNotify(appId.value);
    notifyMessage.value = `测试信已发送（${result.recipients} 个收件人）`;
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
      <div class="page-hd" style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
        <div>
          <h1>{{ app.name }}</h1>
          <div class="sub">
            <span class="mono">{{ app.slug }}</span>
            · {{ label(visibilityLabel, app.visibility) }}
            · {{ label(providerLabel, app.releaseProvider) }}
            · {{ label(statusLabel, app.status) }}
          </div>
        </div>
        <div style="display: flex; gap: 8px">
          <button
            v-if="canOperate && app.releaseProvider === 'github'"
            type="button"
            class="btn btn-primary"
            :disabled="busy"
            @click="onSync"
          >
            立即同步
          </button>
          <span v-else-if="app.releaseProvider === 'gitee' || app.releaseProvider === 'gitlab'" class="muted t-13">
            同步为二期
          </span>
          <RouterLink
            v-if="isAdmin"
            class="btn"
            :to="{ name: 'admin-app-edit', params: { id: app.id } }"
          >
            编辑
          </RouterLink>
          <button
            v-if="isAdmin"
            type="button"
            class="btn"
            :disabled="busy"
            @click="onArchive"
          >
            {{ app.status === "archived" ? "取消归档" : "归档" }}
          </button>
        </div>
      </div>

      <div class="tabs">
        <button type="button" class="tab" :class="{ active: tab === 'overview' }" @click="tab = 'overview'">概览</button>
        <button type="button" class="tab" :class="{ active: tab === 'versions' }" @click="tab = 'versions'">版本</button>
        <button v-if="canManage" type="button" class="tab" :class="{ active: tab === 'upload' }" @click="tab = 'upload'">手动上传</button>
        <button v-if="canManage" type="button" class="tab" :class="{ active: tab === 'notify' }" @click="tab = 'notify'">通知</button>
      </div>

      <div v-if="syncMessage" class="banner-warn">{{ syncMessage }}</div>
      <div v-if="notifyMessage" class="banner-warn">{{ notifyMessage }}</div>
      <div v-if="warning" class="banner-warn">{{ warning }}</div>
      <div v-if="error" class="form-error" style="margin-bottom: 12px">{{ error }}</div>
      <div v-if="uploadError" class="form-error" style="margin-bottom: 12px">{{ uploadError }}</div>

      <div v-if="tab === 'versions'" class="stack">
        <p v-if="versions.length === 0" class="muted">还没有版本。可在「手动上传」新建。</p>
        <div v-for="version in versions" :key="version.id" class="card" style="padding: 16px 20px; margin-bottom: 12px">
          <div style="display: flex; justify-content: space-between; gap: 12px; align-items: center">
            <div>
              <strong class="mono">{{ version.tagName }}</strong>
              <span v-if="version.isLatest" class="pill pill-accent" style="margin-left: 8px">最新</span>
              <span v-if="version.isPrerelease" class="pill pill-warn" style="margin-left: 8px">预发布</span>
              <span v-if="version.status === 'yanked'" class="pill pill-danger" style="margin-left: 8px">已撤回</span>
            </div>
            <button
              v-if="canOperate && version.status !== 'yanked'"
              type="button"
              class="btn btn-sm"
              :disabled="busy"
              @click="onYank(version)"
            >
              撤回
            </button>
          </div>
          <p v-if="version.body" class="muted t-13" style="margin-top: 8px; white-space: pre-wrap">{{ version.body }}</p>
          <div v-if="version.assets.length" class="table-wrap" style="margin-top: 12px">
            <table class="data-table">
              <thead>
                <tr>
                  <th>文件</th>
                  <th>平台</th>
                  <th>大小</th>
                  <th>SHA256</th>
                  <th v-if="canManage"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="asset in version.assets" :key="asset.id">
                  <td class="mono">{{ asset.name }}</td>
                  <td class="mono">{{ asset.platform }} / {{ asset.arch }}</td>
                  <td>{{ formatSize(asset.size) }}</td>
                  <td class="mono t-12">{{ asset.checksumSha256.slice(0, 12) }}…</td>
                  <td v-if="canManage">
                    <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="onDeleteAsset(asset.id)">删除</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <form v-else-if="tab === 'upload' && canManage" class="form-grid" style="max-width: 720px" @submit.prevent="onUploadNew">
        <div class="field">
          <label for="tag">Tag</label>
          <input id="tag" v-model="tagName" class="input mono" placeholder="v1.2.0" :disabled="busy" />
        </div>
        <div class="field">
          <label for="rel-name">标题</label>
          <input id="rel-name" v-model="releaseName" class="input" :disabled="busy" />
        </div>
        <div class="field span-2">
          <label for="log">更新说明</label>
          <textarea id="log" v-model="changelog" class="textarea" :disabled="busy" />
        </div>
        <label class="field" style="flex-direction: row; align-items: center; gap: 8px">
          <input v-model="isPrerelease" type="checkbox" :disabled="busy" />
          预发布
        </label>
        <label class="field" style="flex-direction: row; align-items: center; gap: 8px">
          <input v-model="overwrite" type="checkbox" :disabled="busy" />
          同名覆盖
        </label>
        <div class="field span-2">
          <label for="files">安装包</label>
          <input id="files" class="input" type="file" multiple :disabled="busy" @change="onPickFiles" />
          <span class="hint">{{ pickedFiles.length ? pickedFiles.map((file) => file.name).join("、") : "可多选。平台按文件名推断。" }}</span>
        </div>
        <div class="form-actions span-2">
          <button class="btn btn-primary" type="submit" :disabled="busy">新建版本并上传</button>
          <button class="btn" type="button" :disabled="busy || !appendVersionId" @click="onUploadMore">补传到已有版本</button>
          <select v-model="appendVersionId" class="select" :disabled="busy">
            <option value="">选择版本</option>
            <option v-for="version in versions" :key="version.id" :value="version.id">{{ version.tagName }}</option>
          </select>
        </div>
      </form>

      <form v-else-if="tab === 'notify' && notify && canManage" class="form-grid card card-pad" style="max-width: 720px" @submit.prevent="onSaveNotify">
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
        <div class="field span-2">
          <div class="muted t-12">同时通知这些角色的成员</div>
          <div style="display: flex; gap: 12px; margin-top: 8px">
            <label v-for="role in memberRoles" :key="role" style="display: flex; gap: 6px; align-items: center">
              <input
                type="checkbox"
                :checked="notify.notifyMemberRoles.includes(role)"
                :disabled="busy"
                @change="toggleRole(role)"
              />
              {{ role }}
            </label>
          </div>
        </div>
        <div class="form-actions span-2">
          <button class="btn btn-primary" type="submit" :disabled="busy">保存</button>
          <button class="btn" type="button" :disabled="busy" @click="onTestNotify">发送测试</button>
        </div>
      </form>

      <template v-if="tab === 'overview'">
      <div class="card" style="padding: 16px 20px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); max-width: 720px; margin-bottom: 24px">
        <div class="muted t-12">同步状态</div>
        <div>{{ label(providerStatusLabel, app.providerStatus) }}</div>
        <template v-if="app.webhookUrl">
          <div class="muted t-12" style="margin-top: 12px">Webhook</div>
          <div class="mono" style="word-break: break-all">{{ app.webhookUrl }}</div>
        </template>
        <div v-if="app.description" style="margin-top: 12px">{{ app.description }}</div>
        <template v-if="app.visibility === 'password'">
          <div class="muted t-12" style="margin-top: 12px">绑定的访问口令</div>
          <p v-if="!app.boundAccessCodes?.length" class="muted t-13">
            尚未绑定。请到
            <RouterLink to="/admin/access-codes">访问口令</RouterLink>
            签发。
          </p>
          <p v-for="code in app.boundAccessCodes" :key="code.id" class="t-13 mono">
            {{ code.prefix }} · {{ code.note || "无备注" }} · {{ code.status }}
          </p>
        </template>
        <div class="muted t-13" style="margin-top: 8px">
          我的权限 <span class="mono">{{ app.myPermission }}</span>
        </div>
      </div>

      <h2 class="t-16" style="font-weight: 650; margin-bottom: 10px">成员</h2>
      <div v-if="memberError" class="form-error" style="margin-bottom: 8px">{{ memberError }}</div>
      <p v-if="members.length === 0" class="muted">还没有成员。</p>
      <div v-else class="table-wrap" style="margin-bottom: 16px">
        <table class="data-table">
          <thead>
            <tr>
              <th>用户名</th>
              <th>邮箱</th>
              <th>权限</th>
              <th v-if="canManage"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="member in members" :key="member.userId">
              <td>{{ member.username }}</td>
              <td>{{ member.email }}</td>
              <td>
                <select
                  v-if="canManage"
                  class="select"
                  :value="member.permission"
                  :disabled="busy"
                  @change="onChangePermission(member, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="viewer">viewer</option>
                  <option value="operator">operator</option>
                  <option value="manager">manager</option>
                </select>
                <span v-else class="mono">{{ member.permission }}</span>
              </td>
              <td v-if="canManage">
                <button type="button" class="btn btn-ghost" :disabled="busy" @click="onRemove(member)">
                  移除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <form v-if="canManage" class="form-grid card card-pad" style="margin-top: 16px" @submit.prevent="onUpsert">
        <div class="field" v-if="isAdmin">
          <label for="member-user">用户</label>
          <select id="member-user" v-model="userId" class="select" :disabled="busy">
            <option value="">选择用户</option>
            <option v-for="user in users" :key="user.id" :value="user.id">
              {{ user.username }} · {{ user.email }}
            </option>
          </select>
        </div>
        <div class="field" v-else>
          <label for="member-id">用户 ID</label>
          <input id="member-id" v-model="userId" class="input mono" :disabled="busy" />
        </div>
        <div class="field">
          <label for="member-perm">权限</label>
          <select id="member-perm" v-model="permission" class="select" :disabled="busy">
            <option value="viewer">viewer</option>
            <option value="operator">operator</option>
            <option value="manager">manager</option>
          </select>
        </div>
        <div class="form-actions span-2">
          <button class="btn btn-primary" type="submit" :disabled="busy">添加</button>
        </div>
      </form>
      </template>
    </template>
  </div>
</template>
