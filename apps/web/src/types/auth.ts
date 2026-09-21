import type { UserRole } from "@appdock/shared";

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  role: UserRole | string;
  mustChangePassword: boolean;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
  message?: string | string[];
  statusCode?: number;
}
