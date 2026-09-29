<script setup lang="ts">
import { RouterLink } from "vue-router";
</script>

<template>
  <div class="empty">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 9v4m0 4h.01M10.3 4.3L2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
    </svg>
    <h2>页面不存在</h2>
    <p>这个地址没有对应的页面。回到目录，或查看更新检查说明。</p>
    <div class="empty-actions">
      <RouterLink class="btn" to="/">返回首页</RouterLink>
      <RouterLink class="btn btn-ghost" to="/docs/update-check">更新 API 文档</RouterLink>
    </div>
  </div>
</template>
