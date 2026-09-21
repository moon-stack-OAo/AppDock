<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppLogo from "@/components/AppLogo.vue";
import { login as loginApi } from "@/api/auth";
import { ApiError } from "@/api/http";
import { setSession } from "@/auth/session";

const router = useRouter();
const route = useRoute();

const loginId = ref("admin");
const password = ref("");
const error = ref("");
const loading = ref(false);

async function onSubmit() {
  error.value = "";
  if (!loginId.value.trim() || !password.value) {
    error.value = "请输入用户名/邮箱与密码";
    return;
  }
  loading.value = true;
  try {
    const res = await loginApi(loginId.value.trim(), password.value);
    setSession(res.accessToken, res.user);
    if (res.user.mustChangePassword) {
      await router.replace({ name: "admin-change-password" });
      return;
    }
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/admin";
    await router.replace(redirect.startsWith("/") ? redirect : "/admin");
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "登录失败，请稍后重试";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <AppLogo to="/" />
      <h1>管理后台登录</h1>
      <p class="lead">
        使用用户名或邮箱登录。种子 Admin 首次登录后须强制修改密码。
      </p>
      <form class="auth-stack" @submit.prevent="onSubmit">
        <div class="field">
          <label for="login">用户名或邮箱</label>
          <input
            id="login"
            v-model="loginId"
            class="input"
            autocomplete="username"
            placeholder="admin 或 name@example.com"
            :disabled="loading"
          />
        </div>
        <div class="field">
          <label for="password">密码</label>
          <input
            id="password"
            v-model="password"
            class="input"
            type="password"
            autocomplete="current-password"
            :disabled="loading"
          />
        </div>
        <div v-if="error" class="form-error">{{ error }}</div>
        <button class="btn btn-primary btn-block" type="submit" :disabled="loading">
          {{ loading ? "登录中…" : "登录" }}
        </button>
        <RouterLink class="btn btn-ghost btn-block" to="/">返回下载站</RouterLink>
      </form>
    </div>
  </div>
</template>
