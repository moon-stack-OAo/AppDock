<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import AppLogo from "@/components/AppLogo.vue";
import { changePassword, fetchMe } from "@/api/auth";
import { ApiError } from "@/api/http";
import { session, setUser } from "@/auth/session";

const router = useRouter();

const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const error = ref("");
const loading = ref(false);

const accountLabel = computed(
  () => session.user?.username || session.user?.email || "—",
);

async function onSubmit() {
  error.value = "";
  if (!currentPassword.value) {
    error.value = "请输入当前密码";
    return;
  }
  if (newPassword.value.length < 8) {
    error.value = "新密码至少 8 位";
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = "两次输入的新密码不一致";
    return;
  }
  if (currentPassword.value === newPassword.value) {
    error.value = "新密码不能与当前密码相同";
    return;
  }

  loading.value = true;
  try {
    await changePassword(currentPassword.value, newPassword.value);
    const me = await fetchMe();
    setUser(me);
    await router.replace({ name: "admin-dashboard" });
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "修改失败，请稍后重试";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <AppLogo to="/" />
      <h1>修改初始密码</h1>
      <p class="lead">
        账号 <span class="mono">{{ accountLabel }}</span> 须先修改密码，方可进入管理后台。
      </p>
      <form class="auth-stack" @submit.prevent="onSubmit">
        <div class="field">
          <label for="current">当前密码</label>
          <input
            id="current"
            v-model="currentPassword"
            class="input"
            type="password"
            autocomplete="current-password"
            :disabled="loading"
          />
        </div>
        <div class="field">
          <label for="next">新密码</label>
          <input
            id="next"
            v-model="newPassword"
            class="input"
            type="password"
            autocomplete="new-password"
            :disabled="loading"
          />
          <div class="hint">一期规则：至少 8 位</div>
        </div>
        <div class="field">
          <label for="confirm">确认新密码</label>
          <input
            id="confirm"
            v-model="confirmPassword"
            class="input"
            type="password"
            autocomplete="new-password"
            :disabled="loading"
          />
        </div>
        <div v-if="error" class="form-error">{{ error }}</div>
        <button class="btn btn-primary btn-block" type="submit" :disabled="loading">
          {{ loading ? "提交中…" : "确认修改" }}
        </button>
      </form>
    </div>
  </div>
</template>
