<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, RouterView, useRouter } from "vue-router";
import AppLogo from "@/components/AppLogo.vue";
import { logout as logoutApi } from "@/api/auth";
import { clearSession, session } from "@/auth/session";

const router = useRouter();
const loggingOut = ref(false);
const authed = computed(() => Boolean(session.accessToken && session.user));
const displayName = computed(
  () => session.user?.displayName || session.user?.username || "",
);

async function onLogout() {
  loggingOut.value = true;
  try {
    await logoutApi();
  } catch {
    /* 本地仍清会话 */
  } finally {
    clearSession();
    loggingOut.value = false;
    await router.replace("/");
  }
}
</script>

<template>
  <div>
    <header class="admin-top" style="position: sticky; top: 0; z-index: 10">
      <AppLogo :size="22" to="/" />
      <nav style="display: flex; gap: 8px; align-items: center">
        <RouterLink class="btn btn-ghost btn-sm" to="/">应用目录</RouterLink>
        <RouterLink class="btn btn-ghost btn-sm" to="/docs/update-check">更新检查</RouterLink>
        <RouterLink v-if="authed" class="btn btn-ghost btn-sm" to="/admin">管理端</RouterLink>
        <span v-if="authed" class="muted t-13">{{ displayName }}</span>
        <button v-if="authed" type="button" class="btn btn-sm" :disabled="loggingOut" @click="onLogout">
          {{ loggingOut ? "退出中…" : "退出" }}
        </button>
        <RouterLink v-else class="btn btn-primary btn-sm" to="/admin/login">登录</RouterLink>
      </nav>
    </header>
    <main style="max-width: var(--content); margin: 0 auto; padding: 28px 20px 64px">
      <RouterView />
    </main>
  </div>
</template>
