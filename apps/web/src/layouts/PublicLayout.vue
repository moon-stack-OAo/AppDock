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
  <div class="pub-shell">
    <header class="pub-top">
      <div class="pub-top-inner">
        <AppLogo to="/" />
        <nav class="pub-nav">
          <RouterLink class="btn btn-ghost btn-sm" to="/">应用目录</RouterLink>
          <RouterLink class="btn btn-ghost btn-sm" to="/docs/update-check">更新 API</RouterLink>
          <template v-if="authed">
            <span class="muted t-13">{{ displayName }}</span>
            <RouterLink class="btn btn-primary btn-sm" to="/admin">管理后台</RouterLink>
            <button type="button" class="btn btn-ghost btn-sm" :disabled="loggingOut" @click="onLogout">
              {{ loggingOut ? "退出中…" : "退出" }}
            </button>
          </template>
          <template v-else>
            <RouterLink class="btn btn-ghost btn-sm" to="/admin/login">登录</RouterLink>
            <RouterLink class="btn btn-sm" to="/admin">管理后台</RouterLink>
          </template>
        </nav>
      </div>
    </header>
    <main class="pub-main">
      <RouterView />
    </main>
    <footer class="pub-footer">AppDock · 应用构建与分发</footer>
  </div>
</template>
