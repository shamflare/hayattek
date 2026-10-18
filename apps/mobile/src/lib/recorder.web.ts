/**
 * Web (Expo web preview) WAV recorder: WebAudio capture -> 16 kHz mono PCM16 WAV in memory.
 * Same interface as the native `recorder.ts` (expo-audio's AudioStream is native-only).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { encodeWav, floatToInt16, LinearResampler, peakLevel, TARGET_RATE } from "./wav";

export type RecState = "idle" | "recording" | "paused";
export type MicPermission = "granted" | "denied" | "blocked" | "unavailable";

export interface WavRecorder {
  supported: boolean;
  state: RecState;
  seconds: number;
  level: number;
  autoPaused: boolean;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<Uint8Array>;
  cancel: () => void;
}

function supported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia &&
    typeof window.AudioContext !== "undefined";
}

export async function micPermission(request: boolean): Promise<MicPermission> {
  if (!supported()) return "unavailable";
  try {
    const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    if (status?.state === "granted") return "granted";
    if (status?.state === "denied") return "blocked";
  } catch {
    // Permissions API not available for microphone in this browser.
  }
  if (!request) return "denied";
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    return "granted";
  } catch {
    return "blocked";
  }
}

export function openMicSettings() {
  // Browsers manage site permissions from the address bar; nothing to open.
}

export function useWavRecorder(): WavRecorder {
  const chunks = useRef<Int16Array[]>([]);
  const samples = useRef(0);
  const lastLevel = useRef(0);
  const paused = useRef(false);
  const nodes = useRef<{ ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode; source: MediaStreamAudioSourceNode } | null>(null);
  const [state, setState] = useState<RecState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (state === "idle") return;
    const id = setInterval(() => {
      setSeconds(samples.current / TARGET_RATE);
      setLevel(state === "recording" ? lastLevel.current : 0);
    }, 300);
    return () => clearInterval(id);
  }, [state]);

  const release = useCallback(() => {
    const n = nodes.current;
    nodes.current = null;
    if (!n) return;
    n.node.disconnect();
    n.source.disconnect();
    n.stream.getTracks().forEach((t) => t.stop());
    void n.ctx.close().catch(() => {});
  }, []);

  useEffect(() => () => release(), [release]);

  const start = useCallback(async () => {
    chunks.current = [];
    samples.current = 0;
    paused.current = false;
    setSeconds(0);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: TARGET_RATE });
    } catch {
      ctx = new AudioContext();
    }
    const resampler = new LinearResampler(ctx.sampleRate, TARGET_RATE);
    const source = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => {
      if (paused.current) return;
      const out = resampler.push(floatToInt16(e.inputBuffer.getChannelData(0)));
      if (out.length) {
        chunks.current.push(out);
        samples.current += out.length;
        lastLevel.current = peakLevel(out);
      }
    };
    source.connect(node);
    node.connect(ctx.destination);
    nodes.current = { ctx, stream, node, source };
    setState("recording");
  }, []);

  const pause = useCallback(() => {
    paused.current = true;
    setSeconds(samples.current / TARGET_RATE);
    setState("paused");
  }, []);
  const resume = useCallback(() => {
    paused.current = false;
    setState("recording");
  }, []);

  const stop = useCallback(async () => {
    release();
    const wav = encodeWav(chunks.current, TARGET_RATE);
    chunks.current = [];
    setState("idle");
    return wav;
  }, [release]);

  const cancel = useCallback(() => {
    release();
    chunks.current = [];
    samples.current = 0;
    setSeconds(0);
    setState("idle");
  }, [release]);

  return { supported: supported(), state, seconds, level, autoPaused: false, start, pause, resume, stop, cancel };
}
