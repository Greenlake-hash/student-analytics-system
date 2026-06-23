/**
 * Core API client.
 *
 * Mirrors the backend's two auth modes (backend/app/core/security.py):
 * dev mode sends X-Dev-User-Email; real mode sends a Firebase ID token as
 * a Bearer header. Which mode is active is controlled by VITE_FIREBASE_ENABLED
 * (see .env.example) -- same pattern as the backend's FIREBASE_ENABLED flag,
 * kept in sync deliberately so flipping one without the other is an
 * immediately visible mismatch (the dev header gets ignored by a backend
 * with firebase_enabled=true, and vice versa) rather than a silent failure.
 *
 * All requests go through /api, which vite.config.ts proxies to the
 * FastAPI backend in dev. In production this should be set to the real
 * backend origin via VITE_API_BASE_URL.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";
const FIREBASE_ENABLED = import.meta.env.VITE_FIREBASE_ENABLED === "true";

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
    this.name = "ApiError";
  }
}

/** Swapped out by AuthProvider once a Firebase session exists; dev mode never calls this. */
let getFirebaseToken: (() => Promise<string | null>) | null = null;
export function registerFirebaseTokenProvider(fn: () => Promise<string | null>) {
  getFirebaseToken = fn;
}

/** Dev-mode identity, persisted in localStorage so a page refresh doesn't sign you out (see AuthProvider). */
const DEV_USER_STORAGE_KEY = "spad-dev-user-email";

export function getDevUserEmail(): string | null {
  return localStorage.getItem(DEV_USER_STORAGE_KEY);
}

export function setDevUserEmail(email: string | null) {
  if (email) localStorage.setItem(DEV_USER_STORAGE_KEY, email);
  else localStorage.removeItem(DEV_USER_STORAGE_KEY);
}

async function buildAuthHeaders(): Promise<Record<string, string>> {
  if (FIREBASE_ENABLED) {
    const token = getFirebaseToken ? await getFirebaseToken() : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
  const email = getDevUserEmail();
  return email ? { "X-Dev-User-Email": email } : {};
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const authHeaders = await buildAuthHeaders();

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const errorBody = await response.json();
      detail = errorBody.detail ?? detail;
    } catch {
      // response wasn't JSON -- fall back to statusText, already set above
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: "DELETE" }),
};

export const isFirebaseEnabled = FIREBASE_ENABLED;
