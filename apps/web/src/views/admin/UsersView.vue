<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { createUser, listUsers, updateUser, type AdminUser } from "@/api/users";
import { ApiError } from "@/api/http";

const users = ref<AdminUser[]>([]);
const error = ref("");
const formError = ref("");
const loading = ref(true);
const creating = ref(false);
const showCreate = ref(false);
const resetFor = ref<string | null>(null);
const resetPassword = ref("");
const rowBusy = ref<string | null>(null);

const form = reactive({
  username: "",
  email: "",
  displayName: "",
  password: "",
  role: "user",
});

const roleLabel: Record<string, string> = {
  admin: "系统管理员 Admin",
  user: "普通用户 User",
};

function errMessage(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback;
}

async function load() {
  error.value = "";
  loading.value = true;
  try {
    users.value = await listUsers();
  } catch (e) {
    error.value = errMessage(e, "加载用户失败");
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});

async function onCreate() {
  formError.value = "";
  if (!form.username.trim() || !form.email.trim()) {
    formError.value = "请填写用户名与邮箱";
    return;
  }
  if (form.password.length < 8) {
    formError.value = "密码至少 8 位";
    return;
  }
  creating.value = true;
  try {
    const created = await createUser({
      username: form.username.trim(),
      email: form.email.trim(),
      displayName: form.displayName.trim() || undefined,
      password: form.password,
      role: form.role,
    });
    users.value = [created, ...users.value];
    form.username = "";
    form.email = "";
    form.displayName = "";
    form.password = "";
    form.role = "user";
    showCreate.value = false;
  } catch (e) {
    formError.value = errMessage(e, "创建失败");
  } finally {
    creating.value = false;
  }
}

async function onRole(user: AdminUser, role: string) {
  if (role === user.role) return;
  const prev = user.role;
  rowBusy.value = user.id;
  error.value = "";
  try {
    const updated = await updateUser(user.id, { role });
    Object.assign(user, updated);
  } catch (e) {
    user.role = prev;
    error.value = errMessage(e, "修改角色失败");
  } finally {
    rowBusy.value = null;
  }
}

async function onToggleStatus(user: AdminUser) {
  const next = user.status === "disabled" ? "active" : "disabled";
  rowBusy.value = user.id;
  error.value = "";
  try {
    const updated = await updateUser(user.id, { status: next });
    Object.assign(user, updated);
  } catch (e) {
    error.value = errMessage(e, "更新状态失败");
  } finally {
    rowBusy.value = null;
  }
}

function startReset(user: AdminUser) {
  resetFor.value = user.id;
  resetPassword.value = "";
  error.value = "";
}

async function onReset(user: AdminUser) {
  if (resetPassword.value.length < 8) {
    error.value = "密码至少 8 位";
    return;
  }
  rowBusy.value = user.id;
  error.value = "";
  try {
    const updated = await updateUser(user.id, { password: resetPassword.value });
    Object.assign(user, updated);
    resetFor.value = null;
    resetPassword.value = "";
  } catch (e) {
    error.value = errMessage(e, "重置密码失败");
  } finally {
    rowBusy.value = null;
  }
}
</script>

<template>
  <div>
    <div class="page-hd" style="display: flex; align-items: flex-end; justify-content: space-between; gap: 16px">
      <div>
        <h1>用户管理</h1>
        <div class="sub">系统角色仅 admin / user；应用级权限在应用「成员」中配置</div>
      </div>
      <button type="button" class="btn btn-primary" @click="showCreate = !showCreate">
        {{ showCreate ? "收起" : "创建用户" }}
      </button>
    </div>

    <form v-if="showCreate" class="form-grid card card-pad" style="margin-bottom: 20px" @submit.prevent="onCreate">
      <div class="field">
        <label for="u-name">用户名</label>
        <input id="u-name" v-model="form.username" class="input" :disabled="creating" required />
      </div>
      <div class="field">
        <label for="u-email">邮箱</label>
        <input id="u-email" v-model="form.email" class="input" type="email" :disabled="creating" required />
      </div>
      <div class="field">
        <label for="u-display">显示名</label>
        <input id="u-display" v-model="form.displayName" class="input" :disabled="creating" />
      </div>
      <div class="field">
        <label for="u-pass">密码</label>
        <input id="u-pass" v-model="form.password" class="input" type="password" minlength="8" :disabled="creating" required />
      </div>
      <div class="field span-2" style="max-width: 320px">
        <label for="u-role">角色</label>
        <select id="u-role" v-model="form.role" class="select" :disabled="creating">
          <option value="user">用户</option>
          <option value="admin">管理员</option>
        </select>
      </div>
      <div v-if="formError" class="form-error span-2">{{ formError }}</div>
      <div class="form-actions span-2">
        <button class="btn btn-primary" type="submit" :disabled="creating">
          {{ creating ? "创建中…" : "创建" }}
        </button>
      </div>
    </form>

    <div v-if="error" class="form-error" style="margin-bottom: 12px">{{ error }}</div>
    <p v-if="loading" class="muted">加载中…</p>
    <p v-else-if="users.length === 0" class="muted">还没有用户。</p>
    <div v-else class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>用户</th>
            <th>邮箱</th>
            <th>系统角色</th>
            <th>状态</th>
            <th>须改密</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id">
            <td>
              <div style="font-weight: 600">{{ user.displayName || user.username }}</div>
              <div v-if="user.displayName" class="muted mono t-12">{{ user.username }}</div>
            </td>
            <td class="mono t-12">{{ user.email }}</td>
            <td>
              <select
                class="select"
                style="height: 30px; max-width: 180px"
                :value="user.role"
                :disabled="rowBusy === user.id"
                @change="onRole(user, ($event.target as HTMLSelectElement).value)"
              >
                <option value="user">{{ roleLabel.user }}</option>
                <option value="admin">{{ roleLabel.admin }}</option>
              </select>
            </td>
            <td>
              <span class="pill" :class="user.status === 'active' ? 'pill-success' : 'pill-muted'">
                {{ user.status === "active" ? "启用" : "禁用" }}
              </span>
            </td>
            <td>
              <span class="pill" :class="user.mustChangePassword ? 'pill-warn' : 'pill-muted'">
                {{ user.mustChangePassword ? "是" : "否" }}
              </span>
            </td>
            <td>
              <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap">
                <button
                  type="button"
                  class="btn btn-sm"
                  :disabled="rowBusy === user.id"
                  @click="onToggleStatus(user)"
                >
                  {{ user.status === "disabled" ? "启用" : "禁用" }}
                </button>
                <button
                  v-if="resetFor !== user.id"
                  type="button"
                  class="btn btn-sm"
                  :disabled="rowBusy === user.id"
                  @click="startReset(user)"
                >
                  重置密码
                </button>
                <template v-else>
                  <input
                    v-model="resetPassword"
                    class="input"
                    type="password"
                    placeholder="至少 8 位"
                    style="width: 140px; height: 30px"
                    :disabled="rowBusy === user.id"
                  />
                  <button type="button" class="btn btn-sm" :disabled="rowBusy === user.id" @click="onReset(user)">
                    确认
                  </button>
                  <button type="button" class="btn btn-sm btn-ghost" @click="resetFor = null">取消</button>
                </template>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
