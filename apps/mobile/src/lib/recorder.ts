/**
 * Native (Android / iOS) WAV recorder for HayatTek AI.
 *
 * Why not `useAudioRecorder`? Its Android output formats are 3gp/mpeg4/amr/aac/webm only
 * (no WAV), and the server accepts WAV PCM only because it bills from the WAV header.
 * Instead we use expo-audio's `useAudioStream` (raw PCM buffers, int16, requested at
 * 16 kHz mono) and build the WAV ourselves in memory: identical output on Android and
 * iOS (LINEAR PCM 16 kHz mono 16-bit), nothing written to disk, and pause/resume simply
 * drops buffers while paused. If the hardware delivers another rate or stereo, buffers
 * are down-mixed and resampled to 16 kHz before encoding.
 *
 * The web build uses `recorder.web.ts` (WebAudio) with the same interface.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking } from "react-native";
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
  type AudioStreamBuffer,
} from "expo-audio";

import { downmixInt16, encodeWav, LinearResampler, peakLevel, TARGET_RATE } from "./wav";

export type RecState = "idle" | "recording" | "paused";
export type MicPermission = "granted" | "denied" | "blocked" | "unavailable";

export interface WavRecorder {
  supported: boolean;
  state: RecState;
  seconds: number;
  level: number;
  /** True when the app went to the background and recording was paused for safety. */
  autoPaused: boolean;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  /** Stops and returns the WAV bytes (16 kHz mono PCM16). */
  stop: () => Promise<Uint8Array>;
  cancel: () => void;
}

export async function micPermission(request: boolean): Promise<MicPermission> {
  try {
    const res = request ? await requestRecordingPermissionsAsync() : await getRecordingPermissionsAsync();
    if (res.granted) return "granted";
    return res.canAskAgain === false ? "blocked" : "denied";
  } catch {
    return "unavailable";
  }
}

export function openMicSettings() {
  void Linking.openSettings().catch(() => {});
}

export function useWavRecorder(): WavRecorder {
  const chunks = useRef<Int16Array[]>([]);
  const samples = useRef(0);
  const lastLevel = useRef(0);
  const resampler = useRef<LinearResampler | null>(null);
  const capturing = useRef(false);
  const paused = useRef(false);
  const [state, setState] = useState<RecState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [autoPaused, setAutoPaused] = useState(false);

  const onBuffer = useCallback((buf: AudioStreamBuffer) => {
    if (!capturing.current || paused.current) return;
    let pcm: Int16Array = new Int16Array(buf.data);
    if (buf.channels > 1) pcm = downmixInt16(pcm, buf.channels);
    if (!resampler.current || resampler.current.fromRate !== buf.sampleRate) {
      resampler.current = new LinearResampler(buf.sampleRate, TARGET_RATE);
    }
    const out = resampler.current.push(pcm);
    if (out.length) {
      chunks.current.push(out);
      samples.current += out.length;
      lastLevel.current = peakLevel(out);
    }
  }, []);

  const { stream } = useAudioStream({ sampleRate: TARGET_RATE, channels: 1, encoding: "int16", onBuffer });

  useEffect(() => {
    if (state === "idle") return;
    const id = setInterval(() => {
      setSeconds(samples.current / TARGET_RATE);
      setLevel(state === "recording" ? lastLevel.current : 0);
    }, 300);
    return () => clearInterval(id);
  }, [state]);

  // No hidden recording: leaving the app pauses capture (the doctor resumes explicitly).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active" && capturing.current && !paused.current) {
        paused.current = true;
        setAutoPaused(true);
        setState("paused");
      }
    });
    return () => sub.remove();
  }, []);

  const release = useCallback(() => {
    capturing.current = false;
    paused.current = false;
    try {
      stream?.stop();
    } catch {
      // already stopped
    }
    void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
  }, [stream]);

  useEffect(() => () => release(), [release]);

  const start = useCallback(async () => {
    chunks.current = [];
    samples.current = 0;
    resampler.current = null;
    setSeconds(0);
    setAutoPaused(false);
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    capturing.current = true;
    paused.current = false;
    try {
      await stream.start();
    } catch (e) {
      release();
      throw e;
    }
    setState("recording");
  }, [stream, release]);

  const pause = useCallback(() => {
    paused.current = true;
    setSeconds(samples.current / TARGET_RATE);
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    paused.current = false;
    setAutoPaused(false);
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

  return { supported: !!stream, state, seconds, level, autoPaused, start, pause, resume, stop, cancel };
}
