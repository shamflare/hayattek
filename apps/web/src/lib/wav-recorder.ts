"use client";

/**
 * Microphone recorder producing 16 kHz mono PCM16 WAV.
 * WAV (not webm/opus) lets the server compute the exact duration it bills (docs/AI_SCRIBE.md).
 */
export class WavRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private paused = false;
  private sampleRate = 16000;
  onLevel?: (level: number) => void;

  static isSupported(): boolean {
    return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia &&
      typeof window.AudioContext !== "undefined";
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    try {
      this.ctx = new AudioContext({ sampleRate: 16000 });
    } catch {
      this.ctx = new AudioContext(); // browser refuses 16 kHz: resample on encode
    }
    this.sampleRate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => {
      if (this.paused) return;
      const data = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(data));
      if (this.onLevel) {
        let peak = 0;
        for (let i = 0; i < data.length; i += 64) peak = Math.max(peak, Math.abs(data[i]));
        this.onLevel(peak);
      }
    };
    this.source.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }

  get seconds(): number {
    return this.chunks.reduce((n, c) => n + c.length, 0) / this.sampleRate;
  }

  /** Stop the microphone and return the WAV bytes. */
  async stop(): Promise<Blob> {
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    const merged = mergeChunks(this.chunks);
    this.chunks = [];
    const samples = this.sampleRate === 16000 ? merged : resample(merged, this.sampleRate, 16000);
    return encodeWav(samples, 16000);
  }

  /** Abort without producing audio (e.g. the doctor cancels). */
  async cancel(): Promise<void> {
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    this.chunks = [];
  }
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function resample(input: Float32Array, from: number, to: number): Float32Array {
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) out[i] = input[Math.floor(i * ratio)];
  return out;
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
