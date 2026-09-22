<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { createApp, getApp, updateApp, type AppFormBody } from "@/api/apps";
import { ApiError } from "@/api/http";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const route = useRoute();
const router = useRouter();

const isEdit = computed(() => route.name === "admin-app-edit");
const appId = computed(() => String(route.params.id ?? ""));

const form = reactive({
  name: "",
  slug: "",
  description: "",
  visibility: "public",
  releaseProvider: "none",
  releaseOwner: "",
  releaseRepo: "",
  releaseBaseUrl: "",
  syncWebhookEnabled: false,
  syncPollEnabled: false,
  assetIncludeGlob: "",
  sortOrder: 0,
  platformRules: "",
});

const error = ref("");
const saved = ref(false);
const warning = ref("");
const loading = ref(false);
const ready = ref(false);

const syncDisabled = computed(() => form.releaseProvider === "none");

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseRules(raw: string): unknown[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("平台规则须为 JSON 数组");
  }
  return parsed;
}

function buildBody(): AppFormBody {
  const syncOff = form.releaseProvider === "none";
  const body: AppFormBody = {
    name: form.name.trim(),
    description: emptyToNull(form.description),
    visibility: form.visibility,
    releaseProvider: form.releaseProvider,
    releaseOwner: emptyToNull(form.releaseOwner),
    releaseRepo: emptyToNull(form.releaseRepo),
    releaseBaseUrl: emptyToNull(form.releaseBaseUrl),
    syncWebhookEnabled: syncOff ? false : form.syncWebhookEnabled,
    syncPollEnabled: syncOff ? false : form.syncPollEnabled,
    assetIncludeGlob: emptyToNull(form.assetIncludeGlob),
    sortOrder: Number.isFinite(form.sortOrder) ? form.sortOrder : 0,
    platformRules: parseRules(form.platformRules),
  };
  if (!isEdit.value) {
    body.slug = form.slug.trim();
  }
  return body;
}

onMounted(async () => {
  if (!isEdit.value) {
    ready.value = true;
    return;
  }
  try {
    const app = await getApp(appId.value);
    form.name = app.name;
    form.slug = app.slug;
    form.description = app.description ?? "";
    form.visibility = app.visibility;
    form.releaseProvider = app.releaseProvider;
    form.releaseOwner = app.releaseOwner ?? "";
    form.releaseRepo = app.releaseRepo ?? "";
    form.releaseBaseUrl = app.releaseBaseUrl ?? "";
    form.syncWebhookEnabled = app.syncWebhookEnabled;
    form.syncPollEnabled = app.syncPollEnabled;
    form.assetIncludeGlob = app.assetIncludeGlob ?? "";
    form.sortOrder = app.sortOrder;
    form.platformRules =
      app.platformRules == null ? "" : JSON.stringify(app.platformRules, null, 2);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载应用失败";
  } finally {
    ready.value = true;
  }
});

function applyWarning(code?: string) {
  if (code === "PROVIDER_NOT_IMPLEMENTED") {
    warning.value = "已保存，同步开关已关闭（该 Provider 二期）";
    form.syncWebhookEnabled = false;
    form.syncPollEnabled = false;
  }
}

async function onSubmit() {
  error.value = "";
  saved.value = false;
  warning.value = "";

  if (!form.name.trim()) {
    error.value = "请填写名称";
    return;
  }
  const slug = form.slug.trim();
  if (!isEdit.value) {
    if (slug.length < 2 || slug.length > 64 || !SLUG_RE.test(slug)) {
      error.value = "slug 须为 2–64 位小写字母、数字与连字符，且不能以连字符开头或结尾";
      return;
    }
  }
  try {
    parseRules(form.platformRules);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "平台规则 JSON 无法解析";
    return;
  }

  loading.value = true;
  try {
    const body = buildBody();
    if (isEdit.value) {
      const updated = await updateApp(appId.value, body);
      applyWarning(updated.warning);
      saved.value = true;
    } else {
      const created = await createApp(body);
      if (created.warning === "PROVIDER_NOT_IMPLEMENTED") {
        await router.replace({
          name: "admin-app-detail",
          params: { id: created.id },
          query: { warning: "PROVIDER_NOT_IMPLEMENTED" },
        });
        return;
      }
      await router.replace({ name: "admin-app-detail", params: { id: created.id } });
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "保存失败";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h1>{{ isEdit ? "编辑应用" : "新建应用" }}</h1>
        <div class="sub">选择 Release 同步源；一期仅 GitHub 可自动同步，Gitee/GitLab 为二期占位</div>
      </div>
    </div>

    <p v-if="!ready" class="muted">加载中…</p>
    <form v-else class="card card-pad" style="max-width: 720px" @submit.prevent="onSubmit">
      <div class="form-grid">
      <div v-if="warning" class="banner-warn span-2">{{ warning }}</div>
      <div v-if="saved && !warning" class="muted span-2">已保存</div>

      <div class="field">
        <label for="name">名称</label>
        <input id="name" v-model="form.name" class="input" maxlength="80" required :disabled="loading" />
      </div>
      <div class="field">
        <label for="slug">Slug</label>
        <input
          id="slug"
          v-model="form.slug"
          class="input mono"
          maxlength="64"
          :disabled="isEdit || loading"
          required
        />
        <span class="hint">{{ isEdit ? "创建后不可改 slug" : "小写字母、数字与连字符，例如 moonnotes" }}</span>
      </div>
      <div class="field span-2">
        <label for="description">简介</label>
        <textarea id="description" v-model="form.description" class="textarea" rows="3" :disabled="loading" />
      </div>
      <div class="field span-2">
        <label for="provider">同步源（Release Provider）</label>
        <select id="provider" v-model="form.releaseProvider" class="select" :disabled="loading">
          <option value="none">不绑定（仅手动上传）</option>
          <option value="github">GitHub Release</option>
          <option value="gitee">Gitee Release（二期）</option>
          <option value="gitlab">GitLab Release（二期）</option>
        </select>
        <span
          v-if="form.releaseProvider === 'gitee' || form.releaseProvider === 'gitlab'"
          class="hint"
          style="color: var(--warn)"
        >
          该 Provider 一期未实现：可先保存配置，但不可开启 Webhook / 轮询。
        </span>
      </div>
      <template v-if="form.releaseProvider !== 'none'">
        <div class="field">
          <label for="owner">Owner / Namespace</label>
          <input id="owner" v-model="form.releaseOwner" class="input mono" placeholder="用户 / 组织" :disabled="loading" />
        </div>
        <div class="field">
          <label for="repo">Repo</label>
          <input id="repo" v-model="form.releaseRepo" class="input mono" placeholder="仓库名" :disabled="loading" />
        </div>
        <div v-if="form.releaseProvider === 'gitlab'" class="field span-2">
          <label for="base">实例 Base URL（自建 GitLab）</label>
          <input id="base" v-model="form.releaseBaseUrl" class="input mono" placeholder="https://gitlab.example.com · 官方可留空" :disabled="loading" />
        </div>
      </template>
      <div class="field">
        <label for="visibility">可见性</label>
        <select id="visibility" v-model="form.visibility" class="select" :disabled="loading">
          <option value="public">公开 Public</option>
          <option value="password">口令 Password</option>
          <option value="login">登录 Login</option>
        </select>
        <span v-if="form.visibility === 'password'" class="hint">
          口令不在此表单设置。设为「口令」后须在访问口令中心签发并绑定（M5）。
        </span>
        <span v-if="form.visibility === 'login'" class="hint" style="color: var(--warn)">
          login = 任意已登录账号可下，≠ 仅应用成员（成员门禁二期）。
        </span>
      </div>
      <div class="span-2" style="display: flex; flex-direction: column; gap: 10px">
        <div class="switch-row" :style="{ opacity: syncDisabled ? 0.45 : 1 }">
          <div>
            <div style="font-weight: 500">接受 Webhook</div>
            <div class="hint">{{ syncDisabled ? "请先选择已实现的同步源" : "近实时推送" }}</div>
          </div>
          <label class="switch">
            <input v-model="form.syncWebhookEnabled" type="checkbox" :disabled="syncDisabled || loading" />
            <span />
          </label>
        </div>
        <div class="switch-row" :style="{ opacity: syncDisabled ? 0.45 : 1 }">
          <div>
            <div style="font-weight: 500">参与定时轮询</div>
            <div class="hint">无公网时的兜底</div>
          </div>
          <label class="switch">
            <input v-model="form.syncPollEnabled" type="checkbox" :disabled="syncDisabled || loading" />
            <span />
          </label>
        </div>
      </div>
      <div class="field">
        <label for="glob">Include Glob</label>
        <input id="glob" v-model="form.assetIncludeGlob" class="input mono" placeholder="*.exe,*.apk" :disabled="loading" />
      </div>
      <div class="field">
        <label for="sort">排序</label>
        <input id="sort" v-model.number="form.sortOrder" class="input mono" type="number" :disabled="loading" />
      </div>
      <div class="field span-2">
        <label for="rules">平台规则（JSON）</label>
        <textarea
          id="rules"
          v-model="form.platformRules"
          class="textarea mono"
          rows="4"
          spellcheck="false"
          placeholder='[{ "pattern": "setup", "platform": "windows", "arch": "x64" }]'
          :disabled="loading"
        />
        <span class="hint">按文件名子串或简单 glob（*）匹配，命中第一条即用。留空则按默认规则推断。手动上传时显式平台优先。</span>
      </div>

      <div v-if="error" class="form-error span-2">{{ error }}</div>
      <div class="form-actions span-2" style="justify-content: flex-end; margin-top: 4px">
        <RouterLink class="btn" to="/admin/apps">取消</RouterLink>
        <button class="btn btn-primary" type="submit" :disabled="loading || !ready">
          {{ loading ? "保存中…" : "保存" }}
        </button>
      </div>
      </div>
    </form>
  </div>
</template>
