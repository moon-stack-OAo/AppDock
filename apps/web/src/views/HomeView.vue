<script setup lang="ts">
import AppLogo from "@/components/AppLogo.vue";
</script>

<template>
  <div class="home-wrap">
    <div>
      <AppLogo :size="36" to="/" />
      <h1 style="margin-top: 16px">下载站 M5</h1>
      <p>公开下载站将在 M5 实现。管理端可先登录使用。</p>
      <RouterLink class="btn btn-primary" to="/admin">进入管理端</RouterLink>
    </div>
  </div>
</template>
