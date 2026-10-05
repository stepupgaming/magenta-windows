import { describe, expect, it } from "vitest";
import { blendScenes, ease, sceneName } from "./scenes.ts";
import type { Scene, StylePrompt } from "./types.ts";

function prompt(
  id: string,
  weight: number,
  values: Partial<StylePrompt> = {}
): StylePrompt {
  return {
    color: "#ffffff",
    id,
    kind: "text",
    muted: false,
    solo: false,
    text: id,
    weight,
    x: 0.2,
    y: 0.2,
    ...values,
  };
}

function scene(prompts: StylePrompt[], values: Partial<Scene> = {}): Scene {
  return {
    drums: "auto",
    drumStrength: 1,
    listener: { x: 0.5, y: 0.5 },
    mixMode: "list",
    name: "scene",
    noteStrength: 1,
    prompts,
    styleStrength: 2,
    temperature: 1,
    ...values,
  };
}

describe("blendScenes", () => {
  const from = scene([prompt("shared", 1), prompt("leaving", 0.8)], {
    temperature: 1,
  });
  const to = scene(
    [prompt("shared", 0.2, { x: 0.8 }), prompt("arriving", 0.6)],
    {
      drums: "off",
      temperature: 2,
    }
  );

  it("glides shared prompts and knobs", () => {
    const half = blendScenes(from, to, 0.5);
    const shared = half.prompts.find((item) => item.id === "shared");
    expect(shared?.weight).toBeCloseTo(0.6);
    expect(shared?.x).toBeCloseTo(0.5);
    expect(half.temperature).toBeCloseTo(1.5);
  });

  it("fades prompts in and out", () => {
    const quarter = blendScenes(from, to, 0.25);
    expect(
      quarter.prompts.find((item) => item.id === "leaving")?.weight
    ).toBeCloseTo(0.6);
    expect(
      quarter.prompts.find((item) => item.id === "arriving")?.weight
    ).toBeCloseTo(0.15);
  });

  it("switches discrete settings halfway", () => {
    expect(blendScenes(from, to, 0.4).drums).toBe("auto");
    expect(blendScenes(from, to, 0.6).drums).toBe("off");
  });

  it("lands exactly on the target, muted prompts included", () => {
    const target = scene([prompt("a", 0.5, { muted: true })]);
    const landed = blendScenes(from, target, 1);
    expect(landed.prompts).toEqual(target.prompts);
    expect("name" in landed).toBe(false);
  });

  it("steps style detail and fills it in for older scenes", () => {
    const loose = scene([prompt("shared", 1)], { styleDetail: 4 });
    expect(blendScenes(from, loose, 0.5).styleDetail).toBe(8);
    expect(blendScenes(loose, from, 1).styleDetail).toBe(12);
    expect(blendScenes(from, loose, 1).styleDetail).toBe(4);
  });

  it("treats a muted source prompt as silent", () => {
    const muted = scene([prompt("shared", 1, { muted: true })]);
    const start = blendScenes(muted, to, 0);
    expect(start.prompts.find((item) => item.id === "shared")?.weight).toBe(0);
  });
});

describe("ease", () => {
  it("starts and ends flat", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5);
  });
});

describe("sceneName", () => {
  it("names a scene after its loudest prompt", () => {
    expect(sceneName([prompt("a", 0.2), prompt("b", 0.9)])).toBe("b +1");
    expect(sceneName([])).toBe("Free style");
  });
});
