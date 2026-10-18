"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";

import { api, getActiveMembership, type Schemas, setActiveMembership, unwrap } from "./api";

export type Me = Schemas["Me"];
export type MembershipBrief = Me["memberships"][number];

/** Where a staff membership lands by default. */
export function homeForMembership(membership: MembershipBrief): string {
  const roles = membership.roles as string[];
  if (roles.includes("physician") || roles.includes("receptionist") || roles.includes("nurse"))
    return "/app/clinic";
  if (roles.includes("lab_staff") || roles.includes("imaging_staff")) return "/app/lab";
  if (roles.includes("org_admin")) return "/app/org";
  return "/app/clinic";
}

export function homeForUser(me: Me, membershipId?: string | null): string {
  const membership = me.memberships.find((m) => m.id === membershipId) ?? me.memberships[0];
  if (membership) return homeForMembership(membership);
  if (me.is_platform_admin) return "/app/admin";
  return "/app/me";
}

interface SessionValue {
  me: Me | undefined;
  isLoading: boolean;
  /** True once the user and their practice context are both known. */
  ready: boolean;
  membership: MembershipBrief | null;
  roles: string[];
  has: (...roles: string[]) => boolean;
  isClinician: boolean;
  switchMembership: (id: string | null) => void;
  logout: () => Promise<void>;
  refresh: () => void;
}

const SessionContext = React.createContext<SessionValue | null>(null);

export function useMeQuery() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => unwrap(api.GET("/api/v1/auth/me")),
    retry: false,
    staleTime: 60_000,
  });
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const meQuery = useMeQuery();
  const me = meQuery.data;
  // undefined = not resolved yet. Pages render only after resolution so their very first
  // request already carries the right practice-context header.
  const [membershipId, setMembershipId] = React.useState<string | null | undefined>(undefined);

  React.useEffect(() => {
    if (!me) return;
    const stored = getActiveMembership();
    const valid = me.memberships.find((m) => m.id === stored);
    const chosen = valid?.id ?? me.memberships[0]?.id ?? null;
    setActiveMembership(chosen);
    setMembershipId(chosen);
  }, [me]);

  const membership = me?.memberships.find((m) => m.id === membershipId) ?? null;
  const roles = (membership?.roles as string[] | undefined) ?? [];
  const isClinician =
    roles.includes("physician") && me?.practitioner?.verification_status === "verified";

  const value: SessionValue = {
    me,
    isLoading: meQuery.isLoading,
    ready: Boolean(me) && membershipId !== undefined,
    membership,
    roles,
    has: (...wanted) => wanted.some((r) => roles.includes(r)),
    isClinician,
    switchMembership: (id) => {
      setActiveMembership(id);
      setMembershipId(id);
      // Data is scoped to the practice context: never reuse another context's cache.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      if (me) {
        const target = id ? me.memberships.find((m) => m.id === id) : null;
        router.push(target ? homeForMembership(target) : "/app/me");
      }
    },
    logout: async () => {
      try {
        await api.POST("/api/v1/auth/logout");
      } finally {
        setActiveMembership(null);
        queryClient.clear();
        router.replace("/login");
      }
    },
    refresh: () => meQuery.refetch(),
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = React.useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
