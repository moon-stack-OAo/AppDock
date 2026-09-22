import { apiRequest } from "./http";

export type AdminUser = {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  role: string;
  status: string;
  mustChangePassword: boolean;
  createdAt: string;
};

export type CreateUserBody = {
  username: string;
  email: string;
  displayName?: string;
  password: string;
  role?: string;
};

export type UpdateUserBody = {
  role?: string;
  status?: string;
  displayName?: string;
  email?: string;
  password?: string;
};

export function listUsers() {
  return apiRequest<AdminUser[]>("/admin/users");
}

export function createUser(body: CreateUserBody) {
  return apiRequest<AdminUser>("/admin/users", { method: "POST", body });
}

export function updateUser(id: string, body: UpdateUserBody) {
  return apiRequest<AdminUser>(`/admin/users/${id}`, { method: "PATCH", body });
}
