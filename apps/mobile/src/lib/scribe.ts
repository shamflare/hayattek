/**
 * HayatTek AI data hooks (clinician mode only). The server alone decides whether the
 * service is enabled and what it costs; the app never computes billing.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap, type Schemas } from "./api";
import { useSession } from "./session";

export type ScribeSession = Schemas["Session"];
export type ScribeMode = "conversation" | "dictation";
export interface ScribeSample { id: string; title: string; mode: ScribeMode; seconds: number }

function useScribeScope() {
  const { mode, membership } = useSession();
  return mode === "clinician" ? `c:${membership?.id}` : "p";
}

export function useScribeStatus() {
  const scope = useScribeScope();
  return useQuery({
    queryKey: [scope, "scribe", "status"],
    enabled: scope !== "p",
    retry: false,
    queryFn: () => unwrap(api.GET("/api/v1/scribe/status")),
  });
}

export function samplesOf(status: Schemas["ScribeStatus"] | undefined): ScribeSample[] {
  return ((status?.samples ?? []) as unknown as ScribeSample[]).filter((s) => s && typeof s.id === "string");
}

const BUSY = new Set(["uploaded", "processing"]);

export function useScribeSessions(encounterId: string | null | undefined) {
  const scope = useScribeScope();
  return useQuery({
    queryKey: [scope, "scribe", "sessions", encounterId],
    enabled: !!encounterId && scope !== "p",
    queryFn: () => unwrap(api.GET("/api/v1/scribe/sessions", { params: { query: { encounter: encounterId! } } })),
    refetchInterval: (q) => (q.state.data?.results.some((s) => BUSY.has(s.status)) ? 2000 : false),
  });
}

export function useScribeSession(id: string | null | undefined) {
  const scope = useScribeScope();
  return useQuery({
    queryKey: [scope, "scribe", "session", id],
    enabled: !!id && scope !== "p",
    queryFn: () => unwrap(api.GET("/api/v1/scribe/sessions/{id}", { params: { path: { id: id! } } })),
    refetchInterval: (q) => (q.state.data && BUSY.has(q.state.data.status) ? 2000 : false),
  });
}

export function useInvalidateScribe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("scribe") });
}
