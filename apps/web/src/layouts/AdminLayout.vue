<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import AppLogo from "@/components/AppLogo.vue";
import { logout as logoutApi } from "@/api/auth";
import { clearSession, session } from "@/auth/session";

const router = useRouter();
const route = useRoute();
const loggingOut = ref(false);
const menuOpen = ref(false);

const isAdmin = computed(() => session.user?.role === "admin");
const displayName = computed(
  () => session.user?.displayName || session.user?.username || "未登录",
);
const initial = computed(() => displayName.value.slice(0, 1).toUpperCase());

const roleLabel: Record<string, string> = {
  admin: "管理员",
  user: "用户",
};

function isApps() {
  return String(route.name ?? "").startsWith("admin-app");
}

async function onLogout() {
  menuOpen.value = false;
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
    <aside class="admin-side">
      <div class="admin-side-hd">
        <AppLogo :size="24" to="/admin" />
      </div>
      <nav class="admin-nav" aria-label="管理导航">
        <div class="nav-sec">工作台</div>
        <RouterLink to="/admin" class="nav-item" :class="{ active: route.name === 'admin-dashboard' }">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5z" />
          </svg>
          仪表盘
        </RouterLink>
        <RouterLink to="/admin/apps" class="nav-item" :class="{ active: isApps() }">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" />
          </svg>
          应用
        </RouterLink>
        <RouterLink to="/admin/jobs" class="nav-item" :class="{ active: route.name === 'admin-jobs' }">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
          </svg>
          任务
        </RouterLink>
        <RouterLink v-if="isAdmin" to="/admin/access-codes" class="nav-item" :class="{ active: route.name === 'admin-access-codes' }">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v10H6V11z" />
          </svg>
          访问口令
        </RouterLink>
        <RouterLink v-if="isAdmin" to="/admin/settings" class="nav-item" :class="{ active: route.name === 'admin-settings' }">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
          </svg>
          设置
        </RouterLink>
        <RouterLink v-if="isAdmin" to="/admin/users" class="nav-item" :class="{ active: route.name === 'admin-users' }">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          用户
        </RouterLink>
        <div class="nav-sec">对外</div>
        <RouterLink to="/" class="nav-item">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M14 4h6v6M10 14L20 4M20 14v6H4V4h6" />
          </svg>
          下载站
        </RouterLink>
      </nav>
    </aside>
    <div class="admin-body">
      <header class="admin-top">
        <div class="muted t-13">同步 · 分发</div>
        <div class="user-menu">
          <button type="button" class="user-btn" @click="menuOpen = !menuOpen">
            <span class="avatar">{{ initial }}</span>
            <span class="t-13">{{ displayName }}</span>
          </button>
          <div v-if="menuOpen" class="dropdown">
            <div class="muted t-12" style="padding: 8px 10px">
              {{ session.user?.email }}<br />
              {{ roleLabel[session.user?.role ?? ""] || session.user?.role }}
            </div>
            <button type="button" :disabled="loggingOut" @click="onLogout">
              {{ loggingOut ? "退出中…" : "退出登录" }}
            </button>
          </div>
        </div>
      </header>
      <main class="admin-content">
        <RouterView />
      </main>
    </div>
  </div>
</template>
