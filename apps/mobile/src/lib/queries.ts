/**
 * Data hooks. Query keys always include the mode (patient / clinician membership) so
 * patient-mode and clinician-mode responses never mix. The cache is in-memory only.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap, type Schemas } from "./api";
import { useSession } from "./session";

export type RecordType = "encounter" | "prescription" | "lab_report" | "imaging_report" | "document";
export const DETAIL_TYPES: RecordType[] = ["encounter", "prescription", "lab_report", "imaging_report", "document"];

function useScope() {
  const { mode, membership } = useSession();
  return mode === "clinician" ? `c:${membership?.id}` : "p";
}

/* ---------------------------------------------------------------- patient */

export function useCard(patientId: string | null) {
  const scope = useScope();
  return useQuery({
    queryKey: [scope, "card", patientId],
    enabled: !!patientId,
    queryFn: () => unwrap(api.GET("/api/v1/me/patients/{id}/card", { params: { path: { id: patientId! } } })),
  });
}

export function useReportCardLost(patientId: string | null) {
  const qc = useQueryClient();
  const scope = useScope();
  return useMutation({
    mutationFn: (reason: string) =>
      unwrap(api.POST("/api/v1/me/patients/{id}/card/replace", { params: { path: { id: patientId! } }, body: { reason } })),
    onSuccess: (card) => qc.setQueryData([scope, "card", patientId], card),
  });
}

export function useTimeline(patientId: string | null) {
  const scope = useScope();
  return useInfiniteQuery({
    queryKey: [scope, "timeline", patientId],
    enabled: !!patientId,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/clinical/timeline", {
          params: { query: { patient: patientId!, before: pageParam ?? undefined } },
        }),
      ),
    getNextPageParam: (last) => last.next_before ?? undefined,
  });
}

function pageFromUrl(next: string | null | undefined): number | undefined {
  if (!next) return undefined;
  const m = next.match(/[?&]page=(\d+)/);
  return m ? Number(m[1]) : undefined;
}

export function usePrescriptions(patientId: string | null) {
  const scope = useScope();
  return useInfiniteQuery({
    queryKey: [scope, "prescriptions", patientId],
    enabled: !!patientId,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      unwrap(api.GET("/api/v1/prescriptions", { params: { query: { patient: patientId!, page: pageParam, page_size: 20 } } })),
    getNextPageParam: (last) => pageFromUrl(last.next),
  });
}

export function useLabReports(patientId: string | null) {
  const scope = useScope();
  return useInfiniteQuery({
    queryKey: [scope, "labs", patientId],
    enabled: !!patientId,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      unwrap(api.GET("/api/v1/diagnostics/lab-reports", { params: { query: { patient: patientId!, page: pageParam, page_size: 20 } } })),
    getNextPageParam: (last) => pageFromUrl(last.next),
  });
}

export function useDocuments(patientId: string | null) {
  const scope = useScope();
  return useInfiniteQuery({
    queryKey: [scope, "documents", patientId],
    enabled: !!patientId,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      unwrap(api.GET("/api/v1/documents", { params: { query: { patient: patientId!, page: pageParam, page_size: 20 } } })),
    getNextPageParam: (last) => pageFromUrl(last.next),
  });
}

export type AnyRecord =
  | { type: "encounter"; data: Schemas["Encounter"] }
  | { type: "prescription"; data: Schemas["Prescription"] }
  | { type: "lab_report"; data: Schemas["LabReport"] }
  | { type: "imaging_report"; data: Schemas["ImagingReport"] }
  | { type: "document"; data: Schemas["Document"] };

export function useRecord(type: string, id: string) {
  const scope = useScope();
  return useQuery({
    queryKey: [scope, "record", type, id],
    enabled: DETAIL_TYPES.includes(type as RecordType) && !!id,
    queryFn: async (): Promise<AnyRecord> => {
      const path = { params: { path: { id } } };
      switch (type as RecordType) {
        case "encounter":
          return { type: "encounter", data: await unwrap(api.GET("/api/v1/clinical/encounters/{id}", path)) };
        case "prescription":
          return { type: "prescription", data: await unwrap(api.GET("/api/v1/prescriptions/{id}", path)) };
        case "lab_report":
          return { type: "lab_report", data: await unwrap(api.GET("/api/v1/diagnostics/lab-reports/{id}", path)) };
        case "imaging_report":
          return { type: "imaging_report", data: await unwrap(api.GET("/api/v1/diagnostics/imaging-reports/{id}", path)) };
        default:
          return { type: "document", data: await unwrap(api.GET("/api/v1/documents/{id}", path)) };
      }
    },
  });
}

/* ---------------------------------------------------------------- sharing */

/**
 * Accepts both a paginated envelope and a bare array. The OpenAPI schema declares
 * `/me/sharing/requests` as paginated but the server currently answers with a plain list.
 */
function listOf<T>(data: { results: T[] } | T[] | null | undefined): T[] {
  if (Array.isArray(data)) return data;
  return data?.results ?? [];
}

export function useAccessRequests() {
  const scope = useScope();
  return useQuery({
    queryKey: [scope, "sharing", "requests"],
    queryFn: async () =>
      listOf<Schemas["AccessRequest"]>(
        await unwrap(api.GET("/api/v1/me/sharing/requests", { params: { query: { page_size: 50 } } })),
      ),
  });
}

export function useGrants() {
  const scope = useScope();
  return useQuery({
    queryKey: [scope, "sharing", "grants"],
    queryFn: () => unwrap(api.GET("/api/v1/me/sharing/grants", { params: { query: { page_size: 50 } } })),
  });
}

export function useAccessLog(patientId: string | null) {
  const scope = useScope();
  return useQuery({
    queryKey: [scope, "sharing", "log", patientId],
    enabled: !!patientId,
    queryFn: () => unwrap(api.GET("/api/v1/me/sharing/access-log", { params: { query: { patient: patientId!, page_size: 30 } } })),
  });
}

export function useDecideRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; approve: boolean; scopes?: Schemas["ScopesEnum"][] }) =>
      unwrap(
        api.POST("/api/v1/me/sharing/requests/{request_id}/decide", {
          params: { path: { request_id: v.id } },
          body: { approve: v.approve, scopes: v.approve ? v.scopes : undefined },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["p", "sharing"] }),
  });
}

export function useRevokeGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) =>
      unwrap(api.POST("/api/v1/me/sharing/grants/{grant_id}/revoke", { params: { path: { grant_id: grantId } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["p", "sharing"] }),
  });
}

/* ---------------------------------------------------------------- notifications */

export function useNotifications() {
  const scope = useScope();
  return useInfiniteQuery({
    queryKey: [scope, "notifications"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => unwrap(api.GET("/api/v1/notifications", { params: { query: { page: pageParam, page_size: 20 } } })),
    getNextPageParam: (last) => pageFromUrl(last.next),
  });
}

export function useUnreadCount() {
  const scope = useScope();
  return useQuery({
    queryKey: [scope, "notifications", "unread"],
    queryFn: () => unwrap(api.GET("/api/v1/notifications/unread-count")),
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | "all") =>
      id === "all"
        ? unwrap(api.POST("/api/v1/notifications/mark-all-read"))
        : unwrap(api.POST("/api/v1/notifications/{id}/read", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("notifications") }),
  });
}
