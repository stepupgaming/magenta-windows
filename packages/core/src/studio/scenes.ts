// Scenes store the sound: prompts, weights, Space positions, the model knobs,
// and the drum mode. Recall either cuts or morphs over a number of beats.

import { audible } from "./spec.ts";
import { MODEL_DEFAULTS, type StudioSettings } from "./store.ts";
import type { Scene, StylePrompt } from "./types.ts";

type SceneSource = Pick<
  StudioSettings,
  | "drumStrength"
  | "drums"
  | "listener"
  | "mixMode"
  | "noteStrength"
  | "prompts"
  | "styleDetail"
  | "styleStrength"
  | "temperature"
>;

const detail = (scene: Scene) =>
  scene.styleDetail ?? MODEL_DEFAULTS.styleDetail;

export function sceneName(prompts: StylePrompt[]): string {
  const on = audible(prompts);
  const ranked = prompts
    .filter((_, index) => on[index])
    .sort((a, b) => b.weight - a.weight);
  const lead = ranked[0];
  if (!lead) {
    return "Free style";
  }
  const extra = ranked.length - 1;
  return extra > 0 ? `${lead.text} +${extra}` : lead.text;
}

export function snapshot(studio: SceneSource): Scene {
  return {
    drums: studio.drums,
    drumStrength: studio.drumStrength,
    listener: { ...studio.listener },
    mixMode: studio.mixMode,
    name: sceneName(studio.prompts),
    noteStrength: studio.noteStrength,
    prompts: studio.prompts.map((prompt) => ({ ...prompt })),
    styleDetail: studio.styleDetail,
    styleStrength: studio.styleStrength,
    temperature: studio.temperature,
  };
}

export function sceneColors(scene: Scene): string[] {
  const on = audible(scene.prompts);
  return scene.prompts
    .filter((_, index) => on[index])
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((prompt) => prompt.color);
}

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/** Smoothstep keeps the start and the landing gentle. */
export function ease(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function effective(prompts: StylePrompt[]): Map<string, number> {
  const on = audible(prompts);
  return new Map(
    prompts.map((prompt, index) => [prompt.id, on[index] ? prompt.weight : 0])
  );
}

/**
 * The studio values at `t` (0..1) of the way from one scene to another.
 * Prompts are matched by id: shared ones glide, the rest fade in or out.
 */
export function blendScenes(from: Scene, to: Scene, t: number): SceneSource {
  if (t >= 1) {
    return {
      drums: to.drums,
      drumStrength: to.drumStrength,
      listener: { ...to.listener },
      mixMode: to.mixMode,
      noteStrength: to.noteStrength,
      prompts: to.prompts.map((prompt) => ({ ...prompt })),
      styleDetail: detail(to),
      styleStrength: to.styleStrength,
      temperature: to.temperature,
    };
  }
  const before = effective(from.prompts);
  const after = effective(to.prompts);
  const fromById = new Map(from.prompts.map((prompt) => [prompt.id, prompt]));
  const toIds = new Set(to.prompts.map((prompt) => prompt.id));
  const prompts: StylePrompt[] = [];
  for (const target of to.prompts) {
    const origin = fromById.get(target.id);
    const start = before.get(target.id) ?? 0;
    const end = after.get(target.id) ?? 0;
    prompts.push({
      ...target,
      muted: false,
      solo: false,
      text: origin && t < 0.5 ? origin.text : target.text,
      weight: lerp(start, end, t),
      x: origin ? lerp(origin.x, target.x, t) : target.x,
      y: origin ? lerp(origin.y, target.y, t) : target.y,
    });
  }
  for (const origin of from.prompts) {
    if (toIds.has(origin.id)) {
      continue;
    }
    prompts.push({
      ...origin,
      muted: false,
      solo: false,
      weight: lerp(before.get(origin.id) ?? 0, 0, t),
    });
  }
  return {
    drums: t < 0.5 ? from.drums : to.drums,
    drumStrength: lerp(from.drumStrength, to.drumStrength, t),
    listener: {
      x: lerp(from.listener.x, to.listener.x, t),
      y: lerp(from.listener.y, to.listener.y, t),
    },
    mixMode: to.mixMode,
    noteStrength: lerp(from.noteStrength, to.noteStrength, t),
    prompts,
    styleDetail: Math.round(lerp(detail(from), detail(to), t)),
    styleStrength: lerp(from.styleStrength, to.styleStrength, t),
    temperature: lerp(from.temperature, to.temperature, t),
  };
}
