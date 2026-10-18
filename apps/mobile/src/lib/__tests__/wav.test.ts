import { describe, expect, it } from "vitest";

import { buildMultipartBody, downmixInt16, encodeWav, floatToInt16, LinearResampler, peakLevel, readWavInfo } from "../wav";

describe("encodeWav", () => {
  it("writes a PCM16 mono 16 kHz header the server accepts", () => {
    const second = new Int16Array(16000).fill(1000);
    const wav = encodeWav([second, second.subarray(0, 8000)]);
    const info = readWavInfo(wav)!;
    expect(info).toMatchObject({ format: 1, channels: 1, sampleRate: 16000, bitsPerSample: 16, dataBytes: 48000 });
    expect(info.seconds).toBe(1.5); // the server bills from exactly this computation
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(new DataView(wav.buffer).getInt16(44, true)).toBe(1000);
  });
  it("an empty recording is a valid but zero-length file", () => {
    expect(readWavInfo(encodeWav([]))!.seconds).toBe(0);
  });
  it("rejects non-WAV bytes", () => {
    expect(readWavInfo(new Uint8Array(100))).toBeNull();
  });
});

describe("PCM conversion", () => {
  it("clamps float samples into int16", () => {
    expect(Array.from(floatToInt16(new Float32Array([0, 1, -1, 2, -2, 0.5])))).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
  });
  it("down-mixes interleaved stereo", () => {
    expect(Array.from(downmixInt16(new Int16Array([100, 300, -50, 50]), 2))).toEqual([200, 0]);
    const mono = new Int16Array([1, 2, 3]);
    expect(downmixInt16(mono, 1)).toBe(mono);
  });
  it("peak level is normalised", () => {
    expect(peakLevel(new Int16Array([0, -16384]))).toBe(0);
    expect(peakLevel(new Int16Array(64).fill(-16384))).toBe(0.5);
  });
});

describe("LinearResampler", () => {
  it("48 kHz -> 16 kHz keeps the duration across chunk boundaries", () => {
    const r = new LinearResampler(48000, 16000);
    let out = 0;
    for (let i = 0; i < 10; i++) out += r.push(new Int16Array(4800).fill(500)).length; // 1 s in 10 chunks
    expect(Math.abs(out - 16000)).toBeLessThanOrEqual(1);
  });
  it("44.1 kHz -> 16 kHz with odd chunk sizes", () => {
    const r = new LinearResampler(44100, 16000);
    let out = 0;
    let left = 44100 * 2;
    const sizes = [1, 1023, 4096, 777, 2048];
    for (let i = 0; left > 0; i++) {
      const n = Math.min(left, sizes[i % sizes.length]);
      out += r.push(new Int16Array(n)).length;
      left -= n;
    }
    expect(Math.abs(out - 32000)).toBeLessThanOrEqual(2);
  });
  it("interpolates a ramp without clicks at the boundary", () => {
    const r = new LinearResampler(32000, 16000);
    const a = r.push(Int16Array.from([0, 10, 20, 30]));
    const b = r.push(Int16Array.from([40, 50, 60, 70]));
    expect([...a, ...b]).toEqual([0, 20, 40, 60]);
  });
  it("is a no-op when the rate already matches", () => {
    const chunk = new Int16Array([1, 2, 3]);
    expect(new LinearResampler(16000, 16000).push(chunk)).toBe(chunk);
  });
});

describe("buildMultipartBody", () => {
  it("wraps the file in a single multipart field named `file`", () => {
    const data = Uint8Array.from([0, 255, 13, 10]);
    const body = buildMultipartBody("BOUND", "file", "recording.wav", "audio/wav", data);
    const text = Array.from(body, (b) => String.fromCharCode(b)).join("");
    expect(text.startsWith('--BOUND\r\nContent-Disposition: form-data; name="file"; filename="recording.wav"\r\nContent-Type: audio/wav\r\n\r\n')).toBe(true);
    expect(text.endsWith("\r\n--BOUND--\r\n")).toBe(true);
    const start = body.length - data.length - "\r\n--BOUND--\r\n".length;
    expect(Array.from(body.subarray(start, start + 4))).toEqual([0, 255, 13, 10]);
  });
});
