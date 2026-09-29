<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError } from "@/api/http";
import { getSettings, patchSettings, testSmtp, type SettingsView } from "@/api/settings";

const route = useRoute();
const router = useRouter();
const tabs = ["general", "sync", "mail"] as const;
type Tab = (typeof tabs)[number];

const tab = computed<Tab>(() => {
  const raw = String(route.query.tab ?? "general");
  return tabs.includes(raw as Tab) ? (raw as Tab) : "general";
});

const loading = ref(true);
const busy = ref(false);
const error = ref("");
const settings = ref<SettingsView | null>(null);

const siteName = ref("");
const publicBaseUrl = ref("");
const defaultPollIntervalSec = ref(300);
const maxAssetSizeMb = ref(1024);
const notifyEmailsText = ref("");
const smtpEnabled = ref(false);
const host = ref("");
const port = ref(587);
const encryption = ref<"ssl_tls" | "starttls" | "none">("starttls");
const username = ref("");
const password = ref("");
const passwordSet = ref(false);
const fromName = ref("AppDock");
const fromEmail = ref("");
const connectTimeoutSec = ref(15);
const testOpen = ref(false);
const testTo = ref("");
const toast = ref("");
let toastTimer = 0;

function showToast(message: string) {
  toast.value = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = "";
  }, 2400);
}

function apply(data: SettingsView) {
  settings.value = data;
  siteName.value = data.siteName;
  publicBaseUrl.value = data.publicBaseUrl;
  defaultPollIntervalSec.value = data.defaultPollIntervalSec;
  maxAssetSizeMb.value = Math.max(1, Math.round(data.maxAssetSizeBytes / 1024 / 1024));
  notifyEmailsText.value = data.notifyGlobalEmails.join("\n");
  smtpEnabled.value = data.smtp.enabled;
  host.value = data.smtp.host;
  port.value = data.smtp.port;
  encryption.value = data.smtp.encryption;
  username.value = data.smtp.username;
  password.value = "";
  passwordSet.value = data.smtp.passwordSet;
  fromName.value = data.smtp.fromName;
  fromEmail.value = data.smtp.fromEmail;
  connectTimeoutSec.value = data.smtp.connectTimeoutSec;
}

function setTab(next: Tab) {
  void router.replace({ query: { ...route.query, tab: next } });
}

onMounted(async () => {
  try {
    apply(await getSettings());
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载设置失败";
  } finally {
    loading.value = false;
  }
});

watch(tab, () => {
  error.value = "";
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emails() {
  return notifyEmailsText.value
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function smtpDraft() {
  const smtp: Parameters<typeof patchSettings>[0]["smtp"] = {
    enabled: smtpEnabled.value,
    host: host.value.trim(),
    port: Number(port.value) || 587,
    encryption: encryption.value,
    username: username.value.trim(),
    fromName: fromName.value.trim(),
    fromEmail: fromEmail.value.trim(),
    connectTimeoutSec: Number(connectTimeoutSec.value) || 15,
  };
  if (password.value !== "") smtp.password = password.value;
  return smtp;
}

const smtpReady = computed(
  () => Boolean(host.value.trim() && fromEmail.value.trim() && (passwordSet.value || password.value)),
);

function onEncryption(next: "ssl_tls" | "starttls" | "none") {
  encryption.value = next;
  if (next === "ssl_tls" && port.value !== 465) {
    port.value = 465;
    showToast("已建议端口 465（SSL/TLS）");
  } else if (next === "starttls" && port.value !== 587) {
    port.value = 587;
    showToast("已建议端口 587（STARTTLS）");
  }
}

async function onSave() {
  const list = emails();
  const invalid = list.filter((item) => !EMAIL_RE.test(item));
  if (invalid.length) {
    error.value = `全局默认收件人不是合法邮箱：${invalid.join("、")}`;
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    apply(
      await patchSettings({
        siteName: siteName.value.trim(),
        publicBaseUrl: publicBaseUrl.value.trim(),
        defaultPollIntervalSec: Number(defaultPollIntervalSec.value) || 300,
        maxAssetSizeBytes: Math.max(1, Math.round(Number(maxAssetSizeMb.value) || 1)) * 1024 * 1024,
        notifyGlobalEmails: list,
        smtp: smtpDraft(),
      }),
    );
    showToast(tab.value === "mail" ? "邮件设置已保存" : tab.value === "sync" ? "同步设置已保存" : "设置已保存");
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "保存失败";
  } finally {
    busy.value = false;
  }
}

function openTest() {
  error.value = "";
  testTo.value = emails()[0] ?? "";
  testOpen.value = true;
}

async function onTest() {
  const to = testTo.value.trim();
  if (!to) {
    showToast("请填写测试收件人");
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const result = await testSmtp({ to, smtp: smtpDraft() });
    testOpen.value = false;
    showToast(`测试邮件已发送 → ${result.to}`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "发送测试邮件失败";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h1>系统设置</h1>
        <div class="sub">站点、同步默认值与 SMTP。密码只写不回显。</div>
      </div>
    </div>

    <p v-if="loading" class="muted">加载中…</p>
    <template v-else>
      <div class="tabs">
        <button type="button" class="tab" :class="{ active: tab === 'general' }" @click="setTab('general')">常规</button>
        <button type="button" class="tab" :class="{ active: tab === 'sync' }" @click="setTab('sync')">同步</button>
        <button type="button" class="tab" :class="{ active: tab === 'mail' }" @click="setTab('mail')">邮件</button>
      </div>
      <div v-if="error" class="form-error" style="margin-bottom: 12px">{{ error }}</div>

      <form class="card card-pad" :class="tab === 'mail' ? 'mail-layout' : 'form-grid'" :style="tab === 'mail' ? undefined : { maxWidth: '640px' }" @submit.prevent="onSave">
        <template v-if="tab === 'general'">
          <div class="field">
            <label for="site-name">站点名称</label>
            <input id="site-name" v-model="siteName" class="input" :disabled="busy" />
          </div>
          <div class="field">
            <label for="base-url">对外根 URL</label>
            <input id="base-url" v-model="publicBaseUrl" class="input mono" placeholder="https://dock.example.com" :disabled="busy" />
            <span class="hint">邮件里的下载链接用这个地址，不链 GitHub。</span>
          </div>
          <div class="field span-2">
            <label>存储目录（只读）</label>
            <div class="mono">{{ settings?.storageRoot || "—" }}</div>
          </div>
        </template>

        <template v-else-if="tab === 'sync'">
          <div class="field">
            <label for="poll">默认同步间隔（秒）</label>
            <input id="poll" v-model.number="defaultPollIntervalSec" class="input" type="number" min="30" :disabled="busy" />
          </div>
          <div class="field">
            <label for="max-size">上传大小上限（MB）</label>
            <input id="max-size" v-model.number="maxAssetSizeMb" class="input mono" type="number" min="1" :disabled="busy" />
          </div>
        </template>

        <template v-else>
          <div class="mail-head">
            <div class="panel-title" style="display: flex; justify-content: space-between; align-items: center">
              <span>邮件 / SMTP</span>
              <span class="pill" :class="smtpReady ? 'pill-success' : 'pill-warn'">{{ smtpReady ? "已配置" : "未配置" }}</span>
            </div>
            <p class="hint">以管理端配置为准；密码只写不回显。测试邮件直接使用当前表单，不要求先保存。</p>
            <div class="switch-row">
              <div>
                <div style="font-weight: 500">启用邮件通知</div>
                <div class="hint">关闭后队列仍可入队但不发送</div>
              </div>
              <label class="switch">
                <input v-model="smtpEnabled" type="checkbox" :disabled="busy" />
                <span></span>
              </label>
            </div>
          </div>
          <div class="form-grid">
            <div class="field">
              <label for="smtp-host">SMTP Host</label>
              <input id="smtp-host" v-model="host" class="input mono" placeholder="smtp.example.com" :disabled="busy" />
            </div>
            <div class="field">
              <label for="smtp-port">Port</label>
              <input id="smtp-port" v-model.number="port" class="input mono" type="number" min="1" max="65535" :disabled="busy" />
              <span class="hint">465 常配 SSL/TLS；587 常配 STARTTLS</span>
            </div>
            <div class="field">
              <label for="smtp-enc">加密方式</label>
              <select id="smtp-enc" class="select" :value="encryption" :disabled="busy" @change="onEncryption(($event.target as HTMLSelectElement).value as 'ssl_tls' | 'starttls' | 'none')">
                <option value="ssl_tls">SSL/TLS</option>
                <option value="starttls">STARTTLS</option>
                <option value="none">无</option>
              </select>
            </div>
            <div class="field">
              <label for="smtp-timeout">连接超时（秒）</label>
              <input id="smtp-timeout" v-model.number="connectTimeoutSec" class="input mono" type="number" min="1" max="120" :disabled="busy" />
            </div>
          </div>
          <div class="form-grid">
            <div class="field">
              <label for="smtp-user">用户名</label>
              <input id="smtp-user" v-model="username" class="input mono" :disabled="busy" />
            </div>
            <div class="field">
              <label for="smtp-pass">密码</label>
              <input
                id="smtp-pass"
                v-model="password"
                class="input mono"
                type="password"
                autocomplete="new-password"
                :placeholder="passwordSet ? '已设置，留空则不修改' : '输入 SMTP 密码'"
                :disabled="busy"
              />
              <span class="hint">{{ passwordSet ? "已设置；留空保存则保留原密码" : "保存后密码不会回显" }}</span>
            </div>
            <div class="field">
              <label for="from-name">发件人名称</label>
              <input id="from-name" v-model="fromName" class="input" :disabled="busy" />
            </div>
            <div class="field">
              <label for="from-email">发件人邮箱</label>
              <input id="from-email" v-model="fromEmail" class="input mono" :disabled="busy" />
            </div>
          </div>
          <div class="field">
            <label for="global-emails">全局默认收件人</label>
            <textarea id="global-emails" v-model="notifyEmailsText" class="textarea mono" rows="2" placeholder="每行一个邮箱" :disabled="busy" />
            <span class="hint">应用级自定义为空且开启回落时使用</span>
          </div>
        </template>

        <div v-if="tab === 'mail'" style="display: flex; gap: 8px; flex-wrap: wrap">
          <button class="btn btn-primary" type="submit" :disabled="busy">保存设置</button>
          <button class="btn" type="button" :disabled="busy || !smtpReady || !smtpEnabled" @click="openTest">发送测试邮件</button>
        </div>
        <div v-else class="form-actions span-2">
          <button class="btn btn-primary" type="submit" :disabled="busy">保存设置</button>
        </div>
      </form>
    </template>

    <div v-if="toast" class="toast ok">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      {{ toast }}
    </div>

    <div v-if="testOpen" class="modal-backdrop" @click.self="testOpen = false">
      <form class="modal" @submit.prevent="onTest">
        <div class="modal-hd">发送测试邮件</div>
        <div class="modal-bd">
          <div class="field">
            <label for="test-to">测试收件人</label>
            <input id="test-to" v-model="testTo" class="input mono" placeholder="you@example.com" :disabled="busy" />
            <span class="hint">已配置全局收件人时默认取第一行，可修改</span>
          </div>
          <div v-if="error" class="form-error" style="margin-top: 12px">{{ error }}</div>
        </div>
        <div class="modal-ft">
          <button class="btn" type="button" :disabled="busy" @click="testOpen = false">取消</button>
          <button class="btn btn-primary" type="submit" :disabled="busy">发送</button>
        </div>
      </form>
    </div>
  </div>
</template>
