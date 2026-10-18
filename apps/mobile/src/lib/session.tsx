/**
 * Session state: device token (SecureStore), the signed-in user (`/auth/me`), the
 * patient file being viewed (self or a ward) and the optional clinician mode.
 * Medical data is never persisted; the React Query cache lives in memory only.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import { useQueryClient } from "@tanstack/react-query";

import { api, onUnauthorized, setAuthToken, setMembership, unwrap, type Schemas } from "./api";
import { deleteToken, readToken, writeToken } from "./token-store";

type Me = Schemas["Me"];
type MembershipBrief = Schemas["MembershipBrief"];

export type SessionStatus = "loading" | "signedOut" | "signedIn";
export type Mode = "patient" | "clinician";

interface SessionValue {
  status: SessionStatus;
  me: Me | null;
  /** Patient file shown in patient mode (self or ward). */
  patientId: string | null;
  patientName: string | null;
  mode: Mode;
  membership: MembershipBrief | null;
  /** Memberships that may use clinician mode (physician role, active, verified practitioner). */
  clinicianMemberships: MembershipBrief[];
  login: (identifier: string, password: string, otp?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  selectPatient: (id: string) => void;
  enterClinicianMode: (membershipId: string) => void;
  exitClinicianMode: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

function deviceName(): string {
  const model = Device.modelName || Device.deviceName;
  const os = Platform.OS === "web" ? "web" : Platform.OS;
  return `HAYAT mobile (${os}${model ? ` · ${model}` : ""})`.slice(0, 100);
}

export function eligibleClinicianMemberships(me: Me | null): MembershipBrief[] {
  if (!me || me.practitioner?.verification_status !== "verified") return [];
  return me.memberships.filter(
    (m) => (m.roles ?? []).includes("physician") && (m.status ?? "active") === "active",
  );
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("patient");
  const [membershipId, setMembershipId] = useState<string | null>(null);

  const reset = useCallback(async () => {
    setAuthToken(null);
    setMembership(null);
    await deleteToken();
    queryClient.clear();
    setMe(null);
    setPatientId(null);
    setMode("patient");
    setMembershipId(null);
    setStatus("signedOut");
  }, [queryClient]);

  const applyMe = useCallback((user: Me) => {
    setMe(user);
    setPatientId((current) => {
      const ids = [user.patient?.id, ...user.wards.map((w) => w.id)].filter(Boolean) as string[];
      if (current && ids.includes(current)) return current;
      return ids[0] ?? null;
    });
  }, []);

  // Restore the session from SecureStore on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await readToken();
      if (!token) {
        if (!cancelled) setStatus("signedOut");
        return;
      }
      setAuthToken(token);
      try {
        const user = await unwrap(api.GET("/api/v1/auth/me"));
        if (cancelled) return;
        applyMe(user);
        setStatus("signedIn");
      } catch {
        if (!cancelled) await reset();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyMe, reset]);

  // Any 401 on an authenticated request: drop the token and go back to login.
  useEffect(() => {
    onUnauthorized(() => {
      void reset();
    });
    return () => onUnauthorized(null);
  }, [reset]);

  const login = useCallback(
    async (identifier: string, password: string, otp?: string) => {
      const result = await unwrap(
        api.POST("/api/v1/auth/token", {
          body: { identifier, password, otp: otp || undefined, device_name: deviceName() },
        }),
      );
      await writeToken(result.token);
      setAuthToken(result.token);
      queryClient.clear();
      applyMe(result.user);
      setMode("patient");
      setMembership(null);
      setMembershipId(null);
      setStatus("signedIn");
    },
    [applyMe, queryClient],
  );

  const logout = useCallback(async () => {
    try {
      // Revoke the token server-side; ignore network failures, the local copy goes anyway.
      setMembership(null);
      await api.POST("/api/v1/auth/logout");
    } catch {
      // offline: still forget the token locally
    }
    await reset();
  }, [reset]);

  const refreshMe = useCallback(async () => {
    const user = await unwrap(api.GET("/api/v1/auth/me"));
    applyMe(user);
  }, [applyMe]);

  const clinicianMemberships = useMemo(() => eligibleClinicianMemberships(me), [me]);

  const enterClinicianMode = useCallback(
    (id: string) => {
      if (!clinicianMemberships.some((m) => m.id === id)) return;
      setMembership(id);
      setMembershipId(id);
      setMode("clinician");
    },
    [clinicianMemberships],
  );

  const exitClinicianMode = useCallback(() => {
    setMembership(null);
    setMembershipId(null);
    setMode("patient");
  }, []);

  const patientName = useMemo(() => {
    if (!me || !patientId) return null;
    if (me.patient?.id === patientId) return me.patient.full_name;
    return me.wards.find((w) => w.id === patientId)?.full_name ?? null;
  }, [me, patientId]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      me,
      patientId,
      patientName,
      mode,
      membership: me?.memberships.find((m) => m.id === membershipId) ?? null,
      clinicianMemberships,
      login,
      logout,
      refreshMe,
      selectPatient: setPatientId,
      enterClinicianMode,
      exitClinicianMode,
    }),
    [status, me, patientId, patientName, mode, membershipId, clinicianMemberships, login, logout,
      refreshMe, enterClinicianMode, exitClinicianMode],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
