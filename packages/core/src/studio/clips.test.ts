import { describe, expect, it } from "vitest";
import { encodeWav, loudestWindow, peaks } from "./clips.ts";

describe("encodeWav", () => {
  it("writes a 16-bit stereo RIFF file", async () => {
    const left = new Float32Array([0, 0.5, -1, 1]);
    const right = new Float32Array([0, -0.5, 1, -1]);
    const blob = encodeWav({ left, right, sampleRate: 48_000 });
    const view = new DataView(await blob.arrayBuffer());
    const text = (at: number) =>
      String.fromCharCode(
        ...Array.from({ length: 4 }, (_, index) => view.getUint8(at + index))
      );
    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint32(40, true)).toBe(16);
    expect(view.getInt16(44 + 4 * 2, true)).toBe(-32_768);
    expect(view.getInt16(44 + 4 * 3, true)).toBe(32_767);
  });
});

describe("peaks", () => {
  it("normalizes to the loudest bucket", () => {
    const channel = new Float32Array(400);
    channel.fill(0.25, 0, 200);
    channel.fill(0.5, 200);
    expect(peaks([channel], 2)).toEqual([0.5, 1]);
  });
});

describe("loudestWindow", () => {
  it("finds the loud stretch", () => {
    const rate = 1000;
    const left = new Float32Array(rate * 20);
    left.fill(0.9, rate * 12, rate * 16);
    const start = loudestWindow({ left, right: left, sampleRate: rate }, 4);
    expect(start).toBeGreaterThanOrEqual(11);
    expect(start).toBeLessThanOrEqual(12.5);
  });
});
