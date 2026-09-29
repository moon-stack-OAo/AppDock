<script setup lang="ts">
import { RouterLink } from "vue-router";
import { ref } from "vue";

const copied = ref(false);
const sample = `{
  "updateAvailable": true,
  "tagName": "v1.2.0",
  "asset": {
    "id": "...",
    "name": "App-1.2.0-win-x64.exe",
    "size": 1,
    "sha256": "...",
    "downloadUrl": "/api/v1/public/apps/<slug>/assets/<id>/download"
  }
}`;

async function copySample() {
  try {
    await navigator.clipboard.writeText(sample);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}
</script>

<template>
  <div>
    <div class="breadcrumb">
      <RouterLink to="/">应用目录</RouterLink><span>/</span><span>更新检查 API</span>
    </div>
    <h1 class="t-24" style="font-weight: 700; margin-bottom: 8px">客户端更新检查</h1>
    <p class="muted" style="max-width: 720px; margin-bottom: 20px">
      一期提供极简 HTTP API，供桌面或移动客户端探测是否有新安装包。下载请走 AppDock 链接，不要直连 GitHub。
    </p>
    <div class="card card-pad" style="margin-bottom: 16px; max-width: 720px">
      <div class="panel-title">端点</div>
      <p class="mono t-13">GET /api/v1/public/apps/:slug/updates/check</p>
      <p class="hint" style="margin-top: 8px">
        Query：currentVersion、platform（windows / macos / linux / android）、arch（x64 / arm64，可选）。版本号去掉前缀 v 后按主次修订数字比较，缺段当 0。
      </p>
      <p class="hint" style="margin-top: 8px">
        鉴权与下载页一致：公开应用直接可查；口令应用需先解锁（Cookie access_session）；登录应用需 Bearer。
      </p>
    </div>
    <div class="card card-pad" style="margin-bottom: 16px; max-width: 720px">
      <div class="panel-title">按文件名下载</div>
      <p class="mono t-13">GET /api/v1/public/apps/:slug/files/:fileName/download</p>
      <p class="hint" style="margin-top: 8px">
        发版清单可写死文件名，不必等 assetId。命中该应用非预发布版本中版本号最高的同名产物。鉴权与上面一致。
      </p>
    </div>
    <div style="display: flex; justify-content: space-between; align-items: center; max-width: 720px; margin-bottom: 8px">
      <h2 class="t-16" style="font-weight: 600">有更新</h2>
      <button type="button" class="btn btn-sm" @click="copySample">{{ copied ? "已复制" : "复制示例" }}</button>
    </div>
    <div class="changelog" style="max-width: 720px">{{ sample }}</div>
    <h2 class="t-16" style="font-weight: 600; margin: 20px 0 8px">已是最新</h2>
    <div class="changelog" style="max-width: 720px">{ "updateAvailable": false }</div>
  </div>
</template>
