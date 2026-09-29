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
const detail = ref<AccessCodeItem | null>(null);

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
  active: "启用",
  disabled: "停用",
  expired: "已过期",
};

function when(value: string | null) {
  if (!value) return "—";
  return value.replace("T", " ").slice(0, 16);
}

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

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  }
}

async function copyPlain(id: string) {
  error.value = "";
  busy.value = true;
  try {
    const res = await revealAccessCode(id);
    plainOnce.value = res.plainCode;
    const copied = await writeClipboard(res.plainCode);
    error.value = copied ? "" : "浏览器拦截了剪贴板，明文已显示在上方，请手动复制";
  } catch (e) {
    error.value = errMessage(e, "读取口令失败");
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


</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h1>访问口令</h1>
        <div class="sub">一条口令可绑定多个口令可见的应用，仅解锁下载站。</div>
      </div>
      <button type="button" class="btn btn-primary" @click="showCreate = true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        签发口令
      </button>
    </div>

    <div v-if="error && !showCreate" class="form-error" style="margin-bottom: 12px">{{ error }}</div>

    <div v-if="showCreate" class="modal-backdrop" @click.self="showCreate = false">
      <form class="modal wide" @submit.prevent="onCreate">
        <div class="modal-hd">签发口令</div>
        <div class="modal-bd auth-stack">
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
          <div class="field">
            <label>绑定应用（仅口令可见）</label>
            <p v-if="passwordApps.length === 0" class="hint">还没有口令可见的应用。请先到应用里把可见性设为「口令」。</p>
            <label v-for="app in passwordApps" :key="app.id" class="t-13" style="display: flex; gap: 8px; margin-top: 6px">
              <input type="checkbox" :checked="form.appIds.includes(app.id)" @change="toggle(form.appIds, app.id)" />
              {{ app.name }} <span class="muted mono">{{ app.slug }}</span>
            </label>
          </div>
          <div v-if="error" class="form-error">{{ error }}</div>
        </div>
        <div class="modal-ft">
          <button class="btn" type="button" @click="showCreate = false">取消</button>
          <button class="btn btn-primary" type="submit" :disabled="busy">签发</button>
        </div>
      </form>
    </div>

    <p v-if="loading" class="muted">加载中…</p>
    <div v-else-if="empty" class="empty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
      </svg>
      <h2>还没有访问口令</h2>
      <p>先将应用可见性设为口令，再签发访问口令。</p>
    </div>
    <div v-else class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>备注</th>
            <th>前缀</th>
            <th>状态</th>
            <th>过期</th>
            <th>次数</th>
            <th>绑定应用</th>
            <th>创建人</th>
            <th>最近使用</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td style="font-weight: 600">{{ item.note || "—" }}</td>
            <td class="mono t-12">{{ item.prefix }}…</td>
            <td>
              <span class="pill" :class="item.status === 'active' ? 'pill-success' : item.status === 'expired' ? 'pill-warn' : 'pill-muted'">
                {{ statusLabel[item.status] || item.status }}
              </span>
            </td>
            <td class="mono muted t-12">{{ item.expiresAt ? when(item.expiresAt) : "不过期" }}</td>
            <td class="mono t-12">{{ item.usedCount }} / {{ item.maxUses == null ? "∞" : item.maxUses }}</td>
            <td>
              <span v-if="item.apps.length === 0" class="muted">—</span>
              <span v-else class="platform-badges">
                <span v-for="app in item.apps" :key="app.id" class="pill pill-info">{{ app.name }}</span>
              </span>
            </td>
            <td>{{ item.createdBy?.displayName || item.createdBy?.username || "—" }}</td>
            <td class="mono muted t-12">{{ when(item.lastUsedAt) }}</td>
            <td>
              <div style="display: flex; gap: 4px; flex-wrap: wrap">
                <button type="button" class="btn btn-sm" :disabled="busy" @click="onToggle(item)">
                  {{ item.storedStatus === "disabled" ? "启用" : "停用" }}
                </button>
                <button type="button" class="btn btn-sm" :disabled="busy" @click="startEdit(item)">编辑绑定</button>
                <button type="button" class="btn btn-sm" :disabled="busy" @click="onRotate(item)">轮换</button>
                <button type="button" class="btn btn-sm" :disabled="busy" @click="copyPlain(item.id)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 8h12v12H8V8zm-4 4h2v10h10v2H4V12z" /></svg>
                  复制
                </button>
                <button type="button" class="btn btn-ghost btn-sm" @click="detail = item">详情</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="editing" class="modal-backdrop" @click.self="editing = null">
      <form class="modal" @submit.prevent="onSaveEdit(editing)">
        <div class="modal-hd">编辑绑定应用</div>
        <div class="modal-bd auth-stack">
          <div class="field">
            <label>备注</label>
            <input v-model="editForm.note" class="input" />
          </div>
          <div class="field">
            <label>过期时间</label>
            <input v-model="editForm.expiresAt" class="input" type="datetime-local" />
          </div>
          <div class="field">
            <label>最大使用次数</label>
            <input v-model="editForm.maxUses" class="input mono" type="number" min="1" placeholder="留空 = 不限" />
          </div>
          <div class="field">
            <label>绑定应用</label>
            <label v-for="app in passwordApps" :key="app.id" class="t-13" style="display: flex; gap: 8px; align-items: center">
              <input type="checkbox" :checked="editForm.appIds.includes(app.id)" @change="toggle(editForm.appIds, app.id)" />
              {{ app.name }}
            </label>
          </div>
        </div>
        <div class="modal-ft">
          <button class="btn" type="button" @click="editing = null">取消</button>
          <button class="btn btn-primary" type="submit" :disabled="busy">保存</button>
        </div>
      </form>
    </div>

    <div v-if="detail" class="modal-backdrop" @click.self="detail = null">
      <div class="modal">
        <div class="modal-hd">口令详情</div>
        <div class="modal-bd stack" style="font-size: 13px">
          <div style="display: flex; justify-content: space-between"><span class="muted">备注</span><span>{{ detail.note || "—" }}</span></div>
          <div style="display: flex; justify-content: space-between"><span class="muted">前缀</span><span class="mono">{{ detail.prefix }}…</span></div>
          <div style="display: flex; justify-content: space-between"><span class="muted">状态</span><span>{{ statusLabel[detail.status] || detail.status }}</span></div>
          <div style="display: flex; justify-content: space-between"><span class="muted">过期</span><span class="mono">{{ detail.expiresAt ? when(detail.expiresAt) : "不过期" }}</span></div>
          <div style="display: flex; justify-content: space-between"><span class="muted">次数</span><span class="mono">{{ detail.usedCount }} / {{ detail.maxUses == null ? "∞" : detail.maxUses }}</span></div>
          <div style="display: flex; justify-content: space-between"><span class="muted">创建人</span><span>{{ detail.createdBy?.displayName || detail.createdBy?.username || "—" }}</span></div>
          <div style="display: flex; justify-content: space-between"><span class="muted">最近使用</span><span class="mono">{{ when(detail.lastUsedAt) }}</span></div>
          <div class="platform-badges">
            <span v-if="detail.apps.length === 0" class="muted">未绑定应用</span>
            <span v-for="app in detail.apps" :key="app.id" class="pill pill-info">{{ app.name }}</span>
          </div>
        </div>
        <div class="modal-ft">
          <button type="button" class="btn" :disabled="busy" @click="copyPlain(detail.id)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 8h12v12H8V8zm-4 4h2v10h10v2H4V12z" /></svg>
            复制口令
          </button>
          <button type="button" class="btn btn-primary" @click="detail = null">关闭</button>
        </div>
      </div>
    </div>

    <div v-if="plainOnce" class="modal-backdrop modal-front" @click.self="plainOnce = ''">
      <div class="modal" style="border-color: var(--accent)">
        <div class="modal-hd">口令明文</div>
        <div class="modal-bd">
          <p class="mono" style="color: var(--fg); word-break: break-all">{{ plainOnce }}</p>
          <p class="hint" style="margin-top: 8px">请立即复制。关闭后仍可在列表里再次复制。</p>
        </div>
        <div class="modal-ft">
          <button type="button" class="btn btn-sm" @click="plainOnce = ''">知道了</button>
          <button type="button" class="btn btn-primary btn-sm" @click="writeClipboard(plainOnce)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 8h12v12H8V8zm-4 4h2v10h10v2H4V12z" /></svg>
            复制
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
