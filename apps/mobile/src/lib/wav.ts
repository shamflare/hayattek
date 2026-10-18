/**
 * PCM16 WAV building blocks (pure, unit-tested in `src/lib/__tests__/wav.test.ts`).
 *
 * The scribe API accepts WAV PCM only and computes the billed duration from the WAV
 * header on the server (docs/AI_SCRIBE.md). The recorders therefore collect raw PCM
 * buffers, normalise them to 16 kHz mono 16-bit and wrap them here. Everything stays in
 * memory: the recording is never written to the device's storage.
 */

export const TARGET_RATE = 16000;

/** Float32 samples in [-1, 1] -> little-endian signed 16-bit. */
export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Interleaved multi-channel PCM -> mono (average of the channels). */
export function downmixInt16(input: Int16Array, channels: number): Int16Array {
  if (channels <= 1) return input;
  const frames = Math.floor(input.length / channels);
  const out = new Int16Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += input[f * channels + c];
    out[f] = Math.round(sum / channels);
  }
  return out;
}

/**
 * Streaming linear-interpolation resampler. Keeps the fractional read position and the
 * last sample between chunks so chunk boundaries do not click or drift.
 */
export class LinearResampler {
  private pos = 0; // read position relative to the start of the pending chunk
  private last: number | null = null;

  constructor(readonly fromRate: number, readonly toRate: number = TARGET_RATE) {}

  push(chunk: Int16Array): Int16Array {
    if (this.fromRate === this.toRate) return chunk;
    if (chunk.length === 0) return chunk;
    const step = this.fromRate / this.toRate;
    // Virtual input = [last, ...chunk]; index 0 is the previous chunk's last sample.
    const offset = this.last === null ? 0 : 1;
    const at = (i: number) => (i < offset ? (this.last as number) : chunk[i - offset]);
    const total = chunk.length + offset;
    const out: number[] = [];
    let pos = this.pos;
    // Interpolate between v[i] and v[i+1]; a position landing exactly on the chunk's
    // last sample is emitted with the next chunk (where that sample is index 0).
    while (pos < total - 1) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const a = at(i);
      const b = at(i + 1);
      out.push(Math.round(a + (b - a) * frac));
      pos += step;
    }
    // Next chunk starts after the current chunk's last sample (which becomes index 0).
    this.pos = pos - (total - 1);
    this.last = chunk[chunk.length - 1];
    return Int16Array.from(out);
  }
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** Concatenate mono PCM16 chunks into a canonical 44-byte-header WAV file. */
export function encodeWav(chunks: Int16Array[], sampleRate: number = TARGET_RATE): Uint8Array {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const dataBytes = samples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++, offset += 2) view.setInt16(offset, chunk[i], true);
  }
  return new Uint8Array(buffer);
}

export interface WavInfo { channels: number; sampleRate: number; bitsPerSample: number; format: number; dataBytes: number; seconds: number }

/** Minimal reader mirroring the server's validation (backend/apps/scribe/audio.py). */
export function readWavInfo(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let pos = 12;
  let fmt: Omit<WavInfo, "dataBytes" | "seconds"> | null = null;
  while (pos + 8 <= bytes.length) {
    const id = tag(pos);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === "fmt ") {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data" && fmt) {
      const dataBytes = Math.min(size, bytes.length - body);
      const bps = (fmt.sampleRate * fmt.channels * fmt.bitsPerSample) / 8;
      return { ...fmt, dataBytes, seconds: bps ? dataBytes / bps : 0 };
    }
    pos = body + size + (size % 2);
  }
  return null;
}

/**
 * multipart/form-data body with a single file field, built in memory so React Native's
 * XMLHttpRequest can send it as binary (no temporary file on disk).
 */
export function buildMultipartBody(
  boundary: string,
  field: string,
  filename: string,
  contentType: string,
  data: Uint8Array,
): Uint8Array {
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const out = new Uint8Array(head.length + data.length + tail.length);
  for (let i = 0; i < head.length; i++) out[i] = head.charCodeAt(i) & 0xff;
  out.set(data, head.length);
  const t0 = head.length + data.length;
  for (let i = 0; i < tail.length; i++) out[t0 + i] = tail.charCodeAt(i) & 0xff;
  return out;
}

/** Peak level of a PCM16 chunk in [0, 1] for the live level meter. */
export function peakLevel(chunk: Int16Array): number {
  let peak = 0;
  for (let i = 0; i < chunk.length; i += 32) {
    const v = Math.abs(chunk[i]);
    if (v > peak) peak = v;
  }
  return peak / 0x8000;
}
