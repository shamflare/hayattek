/**
 * Connectivity rules (pure, unit-tested in `src/lib/__tests__/offline.test.ts`).
 * The React side (expo-network listener + TanStack onlineManager) lives in `network.tsx`.
 */

export type NetStatus = "online" | "offline" | "unknown";

export interface NetworkLike {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
  type?: string | null;
}

/**
 * Map an expo-network state to a status. Only an explicit "no connection" or
 * "connected but internet unreachable" counts as offline; an unknown state never blocks
 * the user (e.g. the very first render before the native module answers).
 */
export function netStatus(state: NetworkLike | null | undefined): NetStatus {
  if (!state) return "unknown";
  if (state.isConnected === false) return "offline";
  if (state.type === "NONE") return "offline";
  if (state.isConnected === true && state.isInternetReachable === false) return "offline";
  if (state.isConnected === true) return "online";
  return "unknown";
}

export function isOffline(status: NetStatus): boolean {
  return status === "offline";
}

/**
 * Whether an action that needs the server may run now. Used to disable buttons:
 * `disabled={!canRun(status, busy)}`.
 */
export function canRun(status: NetStatus, ...blockers: (boolean | null | undefined)[]): boolean {
  return !isOffline(status) && !blockers.some(Boolean);
}

/** True for errors that mean "the request never reached the server" (retry later). */
export function isNetworkFailure(e: unknown): boolean {
  if (e instanceof TypeError) return true; // fetch: "Network request failed"
  if (e && typeof e === "object" && (e as { code?: string }).code === "network") return true;
  return false;
}
