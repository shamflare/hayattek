/**
 * Typed HAYAT API client shared by the web and mobile apps.
 * Types are generated from the Django OpenAPI schema: `pnpm gen:api`.
 */
import createClient, { type Middleware } from "openapi-fetch";

import type { components, paths } from "./schema";

export type { components, paths };
export type Schemas = components["schemas"];

export interface ApiError {
  code: string;
  message: string;
  fields?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ClientOptions {
  baseUrl: string;
  /** Returns extra headers per request (CSRF token, device token, membership). */
  headers?: () => Record<string, string | undefined> | Promise<Record<string, string | undefined>>;
  credentials?: RequestCredentials;
  onUnauthorized?: () => void;
}

export function createHayatClient(options: ClientOptions) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    credentials: options.credentials,
  });
  const middleware: Middleware = {
    async onRequest({ request }) {
      const extra = (await options.headers?.()) ?? {};
      for (const [key, value] of Object.entries(extra)) {
        if (value) request.headers.set(key, value);
      }
      return request;
    },
    async onResponse({ response }) {
      if (response.status === 401) options.onUnauthorized?.();
      return response;
    },
  };
  client.use(middleware);
  return client;
}

export type HayatClient = ReturnType<typeof createHayatClient>;

export const MEMBERSHIP_HEADER = "X-Hayat-Membership";

/** Unwrap an openapi-fetch result or throw a typed ApiError. */
export async function unwrap<T>(
  promise: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await promise;
  if (error !== undefined || !response.ok) {
    const body = (error ?? {}) as Partial<ApiError>;
    throw Object.assign(new Error(body.message || `HTTP ${response.status}`), {
      status: response.status,
      code: body.code ?? "error",
      body,
    });
  }
  return data as T;
}

export interface HayatApiError extends Error {
  status: number;
  code: string;
  body: Partial<ApiError> & Record<string, unknown>;
}

export function isApiError(e: unknown): e is HayatApiError {
  return e instanceof Error && "status" in e && "code" in e;
}
