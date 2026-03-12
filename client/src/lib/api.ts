import { z } from "zod";

function resolveApiBase(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "");
  if (configured) return configured;

  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8787`;
  }

  return "http://localhost:8787";
}

const base = resolveApiBase();

let csrfToken = "";

export function setCsrfToken(token: string): void {
  csrfToken = token || "";
}

export async function ensureCsrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const res = await fetch(`${base}/api/auth/csrf`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to get CSRF token");
  const data = await res.json();
  csrfToken = data.csrfToken;
  return csrfToken;
}

async function request<T>(path: string, init?: RequestInit, allowRetry = true): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (init?.method && !["GET", "HEAD", "OPTIONS"].includes(init.method.toUpperCase())) {
    const token = await ensureCsrf();
    headers.set("x-csrf-token", token);
  }
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${base}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text();
    if (allowRetry && res.status === 403 && text.includes("Invalid CSRF token")) {
      csrfToken = "";
      return request<T>(path, init, false);
    }
    throw new Error(text || `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request(path);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request(path, { method: "POST", body: JSON.stringify(body) });
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request(path, { method: "PUT", body: JSON.stringify(body) });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request(path, { method: "DELETE" });
}

export const agentInputSchema = z.object({
  name: z.string().min(2),
  description: z.string().min(2),
  prompt: z.string().min(8),
  tags: z.array(z.string()).default([]),
  type: z.enum(["SUPERVISOR", "SPECIALIST", "TICKET"]),
  isGlobal: z.boolean(),
  visibility: z.enum(["private", "shared"]),
  teamId: z.string().nullable(),
});
