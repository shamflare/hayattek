/**
 * Connectivity for the whole app (expo-network).
 *
 * - `useNetStatus()` drives the offline banner and disables actions that need the server.
 * - TanStack Query's `onlineManager` follows the same signal, so while offline queries
 *   pause instead of failing and the last data already in the (in-memory) cache stays
 *   visible. Nothing is persisted to disk.
 */
import { useEffect } from "react";
import * as Network from "expo-network";
import { onlineManager } from "@tanstack/react-query";

import { canRun, netStatus, type NetStatus } from "./offline";

let wired = false;

/** Call once at startup: TanStack Query pauses/resumes with the device connectivity. */
export function wireOnlineManager() {
  if (wired) return;
  wired = true;
  onlineManager.setEventListener((setOnline) => {
    const apply = (state: Network.NetworkState) => {
      const status = netStatus(state);
      if (status !== "unknown") setOnline(status === "online");
    };
    Network.getNetworkStateAsync().then(apply).catch(() => {});
    const sub = Network.addNetworkStateListener(apply);
    return () => sub.remove();
  });
}

export function useNetStatus(): NetStatus {
  const state = Network.useNetworkState();
  const status = netStatus(state);
  useEffect(() => {
    // Keep TanStack in sync even if the listener above missed the first event.
    if (status !== "unknown") onlineManager.setOnline(status === "online");
  }, [status]);
  return status;
}

export function useIsOffline(): boolean {
  return useNetStatus() === "offline";
}

/** `const ok = useCanRun(); <Button disabled={!ok(busy)} />` */
export function useCanRun() {
  const status = useNetStatus();
  return (...blockers: (boolean | null | undefined)[]) => canRun(status, ...blockers);
}
