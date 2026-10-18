import { describe, expect, it } from "vitest";

import { canRun, isNetworkFailure, isOffline, netStatus } from "../offline";

describe("netStatus", () => {
  it("is offline when there is no connection", () => {
    expect(netStatus({ isConnected: false })).toBe("offline");
    expect(netStatus({ type: "NONE" })).toBe("offline");
  });
  it("is offline when connected but the internet is unreachable (captive Wi-Fi)", () => {
    expect(netStatus({ isConnected: true, isInternetReachable: false, type: "WIFI" })).toBe("offline");
  });
  it("is online when connected", () => {
    expect(netStatus({ isConnected: true, isInternetReachable: true, type: "WIFI" })).toBe("online");
    expect(netStatus({ isConnected: true, type: "UNKNOWN" })).toBe("online"); // web
  });
  it("is unknown before the first answer (never blocks the user)", () => {
    expect(netStatus(null)).toBe("unknown");
    expect(netStatus({})).toBe("unknown");
    expect(isOffline("unknown")).toBe(false);
  });
});

describe("canRun (offline gating of network actions)", () => {
  it("blocks every network action while offline", () => {
    expect(canRun("offline")).toBe(false);
    expect(canRun("offline", false)).toBe(false);
  });
  it("allows actions online or when the state is unknown", () => {
    expect(canRun("online")).toBe(true);
    expect(canRun("unknown")).toBe(true);
  });
  it("honours extra blockers (busy, empty input)", () => {
    expect(canRun("online", true)).toBe(false);
    expect(canRun("online", false, null, undefined)).toBe(true);
    expect(canRun("online", false, true)).toBe(false);
  });
});

describe("isNetworkFailure", () => {
  it("recognises fetch/XHR network errors", () => {
    expect(isNetworkFailure(new TypeError("Network request failed"))).toBe(true);
    expect(isNetworkFailure({ code: "network" })).toBe(true);
  });
  it("does not treat server answers as network failures", () => {
    expect(isNetworkFailure(Object.assign(new Error("bad"), { status: 400, code: "invalid_audio" }))).toBe(false);
  });
});
