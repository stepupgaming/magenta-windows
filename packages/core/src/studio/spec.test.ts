import { describe, expect, it } from "vitest";
import {
  buildSpec,
  chaosTemperature,
  NOTE_MASKED,
  NOTE_OFF,
  NOTE_ON,
  NOTE_SUSTAIN,
  notesPayload,
  promptShares,
  SOLO_REST_STRENGTH,
} from "./spec.ts";
import type { StylePrompt } from "./types.ts";

function prompt(id: string, values: Partial<StylePrompt> = {}): StylePrompt {
  return {
    color: "#ffffff",
    id,
    kind: "text",
    muted: false,
    solo: false,
    text: id,
    weight: 0.5,
    x: 0.5,
    y: 0.5,
    ...values,
  };
}

const settings = {
  clearance: 0,
  drums: "auto" as const,
  drumStrength: 1,
  listener: { x: 0.5, y: 0.5 },
  mixMode: "list" as const,
  noteMode: "jam" as const,
  noteStrength: 0.8,
  prompts: [
    prompt("techno", { weight: 0.75 }),
    prompt("chords", { weight: 0.25 }),
  ],
  seed: 7,
  strum: true,
  styleStrength: 2.4,
  temperature: 1.05,
  topK: 48,
};

const inputs = {
  chaos: 0,
  held: [] as number[],
  uploaded: new Map<string, string>(),
};

describe("promptShares", () => {
  it("normalizes list weights", () => {
    expect(promptShares(settings.prompts, "list", settings.listener)).toEqual([
      0.75, 0.25,
    ]);
  });

  it("drops muted prompts and honors solo", () => {
    const prompts = [
      prompt("a", { muted: true }),
      prompt("b"),
      prompt("c", { solo: true }),
    ];
    expect(promptShares(prompts, "list", settings.listener)).toEqual([0, 0, 1]);
  });

  it("returns zeros when nothing is audible", () => {
    const prompts = [prompt("a", { weight: 0 }), prompt("b", { muted: true })];
    expect(promptShares(prompts, "list", settings.listener)).toEqual([0, 0]);
  });

  it("favors the nearer prompt in space by inverse square", () => {
    const prompts = [
      prompt("near", { x: 0.55, y: 0.5 }),
      prompt("far", { x: 0.95, y: 0.5 }),
    ];
    const [near, far] = promptShares(prompts, "space", { x: 0.5, y: 0.5 });
    expect(near).toBeGreaterThan(0.8);
    expect((near ?? 0) + (far ?? 0)).toBeCloseTo(1);
  });
});

describe("notesPayload", () => {
  it("leaves the model free in jam with nothing held", () => {
    expect(notesPayload([], "jam", true, 0)).toBeNull();
  });

  it("asks for silence in solo with nothing held", () => {
    const notes = notesPayload([], "solo", true, 0);
    expect(notes).toHaveLength(128);
    expect(notes?.every((value) => value === NOTE_OFF)).toBe(true);
  });

  it("marks held notes on and the rest masked in jam", () => {
    const notes = notesPayload([60, 64], "jam", true, 0) ?? [];
    expect(notes[60]).toBe(NOTE_ON);
    expect(notes[64]).toBe(NOTE_ON);
    expect(notes[62]).toBe(NOTE_MASKED);
  });

  it("uses sustain when strum is off so the engine can mark onsets", () => {
    const notes = notesPayload([60], "jam", false, 0) ?? [];
    expect(notes[60]).toBe(NOTE_SUSTAIN);
  });

  it("clears the neighbors within the clearance", () => {
    const notes = notesPayload([60], "jam", true, 2) ?? [];
    expect(notes.slice(57, 64)).toEqual([
      NOTE_MASKED,
      NOTE_OFF,
      NOTE_OFF,
      NOTE_ON,
      NOTE_OFF,
      NOTE_OFF,
      NOTE_MASKED,
    ]);
  });

  it("turns off every other pitch in solo", () => {
    const notes = notesPayload([60], "solo", true, 0) ?? [];
    expect(notes.filter((value) => value === NOTE_OFF)).toHaveLength(127);
  });
});

describe("chaosTemperature", () => {
  it("doubles at full chaos and halves at full calm", () => {
    expect(chaosTemperature(1, 1)).toBe(2);
    expect(chaosTemperature(1, -1)).toBe(0.5);
  });

  it("stays inside the engine range", () => {
    expect(chaosTemperature(1.6, 1)).toBe(2);
    expect(chaosTemperature(0.3, -1)).toBe(0.2);
  });
});

describe("buildSpec", () => {
  it("builds the steer message the engine reads", () => {
    const spec = buildSpec(settings, inputs);
    expect(spec.prompts).toEqual([
      { text: "techno", weight: 0.75 },
      { text: "chords", weight: 0.25 },
    ]);
    expect(spec).toMatchObject({
      cfg_drums: 1,
      cfg_musiccoca: 2.4,
      cfg_notes: 0.8,
      drums: "auto",
      free_style: true,
      notes: null,
      onsets: false,
      seed: 7,
      temperature: 1.05,
      top_k: 48,
    });
  });

  it("pushes note strength up while solo rests", () => {
    const spec = buildSpec({ ...settings, noteMode: "solo" }, inputs);
    expect(spec.cfg_notes).toBe(SOLO_REST_STRENGTH);
  });

  it("skips audio prompts that are not uploaded yet", () => {
    const prompts = [
      prompt("clip", { clipKey: "k1", kind: "audio" }),
      prompt("text"),
    ];
    expect(buildSpec({ ...settings, prompts }, inputs).prompts).toEqual([
      { text: "text", weight: 0.5 },
    ]);
    const uploaded = new Map([["k1", "abc"]]);
    expect(
      buildSpec({ ...settings, prompts }, { ...inputs, uploaded }).prompts
    ).toEqual([
      { audio: "abc", weight: 0.5 },
      { text: "text", weight: 0.5 },
    ]);
  });

  it("keeps the eight strongest prompts during a long morph", () => {
    const prompts = Array.from({ length: 10 }, (_, index) =>
      prompt(`p${index}`, { weight: (index + 1) / 10 })
    );
    const spec = buildSpec({ ...settings, prompts }, inputs);
    expect(spec.prompts).toHaveLength(8);
    expect(
      spec.prompts.map((item) => ("text" in item ? item.text : ""))
    ).not.toContain("p0");
    const total = spec.prompts.reduce((sum, item) => sum + item.weight, 0);
    expect(total).toBeCloseTo(1, 2);
  });

  it("lets an audition replace the blend", () => {
    const spec = buildSpec(settings, { ...inputs, audition: "solo cello" });
    expect(spec.prompts).toEqual([{ text: "solo cello", weight: 1 }]);
  });
});
