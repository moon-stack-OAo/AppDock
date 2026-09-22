<script setup lang="ts">
const sample = `curl -sS "/api/v1/public/apps/<slug>/updates/check?currentVersion=1.0.0&platform=windows&arch=x64"`;
</script>

<template>
  <div>
    <div class="page-hd">
      <div>
        <h1>更新检查</h1>
        <div class="sub">客户端用相对路径对接，鉴权与下载页一致。</div>
      </div>
    </div>
    <div class="card card-pad stack">
      <p><span class="mono">GET /api/v1/public/apps/:slug/updates/check</span></p>
      <p class="muted t-13">查询参数：<span class="mono">currentVersion</span>、<span class="mono">platform</span>、<span class="mono">arch</span>。版本号去掉前缀 v 后按主次修订数字比较，缺段当 0。</p>
      <p class="muted t-13">鉴权：公开应用直接可查；口令应用需先解锁（Cookie <span class="mono">access_session</span>）；登录应用需 Bearer。</p>
      <pre class="mono t-13" style="white-space: pre-wrap; margin: 12px 0">{{ sample }}</pre>
      <p class="t-13">有更新且能匹配到安装包：</p>
      <pre class="mono t-12" style="white-space: pre-wrap">{
  "updateAvailable": true,
  "tagName": "v1.2.0",
  "asset": { "id": "...", "name": "...", "size": 1, "sha256": "...", "downloadUrl": "/api/v1/public/apps/&lt;slug&gt;/assets/&lt;id&gt;/download" }
}</pre>
      <p class="t-13" style="margin-top: 12px">没有更新，或没有对应平台包：</p>
      <pre class="mono t-12" style="white-space: pre-wrap">{ "updateAvailable": false }</pre>
    </div>
  </div>
</template>
