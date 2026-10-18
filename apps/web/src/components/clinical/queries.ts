"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

export function usePatient(id: string) {
  return useQuery({
    queryKey: ["patient", id],
    queryFn: () => unwrap(api.GET("/api/v1/patients/{id}", { params: { path: { id } } })),
  });
}

export function useSummary(id: string, enabled = true) {
  return useQuery({
    queryKey: ["summary", id],
    queryFn: () => unwrap(api.GET("/api/v1/clinical/summary", { params: { query: { patient: id } } })),
    enabled,
  });
}

export function useTimeline(id: string, types: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["timeline", id, types],
    queryFn: ({ pageParam }) =>
      unwrap(api.GET("/api/v1/clinical/timeline", {
        params: { query: { patient: id, ...(types ? { types } : {}), ...(pageParam ? { before: pageParam } : {}) } },
      })),
    initialPageParam: "" as string,
    getNextPageParam: (last) => last.next_before ?? undefined,
    enabled,
  });
}

/** Invalidate everything shown on a patient's chart after a change. */
export function useRefreshChart(patientId: string) {
  const qc = useQueryClient();
  return () => {
    for (const key of ["patient", "summary", "timeline", "encounters", "prescriptions"]) {
      qc.invalidateQueries({ queryKey: [key, patientId] });
    }
  };
}

const PRESENTED_KEY = "hayat.presented.";

/** The card token / number the patient physically presented in this browser session.
 *  Needed as proof of presence for in-person consent. Not medical data. */
export function rememberPresented(patientId: string, value: { card_token?: string; health_number?: string }) {
  try {
    sessionStorage.setItem(PRESENTED_KEY + patientId, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function readPresented(patientId: string): { card_token?: string; health_number?: string } | null {
  try {
    const raw = sessionStorage.getItem(PRESENTED_KEY + patientId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
