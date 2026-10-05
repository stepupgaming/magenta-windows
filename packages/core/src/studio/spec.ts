// Turns studio state into the message the engine reads on every steer.
// Pure functions, so the stage, the scenes, and the tests agree.

import type { StudioSettings } from "./store.ts";
import {
  type DrumMode,
  MAX_PROMPTS,
  type MixMode,
  type NoteMode,
  type Point,
  type StylePrompt,
} from "./types.ts";

export type WirePrompt =
  | { audio: string; weight: number }
  | { text: string; weight: number };

export interface WireSpec {
  cfg_drums: number;
  cfg_musiccoca: number;
  cfg_notes: number;
  drums: DrumMode;
  free_style: true;
  notes: number[] | null;
  onsets: boolean;
  prompts: WirePrompt[];
  seed: number;
  /** Style tokens that steer, coarsest first, 1 to 12. */
  style_levels: number;
  temperature: number;
  top_k: number;
}

/** Note slot values the model reads for each MIDI pitch. */
export const NOTE_MASKED = -1;
export const NOTE_OFF = 0;
export const NOTE_SUSTAIN = 1;
export const NOTE_ON = 3;

/** Strength the engine gets in Solo while no key is held, to keep it quiet. */
export const SOLO_REST_STRENGTH = 7;

/** Inverse square pull in Space, softened so a prompt under the listener stays finite. */
const SPACE_SOFTEN = 0.015;

export function audible(prompts: StylePrompt[]): boolean[] {
  const anySolo = prompts.some((prompt) => prompt.solo && !prompt.muted);
  return prompts.map((prompt) =>
    anySolo ? prompt.solo && !prompt.muted : !prompt.muted
  );
}

/**
 * Normalized share of each prompt in the blend. All zeros means nothing is
 * audible and the model picks its own style.
 */
export function promptShares(
  prompts: StylePrompt[],
  mode: MixMode,
  listener: Point
): number[] {
  const on = audible(prompts);
  const raw = prompts.map((prompt, index) => {
    if (!on[index] || prompt.weight <= 0) {
      return 0;
    }
    if (mode === "list") {
      return prompt.weight;
    }
    const dx = prompt.x - listener.x;
    const dy = prompt.y - listener.y;
    return prompt.weight / (dx * dx + dy * dy + SPACE_SOFTEN);
  });
  const total = raw.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return raw.map(() => 0);
  }
  return raw.map((value) => value / total);
}

export function notesPayload(
  held: readonly number[],
  mode: NoteMode,
  strum: boolean,
  clearance: number
): number[] | null {
  if (held.length === 0) {
    return mode === "solo" ? Array.from({ length: 128 }, () => NOTE_OFF) : null;
  }
  const notes: number[] = Array.from({ length: 128 }, () =>
    mode === "solo" ? NOTE_OFF : NOTE_MASKED
  );
  if (mode === "jam" && clearance > 0) {
    for (const note of held) {
      const low = Math.max(0, note - clearance);
      const high = Math.min(127, note + clearance);
      for (let pitch = low; pitch <= high; pitch += 1) {
        notes[pitch] = NOTE_OFF;
      }
    }
  }
  for (const note of held) {
    if (note >= 0 && note < 128) {
      notes[note] = strum ? NOTE_ON : NOTE_SUSTAIN;
    }
  }
  return notes;
}

/** Chaos pushes temperature up to twice or down to half the setting. */
export function chaosTemperature(base: number, chaos: number): number {
  return Math.min(2, Math.max(0.2, base * 2 ** chaos));
}

const round = (value: number, places: number) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

export interface SpecInputs {
  /** When set, this text alone is the style, for auditioning. */
  audition?: string | null;
  chaos: number;
  held: readonly number[];
  /** Server ids of uploaded audio clips, by local clip key. */
  uploaded: ReadonlyMap<string, string>;
}

type SpecSettings = Pick<
  StudioSettings,
  | "clearance"
  | "drumStrength"
  | "drums"
  | "listener"
  | "mixMode"
  | "noteMode"
  | "noteStrength"
  | "prompts"
  | "seed"
  | "strum"
  | "styleDetail"
  | "styleStrength"
  | "temperature"
  | "topK"
>;

/** Keep the strongest prompts when a morph briefly holds more than the engine blends. */
function strongest(shares: number[]): number[] {
  if (shares.filter((share) => share > 0).length <= MAX_PROMPTS) {
    return shares;
  }
  const floor = [...shares].sort((a, b) => b - a)[MAX_PROMPTS - 1] ?? 0;
  let kept = 0;
  const trimmed = shares.map((share) => {
    if (share >= floor && share > 0 && kept < MAX_PROMPTS) {
      kept += 1;
      return share;
    }
    return 0;
  });
  const total = trimmed.reduce((sum, share) => sum + share, 0);
  return total > 0 ? trimmed.map((share) => share / total) : trimmed;
}

export function buildSpec(studio: SpecSettings, inputs: SpecInputs): WireSpec {
  const shares = strongest(
    promptShares(studio.prompts, studio.mixMode, studio.listener)
  );
  const prompts: WirePrompt[] = [];
  studio.prompts.forEach((prompt, index) => {
    const weight = round(shares[index] ?? 0, 3);
    if (weight <= 0) {
      return;
    }
    if (prompt.kind === "audio") {
      const id = prompt.clipKey
        ? inputs.uploaded.get(prompt.clipKey)
        : undefined;
      if (id) {
        prompts.push({ audio: id, weight });
      }
      return;
    }
    const text = prompt.text.trim();
    if (text) {
      prompts.push({ text, weight });
    }
  });
  if (inputs.audition) {
    prompts.splice(0, prompts.length, { text: inputs.audition, weight: 1 });
  }
  const notes = notesPayload(
    inputs.held,
    studio.noteMode,
    studio.strum,
    studio.clearance
  );
  const resting = studio.noteMode === "solo" && inputs.held.length === 0;
  return {
    cfg_drums: studio.drumStrength,
    cfg_musiccoca: round(studio.styleStrength, 2),
    cfg_notes: resting ? SOLO_REST_STRENGTH : round(studio.noteStrength, 2),
    drums: studio.drums,
    free_style: true,
    notes,
    onsets: !studio.strum,
    prompts,
    seed: studio.seed,
    style_levels: Math.round(studio.styleDetail),
    temperature: round(chaosTemperature(studio.temperature, inputs.chaos), 3),
    top_k: Math.round(studio.topK),
  };
}
