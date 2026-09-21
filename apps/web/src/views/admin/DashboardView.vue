<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import AppLogo from "@/components/AppLogo.vue";
import { logout as logoutApi } from "@/api/auth";
import { clearSession, session } from "@/auth/session";

const router = useRouter();
const loggingOut = ref(false);

async function onLogout() {
  loggingOut.value = true;
  try {
    await logoutApi();
  } catch {
    /* 本地仍清会话 */
  } finally {
    clearSession();
    loggingOut.value = false;
    await router.replace({ name: "admin-login" });
  }
}
</script>

<template>
  <div class="admin-shell">
    <header class="admin-top">
      <AppLogo :size="24" to="/admin" />
      <div style="display: flex; align-items: center; gap: 12px">
        <span class="muted" style="font-size: 13px">
          {{ session.user?.displayName || session.user?.username }}
        </span>
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="loggingOut"
          @click="onLogout"
        >
          {{ loggingOut ? "退出中…" : "登出" }}
        </button>
      </div>
    </header>
    <main class="admin-content">
      <div class="page-hd">
        <div>
          <h1>仪表盘</h1>
          <div class="sub">M0 占位 — 应用管理等功能后续里程碑实现</div>
        </div>
      </div>
      <div
        class="card"
        style="
          padding: 20px;
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          background: var(--surface);
          max-width: 480px;
        "
      >
        <div class="muted" style="font-size: 12px; margin-bottom: 6px">当前用户</div>
        <div style="font-size: 18px; font-weight: 600">
          {{ session.user?.username }}
        </div>
        <div class="muted" style="margin-top: 4px; font-size: 13px">
          {{ session.user?.email }}
          <span v-if="session.user?.role" class="mono"> · {{ session.user.role }}</span>
        </div>
      </div>
    </main>
  </div>
</template>
