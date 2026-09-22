<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { listApps } from "@/api/apps";
import { ApiError } from "@/api/http";
import { session } from "@/auth/session";

const appCount = ref<number | null>(null);
const error = ref("");

onMounted(async () => {
  try {
    const apps = await listApps();
    appCount.value = apps.length;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载应用数量失败";
  }
});
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h1>概览</h1>
        <div class="sub">M1：用户与应用</div>
      </div>
    </div>
    <div class="form-grid" style="align-items: start">
      <div
        class="card"
        style="
          padding: 20px;
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          background: var(--surface);
        "
      >
        <div class="muted t-12" style="margin-bottom: 6px">当前用户</div>
        <div class="t-16" style="font-weight: 600">
          {{ session.user?.username }}
        </div>
          <div class="muted t-13" style="margin-top: 4px">
          {{ session.user?.email }}
          <span v-if="session.user?.role" class="mono"> · {{ session.user.role }}</span>
        </div>
      </div>
      <div
        class="card"
        style="
          padding: 20px;
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          background: var(--surface);
        "
      >
        <div class="muted t-12" style="margin-bottom: 6px">应用</div>
        <div v-if="error" class="form-error">{{ error }}</div>
        <template v-else>
          <div class="t-16" style="font-weight: 600">
            {{ appCount === null ? "…" : appCount }}
          </div>
        <div class="muted t-13" style="margin-top: 4px">
            <RouterLink to="/admin/apps">前往应用列表</RouterLink>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
