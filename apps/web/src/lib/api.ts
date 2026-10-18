"use client";

import { createHayatClient, MEMBERSHIP_HEADER, unwrap } from "@hayat/api-client";

export { isApiError, unwrap } from "@hayat/api-client";
export type { HayatApiError, Schemas } from "@hayat/api-client";

const MEMBERSHIP_KEY = "hayat.membership";

export function getActiveMembership(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(MEMBERSHIP_KEY);
  } catch {
    return null;
  }
}

export function setActiveMembership(id: string | null) {
  try {
    if (id) window.localStorage.setItem(MEMBERSHIP_KEY, id);
    else window.localStorage.removeItem(MEMBERSHIP_KEY);
  } catch {
    /* private mode: context is kept in memory only */
  }
  memoryMembership = id;
}

let memoryMembership: string | null = null;

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=")[1]) : undefined;
}

/** Same-origin client: session cookie + CSRF header + practice context header. */
export const api = createHayatClient({
  baseUrl: "",
  credentials: "same-origin",
  headers: () => ({
    "X-CSRFToken": readCookie("hayat_csrftoken"),
    [MEMBERSHIP_HEADER]: memoryMembership ?? getActiveMembership() ?? undefined,
  }),
});

/** Patient-portal requests must not carry a staff practice context. */
export const patientApi = createHayatClient({
  baseUrl: "",
  credentials: "same-origin",
  headers: () => ({ "X-CSRFToken": readCookie("hayat_csrftoken") }),
});

export async function ensureCsrf() {
  if (!readCookie("hayat_csrftoken")) await unwrap(api.GET("/api/v1/auth/csrf"));
}

/** Multipart upload (openapi-fetch focuses on JSON bodies). */
export async function uploadDocument(form: FormData, withContext = true) {
  const headers: Record<string, string> = {};
  const csrf = readCookie("hayat_csrftoken");
  if (csrf) headers["X-CSRFToken"] = csrf;
  const membership = withContext ? (memoryMembership ?? getActiveMembership()) : null;
  if (membership) headers[MEMBERSHIP_HEADER] = membership;
  const response = await fetch("/api/v1/documents", {
    method: "POST", body: form, headers, credentials: "same-origin",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body.message || "upload failed"), {
      status: response.status, code: body.code ?? "error", body,
    });
  }
  return body;
}

/** Authenticated file URL (download goes through the permission check + audit). */
export function documentUrl(id: string, download = false) {
  return `/api/v1/documents/${id}/download${download ? "?download=1" : ""}`;
}

export async function fetchDocumentBlob(id: string, withContext = true): Promise<string> {
  const headers: Record<string, string> = {};
  const membership = withContext ? (memoryMembership ?? getActiveMembership()) : null;
  if (membership) headers[MEMBERSHIP_HEADER] = membership;
  const response = await fetch(documentUrl(id), { headers, credentials: "same-origin" });
  if (!response.ok) throw new Error("download failed");
  return URL.createObjectURL(await response.blob());
}

export function errorMessage(e: unknown, fallback = "حدث خطأ غير متوقع. حاول مجدداً."): string {
  if (e && typeof e === "object" && "body" in e) {
    const body = (e as { body?: { message?: string; fields?: Record<string, unknown> } }).body;
    if (body?.fields) {
      const first = Object.values(body.fields)[0];
      const text = Array.isArray(first) ? first[0] : typeof first === "string" ? first : null;
      if (typeof text === "string") return text;
      if (first && typeof first === "object") {
        const nested = Object.values(first as Record<string, unknown>)[0];
        if (Array.isArray(nested) && typeof nested[0] === "string") return nested[0];
      }
    }
    if (body?.message) return body.message;
  }
  if (e instanceof TypeError) return "تعذر الاتصال بالخادم. تحقق من الإنترنت.";
  return fallback;
}
