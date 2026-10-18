/**
 * The single typed API client of the mobile app, built on the shared
 * `@hayat/api-client` package (OpenAPI-generated types).
 *
 * - Every request carries `Authorization: Token <raw>` when signed in (ADR-003).
 * - Patient/guardian requests carry NO `X-Hayat-Membership` header; the server treats
 *   them as the patient acting for themselves or a ward.
 * - Clinician mode adds `X-Hayat-Membership: <membership id>` (ADR-005).
 */
import { Platform } from "react-native";
import {
  MEMBERSHIP_HEADER,
  createHayatClient,
  isApiError,
  unwrap,
  type HayatApiError,
  type Schemas,
} from "@hayat/api-client";

import { ar } from "@/i18n/ar";

function defaultBaseUrl(): string {
  // The Android emulator reaches the host machine through 10.0.2.2.
  return Platform.OS === "android" ? "http://10.0.2.2:8100" : "http://127.0.0.1:8100";
}

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || defaultBaseUrl()).replace(/\/+$/, "");

/** Mutable auth context read by the client on every request. */
const auth: { token: string | null; membershipId: string | null } = {
  token: null,
  membershipId: null,
};
let unauthorizedListener: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  auth.token = token;
}
export function setMembership(membershipId: string | null) {
  auth.membershipId = membershipId;
}
export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Accept-Language": "ar" };
  if (auth.token) headers.Authorization = `Token ${auth.token}`;
  if (auth.membershipId) headers[MEMBERSHIP_HEADER] = auth.membershipId;
  return headers;
}
export function onUnauthorized(listener: (() => void) | null) {
  unauthorizedListener = listener;
}

export const api = createHayatClient({
  baseUrl: API_URL,
  headers: () => getAuthHeaders(),
  onUnauthorized: () => {
    // Only a signed-in session can expire; a 401 during login (e.g. mfa_required)
    // is handled by the login screen itself.
    if (auth.token) unauthorizedListener?.();
  },
});

export { unwrap, isApiError };
export type { HayatApiError, Schemas };

/** Arabic, user-safe message for any thrown error. */
export function errorMessage(e: unknown): string {
  if (isApiError(e)) {
    if (e.status === 401) return ar.errors.sessionExpired;
    if (e.status === 404) return ar.errors.notFound;
    const body = e.body ?? {};
    if (body.code === "validation_error" && body.fields && typeof body.fields === "object") {
      const first = Object.values(body.fields as Record<string, unknown>)[0];
      const text = Array.isArray(first) ? first[0] : first;
      if (typeof text === "string") return text;
    }
    return e.message || ar.errors.generic;
  }
  if (e instanceof TypeError) return ar.errors.network;
  return ar.errors.generic;
}
