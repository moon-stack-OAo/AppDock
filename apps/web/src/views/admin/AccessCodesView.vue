<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { listApps, type AppView } from "@/api/apps";
import {
  createAccessCode,
  disableAccessCode,
  listAccessCodes,
  revealAccessCode,
  rotateAccessCode,
  updateAccessCode,
  type AccessCodeItem,
} from "@/api/access-codes";
import { ApiError } from "@/api/http";

const items = ref<AccessCodeItem[]>([]);
const passwordApps = ref<AppView[]>([]);
const error = ref("");
const loading = ref(true);
const showCreate = ref(false);
const busy = ref(false);
const plainOnce = ref("");
const editing = ref<string | null>(null);

const form = reactive({
  note: "",
  expiresAt: "",
  maxUses: "",
  appIds: [] as string[],
  customCode: "",
});
const editForm = reactive({
  note: "",
  expiresAt: "",
  maxUses: "",
  appIds: [] as string[],
});

const statusLabel: Record<string, string> = {
  active: "有效",
  disabled: "已停用",
  expired: "已过期",
};

const empty = computed(() => !loading.value && items.value.length === 0 && passwordApps.value.length === 0);

function errMessage(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [page, apps] = await Promise.all([listAccessCodes(), listApps()]);
    items.value = page.items;
    passwordApps.value = apps.filter((app) => app.visibility === "password" && app.status === "active");
  } catch (e) {
    error.value = errMessage(e, "加载口令失败");
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});

function toggle(list: string[], id: string) {
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else list.push(id);
}

async function onCreate() {
  error.value = "";
  if (form.appIds.length === 0) {
    error.value = "请至少选择一个口令可见的应用";
    return;
  }
  busy.value = true;
  try {
    const created = await createAccessCode({
      note: form.note.trim() || undefined,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      maxUses: form.maxUses ? Number(form.maxUses) : null,
      appIds: [...form.appIds],
      customCode: form.customCode.trim() || null,
    });
    plainOnce.value = created.plainCode;
    form.note = "";
    form.expiresAt = "";
    form.maxUses = "";
    form.appIds = [];
    form.customCode = "";
    showCreate.value = false;
    await load();
  } catch (e) {
    error.value = errMessage(e, "签发失败");
  } finally {
    busy.value = false;
  }
}

async function copyPlain(id: string) {
  error.value = "";
  busy.value = true;
  try {
    const res = await revealAccessCode(id);
    await navigator.clipboard.writeText(res.plainCode);
    plainOnce.value = res.plainCode;
  } catch (e) {
    error.value = errMessage(e, "复制失败，可尝试轮换");
  } finally {
    busy.value = false;
  }
}

async function onToggle(item: AccessCodeItem) {
  busy.value = true;
  error.value = "";
  try {
    const next = item.storedStatus === "disabled" ? "active" : "disabled";
    if (next === "disabled") await disableAccessCode(item.id);
    else await updateAccessCode(item.id, { status: "active" });
    await load();
  } catch (e) {
    error.value = errMessage(e, "更新状态失败");
  } finally {
    busy.value = false;
  }
}

async function onRotate(item: AccessCodeItem) {
  busy.value = true;
  error.value = "";
  try {
    const res = await rotateAccessCode(item.id);
    plainOnce.value = res.plainCode;
    await load();
  } catch (e) {
    error.value = errMessage(e, "轮换失败");
  } finally {
    busy.value = false;
  }
}

function startEdit(item: AccessCodeItem) {
  editing.value = item.id;
  editForm.note = item.note;
  editForm.expiresAt = item.expiresAt ? item.expiresAt.slice(0, 16) : "";
  editForm.maxUses = item.maxUses == null ? "" : String(item.maxUses);
  editForm.appIds = [...item.appIds];
}

async function onSaveEdit(id: string) {
  busy.value = true;
  error.value = "";
  try {
    await updateAccessCode(id, {
      note: editForm.note,
      expiresAt: editForm.expiresAt ? new Date(editForm.expiresAt).toISOString() : null,
      maxUses: editForm.maxUses ? Number(editForm.maxUses) : null,
      appIds: [...editForm.appIds],
    });
    editing.value = null;
    await load();
  } catch (e) {
    error.value = errMessage(e, "保存失败");
  } finally {
    busy.value = false;
  }
}

function appNames(item: AccessCodeItem) {
  return item.apps.map((app) => app.name).join("、") || "未绑定";
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h1>访问口令</h1>
        <div class="sub">一条口令可绑定多个口令可见的应用，仅解锁下载站。</div>
      </div>
      <button type="button" class="btn btn-primary" @click="showCreate = !showCreate">
        {{ showCreate ? "收起" : "签发口令" }}
      </button>
    </div>

    <div v-if="plainOnce" class="banner-warn" style="margin-bottom: 16px">
      明文仅展示一次，请立即复制：<span class="mono">{{ plainOnce }}</span>
      <button type="button" class="btn btn-sm" style="margin-left: 8px" @click="plainOnce = ''">知道了</button>
    </div>
    <div v-if="error" class="form-error" style="margin-bottom: 12px">{{ error }}</div>

    <form v-if="showCreate" class="form-grid card card-pad" style="margin-bottom: 20px" @submit.prevent="onCreate">
      <div class="field">
        <label for="note">备注</label>
        <input id="note" v-model="form.note" class="input" placeholder="如 Q3 内测群" :disabled="busy" />
      </div>
      <div class="field">
        <label for="exp">过期时间</label>
        <input id="exp" v-model="form.expiresAt" class="input" type="datetime-local" :disabled="busy" />
      </div>
      <div class="field">
        <label for="uses">最大次数</label>
        <input id="uses" v-model="form.maxUses" class="input" type="number" min="1" placeholder="留空不限" :disabled="busy" />
      </div>
      <div class="field">
        <label for="custom">自定义口令</label>
        <input id="custom" v-model="form.customCode" class="input mono" placeholder="留空则自动生成，至少 10 位" :disabled="busy" />
      </div>
      <div class="field span-2">
        <label>绑定应用（仅口令可见）</label>
        <p v-if="passwordApps.length === 0" class="hint">还没有口令可见的应用。请先到应用里把可见性设为「口令」。</p>
        <label v-for="app in passwordApps" :key="app.id" class="t-13" style="display: flex; gap: 8px; margin-top: 6px">
          <input type="checkbox" :checked="form.appIds.includes(app.id)" @change="toggle(form.appIds, app.id)" />
          {{ app.name }} <span class="muted mono">{{ app.slug }}</span>
        </label>
      </div>
      <div class="form-actions span-2">
        <button class="btn btn-primary" type="submit" :disabled="busy">签发</button>
      </div>
    </form>

    <p v-if="loading" class="muted">加载中…</p>
    <div v-else-if="empty" class="empty">
      <h2>还没有访问口令</h2>
      <p>先将应用可见性设为口令，再签发访问口令。</p>
    </div>
    <div v-else class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>备注</th>
            <th>前缀</th>
            <th>状态</th>
            <th>次数</th>
            <th>绑定</th>
            <th>创建人</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="item in items" :key="item.id">
            <tr>
              <td>{{ item.note || "—" }}</td>
              <td class="mono">{{ item.prefix }}</td>
              <td>
                <span class="pill" :class="item.status === 'active' ? 'pill-success' : item.status === 'expired' ? 'pill-warn' : 'pill-muted'">
                  {{ statusLabel[item.status] || item.status }}
                </span>
              </td>
              <td class="mono">{{ item.usedCount }}{{ item.maxUses == null ? "" : ` / ${item.maxUses}` }}</td>
              <td>{{ appNames(item) }}</td>
              <td>{{ item.createdBy?.displayName || item.createdBy?.username || "—" }}</td>
              <td style="white-space: nowrap">
                <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="copyPlain(item.id)">复制</button>
                <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="onToggle(item)">
                  {{ item.storedStatus === "disabled" ? "启用" : "停用" }}
                </button>
                <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="onRotate(item)">轮换</button>
                <button type="button" class="btn btn-ghost btn-sm" :disabled="busy" @click="startEdit(item)">编辑</button>
              </td>
            </tr>
            <tr v-if="editing === item.id">
              <td colspan="7">
                <form class="form-grid" @submit.prevent="onSaveEdit(item.id)">
                  <div class="field">
                    <label>备注</label>
                    <input v-model="editForm.note" class="input" />
                  </div>
                  <div class="field">
                    <label>过期</label>
                    <input v-model="editForm.expiresAt" class="input" type="datetime-local" />
                  </div>
                  <div class="field">
                    <label>次数</label>
                    <input v-model="editForm.maxUses" class="input" type="number" min="1" />
                  </div>
                  <div class="field">
                    <label>绑定</label>
                    <label v-for="app in passwordApps" :key="app.id" class="t-13" style="display: flex; gap: 8px">
                      <input type="checkbox" :checked="editForm.appIds.includes(app.id)" @change="toggle(editForm.appIds, app.id)" />
                      {{ app.name }}
                    </label>
                  </div>
                  <div class="form-actions span-2">
                    <button class="btn btn-primary btn-sm" type="submit" :disabled="busy">保存</button>
                    <button class="btn btn-sm" type="button" @click="editing = null">取消</button>
                  </div>
                </form>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>
