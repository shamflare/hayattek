"use client";

import * as React from "react";

import { useSession } from "@/lib/session";

export interface PortalPatient {
  id: string;
  full_name: string;
  health_number: string;
  /** true for the user's own file, false for a ward (child, elderly parent…). */
  isOwn: boolean;
}

interface ActivePatientValue {
  /** Own file first, then wards. */
  patients: PortalPatient[];
  active: PortalPatient | null;
  setActive: (id: string) => void;
}

// Only an id is stored (never medical data), and only for this browser tab.
const STORAGE_KEY = "hayat.portal.patient";

const ActivePatientContext = React.createContext<ActivePatientValue | null>(null);

function readStored(): string | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function ActivePatientProvider({ children }: { children: React.ReactNode }) {
  const { me } = useSession();
  const [chosen, setChosen] = React.useState<string | null>(readStored);

  const patients = React.useMemo<PortalPatient[]>(() => {
    if (!me) return [];
    const list: PortalPatient[] = [];
    if (me.patient) list.push({ ...me.patient, isOwn: true });
    for (const ward of me.wards) {
      if (!list.some((p) => p.id === ward.id)) list.push({ ...ward, isOwn: false });
    }
    return list;
  }, [me]);

  const active = patients.find((p) => p.id === chosen) ?? patients[0] ?? null;

  const setActive = React.useCallback((id: string) => {
    setChosen(id);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* private mode: the choice lasts until reload */
    }
  }, []);

  const value = React.useMemo(() => ({ patients, active, setActive }), [patients, active, setActive]);
  return <ActivePatientContext.Provider value={value}>{children}</ActivePatientContext.Provider>;
}

export function useActivePatient(): ActivePatientValue {
  const value = React.useContext(ActivePatientContext);
  if (!value) throw new Error("useActivePatient must be used inside ActivePatientProvider");
  return value;
}

/** For pages rendered under /app/me/layout.tsx, which guarantees a patient exists. */
export function useActivePatientId(): string {
  const { active } = useActivePatient();
  return active?.id ?? "";
}
