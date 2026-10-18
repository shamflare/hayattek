/**
 * In-memory state for the clinician flow: the patient identified by the last card scan
 * (or health number). Never persisted.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { api, unwrap, type Schemas } from "./api";

/** POST /patients/identify — audited server-side as `card.resolve` / `patient.view`. */
export async function identify(identifier: IdentifiedState["identifier"]) {
  return unwrap(api.POST("/api/v1/patients/identify", { body: identifier }));
}

export interface IdentifiedState {
  /** How the patient was identified; re-used for in-person consent. */
  identifier: { card_token: string } | { health_number: string };
  result: Schemas["IdentifiedPatient"];
}

interface ClinicianValue {
  current: IdentifiedState | null;
  setCurrent: (s: IdentifiedState | null) => void;
}

const Ctx = createContext<ClinicianValue | null>(null);

export function ClinicianProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<IdentifiedState | null>(null);
  const value = useMemo(() => ({ current, setCurrent }), [current]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useClinician(): ClinicianValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useClinician must be used inside ClinicianProvider");
  return ctx;
}
