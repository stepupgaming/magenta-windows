// Every continuous control on the stage has one id here, so MIDI learn, the
// knobs, and the command palette all address the same thing.

import {
  clamp,
  FX_DEFAULTS,
  MODEL_DEFAULTS,
  useLive,
  useStudio,
} from "./store.ts";
import type { FxState } from "./types.ts";
import { MAX_PROMPTS } from "./types.ts";

export interface ParamDef {
  defaultValue: number;
  format: (value: number) => string;
  get: () => number;
  group: string;
  id: string;
  label: string;
  max: number;
  min: number;
  set: (value: number) => void;
  step: number;
}

const fixed = (places: number) => (value: number) => value.toFixed(places);
const percent = (value: number) => `${Math.round(value * 100)}%`;
const decibels = (value: number) =>
  `${value > 0 ? "+" : ""}${value.toFixed(value <= -24 ? 0 : 1)} dB`;

export function snap(value: number, step: number, min: number): number {
  if (step <= 0) {
    return value;
  }
  return Math.round((value - min) / step) * step + min;
}

function studioParam(
  id: string,
  label: string,
  group: string,
  key:
    | "drumStrength"
    | "noteStrength"
    | "styleDetail"
    | "styleStrength"
    | "temperature"
    | "volume",
  range: { defaultValue: number; max: number; min: number; step: number },
  format: (value: number) => string
): ParamDef {
  return {
    ...range,
    format,
    get: () => useStudio.getState()[key],
    group,
    id,
    label,
    set: (value) =>
      useStudio.getState().patch({
        [key]: clamp(snap(value, range.step, range.min), range.min, range.max),
      }),
  };
}

function fxParam(
  key: keyof FxState,
  label: string,
  range: { max: number; min: number; step: number },
  format: (value: number) => string
): ParamDef {
  return {
    ...range,
    defaultValue: FX_DEFAULTS[key],
    format,
    get: () => useStudio.getState().fx[key],
    group: "Effects",
    id: `fx.${key}`,
    label,
    set: (value) =>
      useStudio.getState().patchFx({
        [key]: clamp(snap(value, range.step, range.min), range.min, range.max),
      }),
  };
}

function slotParam(slot: number): ParamDef {
  return {
    defaultValue: 0.6,
    format: percent,
    get: () => useStudio.getState().prompts[slot]?.weight ?? 0,
    group: "Prompts",
    id: `slot.${slot + 1}`,
    label: `Prompt ${slot + 1} weight`,
    max: 1,
    min: 0,
    set: (value) => {
      const prompt = useStudio.getState().prompts[slot];
      if (prompt) {
        useStudio.getState().setPromptWeight(prompt.id, value);
      }
    },
    step: 0.01,
  };
}

function filterLabel(value: number): string {
  if (Math.abs(value) < 0.02) {
    return "Open";
  }
  return value < 0
    ? `LP ${Math.round(-value * 100)}`
    : `HP ${Math.round(value * 100)}`;
}

export const PARAMS: ParamDef[] = [
  studioParam(
    "model.style",
    "Style strength",
    "Model",
    "styleStrength",
    { defaultValue: MODEL_DEFAULTS.styleStrength, max: 5, min: 0, step: 0.2 },
    fixed(1)
  ),
  studioParam(
    "model.detail",
    "Style detail",
    "Model",
    "styleDetail",
    { defaultValue: MODEL_DEFAULTS.styleDetail, max: 12, min: 1, step: 1 },
    (value) => `${Math.round(value)} of 12`
  ),
  studioParam(
    "model.notes",
    "Note strength",
    "Model",
    "noteStrength",
    { defaultValue: MODEL_DEFAULTS.noteStrength, max: 5, min: 0, step: 0.2 },
    fixed(1)
  ),
  studioParam(
    "model.drums",
    "Drum strength",
    "Model",
    "drumStrength",
    { defaultValue: MODEL_DEFAULTS.drumStrength, max: 4, min: 0, step: 1 },
    fixed(0)
  ),
  studioParam(
    "model.temperature",
    "Temperature",
    "Model",
    "temperature",
    { defaultValue: MODEL_DEFAULTS.temperature, max: 2, min: 0.2, step: 0.01 },
    fixed(2)
  ),
  {
    defaultValue: 0,
    format: (value) =>
      value === 0
        ? "Calm"
        : `${value > 0 ? "+" : ""}${Math.round(value * 100)}`,
    get: () => useLive.getState().chaos,
    group: "Model",
    id: "model.chaos",
    label: "Chaos",
    max: 1,
    min: -1,
    set: (value) => useLive.setState({ chaos: clamp(value, -1, 1) }),
    step: 0.01,
  },
  studioParam(
    "master.volume",
    "Volume",
    "Master",
    "volume",
    { defaultValue: 0.8, max: 1.4, min: 0, step: 0.01 },
    (value) =>
      value <= 0.001 ? "−∞" : `${(20 * Math.log10(value)).toFixed(1)} dB`
  ),
  fxParam("filter", "Filter", { max: 1, min: -1, step: 0.01 }, filterLabel),
  fxParam(
    "filterResonance",
    "Resonance",
    { max: 1, min: 0, step: 0.01 },
    percent
  ),
  fxParam("eqLow", "Low", { max: 6, min: -30, step: 0.5 }, decibels),
  fxParam("eqMid", "Mid", { max: 6, min: -30, step: 0.5 }, decibels),
  fxParam("eqHigh", "High", { max: 6, min: -30, step: 0.5 }, decibels),
  fxParam("delayMix", "Echo", { max: 1, min: 0, step: 0.01 }, percent),
  fxParam(
    "delayFeedback",
    "Echo repeats",
    { max: 0.92, min: 0, step: 0.01 },
    percent
  ),
  fxParam("reverbMix", "Reverb", { max: 1, min: 0, step: 0.01 }, percent),
  fxParam("reverbSize", "Reverb size", { max: 1, min: 0, step: 0.01 }, percent),
  {
    defaultValue: 0.5,
    format: percent,
    get: () => useStudio.getState().listener.x,
    group: "Space",
    id: "space.x",
    label: "Listener X",
    max: 1,
    min: 0,
    set: (value) =>
      useStudio.getState().patch({
        listener: { ...useStudio.getState().listener, x: clamp(value, 0, 1) },
      }),
    step: 0.001,
  },
  {
    defaultValue: 0.5,
    format: percent,
    get: () => 1 - useStudio.getState().listener.y,
    group: "Space",
    id: "space.y",
    label: "Listener Y",
    max: 1,
    min: 0,
    set: (value) =>
      useStudio.getState().patch({
        listener: {
          ...useStudio.getState().listener,
          y: clamp(1 - value, 0, 1),
        },
      }),
    step: 0.001,
  },
  ...Array.from({ length: MAX_PROMPTS }, (_, slot) => slotParam(slot)),
];

const BY_ID = new Map(PARAMS.map((param) => [param.id, param]));

export function param(id: string): ParamDef | undefined {
  return BY_ID.get(id);
}

/** Set a param from a 0..1 controller position. */
export function setNormalized(id: string, amount: number): void {
  const def = BY_ID.get(id);
  if (!def) {
    return;
  }
  def.set(def.min + clamp(amount, 0, 1) * (def.max - def.min));
}

export function normalized(def: ParamDef, value: number): number {
  return def.max === def.min ? 0 : (value - def.min) / (def.max - def.min);
}

// ---- Actions --------------------------------------------------------------

export interface ActionDef {
  group: string;
  id: string;
  label: string;
  run: () => void;
}

const actions = new Map<string, ActionDef>();

export function registerActions(list: ActionDef[]): () => void {
  for (const action of list) {
    actions.set(action.id, action);
  }
  return () => {
    for (const action of list) {
      if (actions.get(action.id) === action) {
        actions.delete(action.id);
      }
    }
  };
}

export function runAction(id: string): boolean {
  const action = actions.get(id);
  action?.run();
  return Boolean(action);
}

export function allActions(): ActionDef[] {
  return [...actions.values()];
}

export function targetLabel(id: string): string {
  return BY_ID.get(id)?.label ?? actions.get(id)?.label ?? id;
}
