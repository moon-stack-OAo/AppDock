import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from "vue-router";
import { bootstrapSession, session } from "@/auth/session";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    component: () => import("@/layouts/PublicLayout.vue"),
    meta: { public: true },
    children: [
      {
        path: "",
        name: "home",
        component: () => import("@/views/HomeView.vue"),
        meta: { public: true },
      },
      {
        path: "a/:slug",
        name: "public-app",
        component: () => import("@/views/public/AppPageView.vue"),
        meta: { public: true },
      },
      {
        path: "a/:slug/v/:tag",
        name: "public-version",
        component: () => import("@/views/public/AppPageView.vue"),
        meta: { public: true },
      },
      {
        path: "docs/update-check",
        name: "update-check-docs",
        component: () => import("@/views/public/UpdateCheckDocView.vue"),
        meta: { public: true },
      },
      {
        path: ":pathMatch(.*)*",
        name: "not-found",
        component: () => import("@/views/public/NotFoundView.vue"),
        meta: { public: true },
      },
    ],
  },
  {
    path: "/admin/login",
    name: "admin-login",
    component: () => import("@/views/admin/LoginView.vue"),
    meta: { public: true, guestOnly: true },
  },
  {
    path: "/admin/change-password",
    name: "admin-change-password",
    component: () => import("@/views/admin/ChangePasswordView.vue"),
    meta: { requiresAuth: true, allowMustChange: true },
  },
  {
    path: "/admin",
    component: () => import("@/layouts/AdminLayout.vue"),
    meta: { requiresAuth: true },
    children: [
      {
        path: "",
        name: "admin-dashboard",
        component: () => import("@/views/admin/DashboardView.vue"),
      },
      {
        path: "apps",
        name: "admin-apps",
        component: () => import("@/views/admin/AppsListView.vue"),
      },
      {
        path: "apps/new",
        name: "admin-app-new",
        component: () => import("@/views/admin/AppFormView.vue"),
        meta: { adminOnly: true },
      },
      {
        path: "apps/:id",
        name: "admin-app-detail",
        component: () => import("@/views/admin/AppDetailView.vue"),
      },
      {
        path: "apps/:id/edit",
        name: "admin-app-edit",
        component: () => import("@/views/admin/AppFormView.vue"),
        meta: { adminOnly: true },
      },
      {
        path: "users",
        name: "admin-users",
        component: () => import("@/views/admin/UsersView.vue"),
        meta: { adminOnly: true },
      },
      {
        path: "access-codes",
        name: "admin-access-codes",
        component: () => import("@/views/admin/AccessCodesView.vue"),
        meta: { adminOnly: true },
      },
      {
        path: "jobs",
        name: "admin-jobs",
        component: () => import("@/views/admin/JobsView.vue"),
      },
      {
        path: "settings",
        name: "admin-settings",
        component: () => import("@/views/admin/SettingsView.vue"),
        meta: { adminOnly: true },
      },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  bootstrapSession();

  const authed = Boolean(session.accessToken && session.user);
  const mustChange = Boolean(session.user?.mustChangePassword);

  if (to.meta.guestOnly && authed) {
    if (mustChange) {
      return { name: "admin-change-password" };
    }
    return { name: "admin-dashboard" };
  }

  if (to.meta.requiresAuth && !authed) {
    return {
      name: "admin-login",
      query: { redirect: to.fullPath },
    };
  }

  if (authed && mustChange && !to.meta.allowMustChange && !to.meta.public) {
    return { name: "admin-change-password" };
  }

  if (
    authed &&
    !mustChange &&
    to.name === "admin-change-password"
  ) {
    return { name: "admin-dashboard" };
  }

  if (to.meta.adminOnly && session.user?.role !== "admin") {
    if (to.name === "admin-app-new" || to.name === "admin-app-edit") {
      return { name: "admin-apps" };
    }
    return { name: "admin-dashboard" };
  }

  return true;
});
