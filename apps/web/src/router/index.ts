import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from "vue-router";
import { bootstrapSession, session } from "@/auth/session";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "home",
    component: () => import("@/views/HomeView.vue"),
    meta: { public: true },
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
    name: "admin-dashboard",
    component: () => import("@/views/admin/DashboardView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/:pathMatch(.*)*",
    redirect: "/",
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

  return true;
});
