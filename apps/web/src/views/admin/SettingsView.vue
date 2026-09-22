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
const saved = ref("");
const settings = ref<SettingsView | null>(null);

const siteName = ref("");
const publicBaseUrl = ref("");
const defaultPollIntervalSec = ref(300);
const maxAssetSizeBytes = ref(1073741824);
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
const replyTo = ref("");
const connectTimeoutSec = ref(15);
const testTo = ref("");

function apply(data: SettingsView) {
  settings.value = data;
  siteName.value = data.siteName;
  publicBaseUrl.value = data.publicBaseUrl;
  defaultPollIntervalSec.value = data.defaultPollIntervalSec;
  maxAssetSizeBytes.value = data.maxAssetSizeBytes;
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
  replyTo.value = data.smtp.replyTo ?? "";
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
  saved.value = "";
});

function emails() {
  return notifyEmailsText.value
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function onSave() {
  busy.value = true;
  error.value = "";
  saved.value = "";
  try {
    const smtp: Parameters<typeof patchSettings>[0]["smtp"] = {
      enabled: smtpEnabled.value,
      host: host.value.trim(),
      port: Number(port.value) || 587,
      encryption: encryption.value,
      username: username.value.trim(),
      fromName: fromName.value.trim(),
      fromEmail: fromEmail.value.trim(),
      replyTo: replyTo.value.trim() || null,
      connectTimeoutSec: Number(connectTimeoutSec.value) || 15,
    };
    if (password.value !== "") smtp.password = password.value;
    apply(
      await patchSettings({
        siteName: siteName.value.trim(),
        publicBaseUrl: publicBaseUrl.value.trim(),
        defaultPollIntervalSec: Number(defaultPollIntervalSec.value) || 300,
        maxAssetSizeBytes: Number(maxAssetSizeBytes.value) || 1,
        notifyGlobalEmails: emails(),
        smtp,
      }),
    );
    saved.value = "已保存";
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "保存失败";
  } finally {
    busy.value = false;
  }
}

async function onTest() {
  const to = testTo.value.trim();
  if (!to) {
    error.value = "请填写测试收件人";
    return;
  }
  busy.value = true;
  error.value = "";
  saved.value = "";
  try {
    await testSmtp(to);
    saved.value = `测试信已发往 ${to}`;
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
      <div v-if="saved" class="banner-warn">{{ saved }}</div>

      <form class="form-grid card card-pad" style="max-width: 720px" @submit.prevent="onSave">
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
            <label for="max-size">单文件上限（字节）</label>
            <input id="max-size" v-model.number="maxAssetSizeBytes" class="input" type="number" min="1" :disabled="busy" />
          </div>
        </template>

        <template v-else>
          <div class="switch-row span-2">
            <div>
              <div>启用邮件</div>
              <div class="hint muted t-12">关闭后通知任务会跳过，不重试。</div>
            </div>
            <label class="switch">
              <input v-model="smtpEnabled" type="checkbox" :disabled="busy" />
              <span></span>
            </label>
          </div>
          <div class="field">
            <label for="smtp-host">SMTP 主机</label>
            <input id="smtp-host" v-model="host" class="input mono" :disabled="busy" />
          </div>
          <div class="field">
            <label for="smtp-port">端口</label>
            <input id="smtp-port" v-model.number="port" class="input" type="number" min="1" max="65535" :disabled="busy" />
          </div>
          <div class="field">
            <label for="smtp-enc">加密</label>
            <select id="smtp-enc" v-model="encryption" class="select" :disabled="busy">
              <option value="ssl_tls">SSL/TLS</option>
              <option value="starttls">STARTTLS</option>
              <option value="none">无</option>
            </select>
          </div>
          <div class="field">
            <label for="smtp-user">用户名</label>
            <input id="smtp-user" v-model="username" class="input" :disabled="busy" />
          </div>
          <div class="field">
            <label for="smtp-pass">密码</label>
            <input
              id="smtp-pass"
              v-model="password"
              class="input"
              type="password"
              autocomplete="new-password"
              :placeholder="passwordSet ? '已设置，留空则不修改' : ''"
              :disabled="busy"
            />
          </div>
          <div class="field">
            <label for="smtp-timeout">连接超时（秒）</label>
            <input id="smtp-timeout" v-model.number="connectTimeoutSec" class="input" type="number" min="1" max="120" :disabled="busy" />
          </div>
          <div class="field">
            <label for="from-name">发件人名称</label>
            <input id="from-name" v-model="fromName" class="input" :disabled="busy" />
          </div>
          <div class="field">
            <label for="from-email">发件人邮箱</label>
            <input id="from-email" v-model="fromEmail" class="input" :disabled="busy" />
          </div>
          <div class="field">
            <label for="reply-to">回复地址</label>
            <input id="reply-to" v-model="replyTo" class="input" :disabled="busy" />
          </div>
          <div class="field span-2">
            <label for="global-emails">全局默认收件人</label>
            <textarea id="global-emails" v-model="notifyEmailsText" class="textarea" placeholder="每行一个邮箱" :disabled="busy" />
            <span class="hint">应用自定义邮箱为空且允许回落时使用。</span>
          </div>
          <div class="field">
            <label for="test-to">测试收件人</label>
            <input id="test-to" v-model="testTo" class="input" placeholder="you@example.com" :disabled="busy" />
          </div>
          <div class="field" style="justify-content: flex-end">
            <button class="btn" type="button" :disabled="busy" @click="onTest">发送测试邮件</button>
          </div>
        </template>

        <div class="form-actions span-2">
          <button class="btn btn-primary" type="submit" :disabled="busy">保存</button>
        </div>
      </form>
    </template>
  </div>
</template>
