"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { getActiveMembership } from "@/lib/api";
import { homeForUser, useSession } from "@/lib/session";

export default function AppHome() {
  const { me } = useSession();
  const router = useRouter();
  React.useEffect(() => {
    if (me) router.replace(homeForUser(me, getActiveMembership()));
  }, [me, router]);
  return null;
}
