import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import {
  type DrumMode,
  type EngineHealth,
  type EnginePhase,
  type FxState,
  MAX_PROMPTS,
  type MixMode,
  type NoteMode,
  type Point,
  PROMPT_COLORS,
  type Scene,
  type StylePrompt,
  type Take,
  type Transition,
  type VisualMode,
} from "./types.ts";

export const SCENE_SLOTS = 8;

export const MODEL_DEFAULTS = {
  drumStrength: 1,
  noteStrength: 0.8,
  seed: 7,
  /** Style tokens that steer, coarsest first: all 12, as in Google's Python engines. */
  styleDetail: 12,
  styleStrength: 2.4,
  temperature: 1.05,
  topK: 48,
} as const;

/** Settings saved before version 2 defaulted to 6 style tokens. */
const OLD_STYLE_DETAIL_DEFAULT = 6;

const liftStyleDetail = (detail: number): number =>
  detail === OLD_STYLE_DETAIL_DEFAULT ? MODEL_DEFAULTS.styleDetail : detail;

/**
 * Version 1 defaulted style detail to 6, which weakened prompts on this engine,
 * so a saved 6, the old default, moves to all 12. Any other value was chosen
 * and stays. Scenes keep their own style detail and move the same way.
 */
export function migrateStudioSettings(
  persisted: unknown,
  version: number
): Partial<StudioSettings> {
  const saved = (persisted ?? {}) as Partial<StudioSettings>;
  if (version >= 2) {
    return saved;
  }
  const migrated: Partial<StudioSettings> = { ...saved };
  if (saved.styleDetail !== undefined) {
    migrated.styleDetail = liftStyleDetail(saved.styleDetail);
  }
  if (saved.scenes) {
    migrated.scenes = saved.scenes.map((scene) =>
      scene?.styleDetail === undefined
        ? scene
        : { ...scene, styleDetail: liftStyleDetail(scene.styleDetail) }
    );
  }
  return migrated;
}

export const FX_DEFAULTS: FxState = {
  delayDivision: 0.75,
  delayFeedback: 0.38,
  delayMix: 0,
  eqHigh: 0,
  eqLow: 0,
  eqMid: 0,
  filter: 0,
  filterResonance: 0.25,
  reverbMix: 0,
  reverbSize: 0.5,
};

let idCounter = 0;

export function makeId(prefix = "p"): string {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Spread new prompts around the listener on a loose ring. */
export function placeFor(index: number): Point {
  const angle = -Math.PI / 2 + index * 2.399_96;
  const radius = 0.3 + (index % 3) * 0.04;
  return {
    x: clamp(0.5 + Math.cos(angle) * radius, 0.08, 0.92),
    y: clamp(0.5 + Math.sin(angle) * radius, 0.1, 0.9),
  };
}

export function nextColor(prompts: StylePrompt[]): string {
  const used = new Set(prompts.map((prompt) => prompt.color));
  return (
    PROMPT_COLORS.find((color) => !used.has(color)) ??
    PROMPT_COLORS[prompts.length % PROMPT_COLORS.length] ??
    "#ffffff"
  );
}

export function textPrompt(
  text: string,
  existing: StylePrompt[],
  weight = 0.6
): StylePrompt {
  const place = placeFor(existing.length);
  return {
    color: nextColor(existing),
    id: makeId(),
    kind: "text",
    muted: false,
    solo: false,
    text,
    weight,
    x: place.x,
    y: place.y,
  };
}

const START_PROMPTS: StylePrompt[] = (() => {
  const first = textPrompt("soothing chords", [], 0.7);
  const second = textPrompt("dusty lo-fi drums", [first], 0.35);
  return [first, second];
})();

/**
 * localStorage that writes at most a few times a second. Knob drags and Space
 * motion change the store every frame.
 */
function debouncedStorage(): StateStorage {
  if (typeof window === "undefined") {
    throw new Error("No storage during server rendering");
  }
  const pending = new Map<string, string>();
  let timer: number | null = null;
  const flush = () => {
    timer = null;
    for (const [key, value] of pending) {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Storage can be full or blocked. The session keeps running.
      }
    }
    pending.clear();
  };
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", flush);
  return {
    getItem: (key) => pending.get(key) ?? localStorage.getItem(key),
    removeItem: (key) => {
      pending.delete(key);
      localStorage.removeItem(key);
    },
    setItem: (key, value) => {
      pending.set(key, value);
      if (timer === null) {
        timer = window.setTimeout(flush, 400);
      }
    },
  };
}

export interface StudioSettings {
  bpm: number;
  bufferSeconds: number;
  clearance: number;
  drumStrength: number;
  drums: DrumMode;
  /** Library prompts starred for quick reach. */
  favorites: string[];
  /** Space prompts keep drifting and bounce off the walls. */
  float: boolean;
  fx: FxState;
  gate: boolean;
  hold: boolean;
  keyFlavor: "major" | "minor";
  keyLabels: boolean;
  keyRoot: number;
  listener: Point;
  midiMap: Record<string, string>;
  mixMode: MixMode;
  morphBeats: number;
  noteMode: NoteMode;
  noteStrength: number;
  octave: number;
  /** Listener orbit speed in Space, 0 is off. */
  orbit: number;
  progression: string;
  progressionBeats: number;
  prompts: StylePrompt[];
  /** Prompt texts added most recently, newest first. */
  recents: string[];
  /** How far back Rewind takes the music. */
  rewindSeconds: number;
  scenes: (Scene | null)[];
  seed: number;
  strum: boolean;
  /** How many of the 12 style tokens steer, coarsest first. */
  styleDetail: number;
  styleStrength: number;
  temperature: number;
  topK: number;
  transition: Transition;
  visual: VisualMode;
  volume: number;
}

export const STUDIO_DEFAULTS: StudioSettings = {
  bpm: 96,
  bufferSeconds: 1,
  clearance: 0,
  drums: "auto",
  drumStrength: MODEL_DEFAULTS.drumStrength,
  favorites: [],
  float: false,
  fx: FX_DEFAULTS,
  gate: true,
  hold: false,
  keyFlavor: "minor",
  keyLabels: true,
  keyRoot: 9,
  listener: { x: 0.5, y: 0.5 },
  midiMap: {},
  mixMode: "list",
  morphBeats: 8,
  noteMode: "jam",
  noteStrength: MODEL_DEFAULTS.noteStrength,
  octave: 3,
  orbit: 0,
  progression: "Am F C G",
  progressionBeats: 8,
  prompts: START_PROMPTS,
  recents: [],
  rewindSeconds: 10,
  scenes: Array.from({ length: SCENE_SLOTS }, () => null),
  seed: MODEL_DEFAULTS.seed,
  strum: true,
  styleDetail: MODEL_DEFAULTS.styleDetail,
  styleStrength: MODEL_DEFAULTS.styleStrength,
  temperature: MODEL_DEFAULTS.temperature,
  topK: MODEL_DEFAULTS.topK,
  transition: "morph",
  visual: "spectrum",
  volume: 0.8,
};

interface StudioActions {
  addPrompt: (prompt: StylePrompt) => boolean;
  patch: (values: Partial<StudioSettings>) => void;
  patchFx: (values: Partial<FxState>) => void;
  removePrompt: (id: string) => StylePrompt | null;
  reset: () => void;
  restorePrompt: (prompt: StylePrompt, index: number) => void;
  setPromptWeight: (id: string, weight: number) => void;
  updatePrompt: (id: string, values: Partial<StylePrompt>) => void;
}

export type StudioState = StudioSettings & StudioActions;

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => ({
      ...STUDIO_DEFAULTS,

      addPrompt: (prompt) => {
        if (get().prompts.length >= MAX_PROMPTS) {
          return false;
        }
        set((state) => ({ prompts: [...state.prompts, prompt] }));
        return true;
      },

      patch: (values) => set(values),

      patchFx: (values) => set((state) => ({ fx: { ...state.fx, ...values } })),

      removePrompt: (id) => {
        const prompt = get().prompts.find((item) => item.id === id) ?? null;
        set((state) => ({
          prompts: state.prompts.filter((item) => item.id !== id),
        }));
        return prompt;
      },

      reset: () => set({ ...STUDIO_DEFAULTS, midiMap: get().midiMap }),

      restorePrompt: (prompt, index) =>
        set((state) => {
          if (state.prompts.length >= MAX_PROMPTS) {
            return state;
          }
          const prompts = [...state.prompts];
          prompts.splice(clamp(index, 0, prompts.length), 0, prompt);
          return { prompts };
        }),

      setPromptWeight: (id, weight) =>
        set((state) => ({
          prompts: state.prompts.map((prompt) =>
            prompt.id === id
              ? { ...prompt, weight: clamp(weight, 0, 1) }
              : prompt
          ),
        })),

      updatePrompt: (id, values) =>
        set((state) => ({
          prompts: state.prompts.map((prompt) =>
            prompt.id === id ? { ...prompt, ...values } : prompt
          ),
        })),
    }),
    {
      name: "magenta-studio",
      partialize: (state) => {
        const {
          addPrompt,
          patch,
          patchFx,
          removePrompt,
          reset,
          restorePrompt,
          setPromptWeight,
          updatePrompt,
          ...settings
        } = state;
        return settings;
      },
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<StudioSettings>;
        return {
          ...current,
          ...saved,
          fx: { ...FX_DEFAULTS, ...(saved.fx ?? {}) },
          scenes: Array.from(
            { length: SCENE_SLOTS },
            (_, index) => saved.scenes?.[index] ?? null
          ),
        };
      },
      migrate: migrateStudioSettings,
      skipHydration: true,
      storage: createJSONStorage(debouncedStorage),
      version: 2,
    }
  )
);

export interface EngineStats {
  /** Model compute per 40 ms frame. */
  msPerFrame: number | null;
  /** Seconds of audio queued in the playback worklet. */
  queued: number;
  ratio: number;
  underruns: number;
}

export interface MidiDevice {
  id: string;
  name: string;
}

export interface MorphState {
  duration: number;
  from: Scene;
  slot: number;
  start: number;
  to: Scene;
}

export interface LiveState {
  activeScene: number | null;
  /** A library prompt heard on its own while it is held. */
  audition: string | null;
  bootstrap: string;
  chaos: number;
  /** What the model is being asked to continue, while the engine works on it. */
  continuing: string | null;
  /** Scene grooves the engine remembers in this stream, by slot name. */
  grooves: string[];
  health: EngineHealth | null;
  keyNotes: number[];
  latched: number[];
  learn: boolean;
  learnTarget: string | null;
  midiDevices: MidiDevice[];
  midiNotes: number[];
  midiStatus: "denied" | "off" | "ready" | "unsupported";
  morph: MorphState | null;
  morphProgress: number;
  padNotes: number[];
  phase: EnginePhase;
  pointerNotes: number[];
  progressionIndex: number;
  progressionNotes: number[];
  progressionRunning: boolean;
  recording: number | null;
  stats: EngineStats;
  status: string;
  sustain: boolean;
  sustained: number[];
  takes: Take[];
}

export const useLive = create<LiveState>()(() => ({
  activeScene: null,
  audition: null,
  bootstrap: "",
  chaos: 0,
  continuing: null,
  grooves: [],
  health: null,
  keyNotes: [],
  latched: [],
  learn: false,
  learnTarget: null,
  midiDevices: [],
  midiNotes: [],
  midiStatus: "off",
  morph: null,
  morphProgress: 0,
  padNotes: [],
  phase: "offline",
  pointerNotes: [],
  progressionIndex: 0,
  progressionNotes: [],
  progressionRunning: false,
  recording: null,
  stats: { msPerFrame: null, queued: 0, ratio: 1, underruns: 0 },
  status: "Looking for the engine",
  sustain: false,
  sustained: [],
  takes: [],
}));

/** Every note the model should hear right now, sorted and unique. */
export function heldNotes(live: LiveState): number[] {
  const all = new Set<number>([
    ...live.pointerNotes,
    ...live.keyNotes,
    ...live.midiNotes,
    ...live.latched,
    ...live.sustained,
    ...live.padNotes,
    ...live.progressionNotes,
  ]);
  return [...all]
    .filter((note) => note >= 0 && note < 128)
    .sort((a, b) => a - b);
}

export function isPlaying(phase: EnginePhase): boolean {
  return phase === "live" || phase === "restarting";
}
