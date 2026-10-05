// Shared shapes for the studio. The wire format lives in spec.ts.

export const ENGINE = "http://127.0.0.1:8765";
export const ENGINE_SOCKET = "ws://127.0.0.1:8765/ws/stream";

/** Server sample rate and the model's 40 ms frame. */
export const SAMPLE_RATE = 48_000;
export const FRAME_MS = 40;

/** The engine blends at most eight prompts. */
export const MAX_PROMPTS = 8;

/** Magenta app palette, assigned to prompts in order. */
export const PROMPT_COLORS = [
  "#7fb2ff",
  "#ff4c8d",
  "#ffc23c",
  "#84f3ed",
  "#ae5cff",
  "#7c89ff",
  "#ff70f9",
  "#81d5fa",
] as const;

export type PromptKind = "audio" | "text";

export interface StylePrompt {
  /** Seconds of audio for an audio prompt. */
  audioSeconds?: number;
  /** IndexedDB key of the 16 kHz mono clip behind an audio prompt. */
  clipKey?: string;
  color: string;
  id: string;
  kind: PromptKind;
  muted: boolean;
  /** Small waveform for an audio prompt, 0..1 values. */
  peaks?: number[];
  solo: boolean;
  /** The prompt text, or the file name of an audio prompt. */
  text: string;
  /** 0..1. In Space the weight scales the prompt's pull. */
  weight: number;
  x: number;
  y: number;
}

export type MixMode = "list" | "space";

/** auto masks the drum slot, on asks for drums, off asks for none. */
export type DrumMode = "auto" | "off" | "on";

/** Jam lets the model accompany your notes. Solo plays only your notes. */
export type NoteMode = "jam" | "solo";

export type Transition = "cut" | "morph";

export type VisualMode = "lines" | "spectrum";

export interface Point {
  x: number;
  y: number;
}

export interface ModelKnobs {
  drumStrength: number;
  noteStrength: number;
  styleStrength: number;
  temperature: number;
}

export interface Scene extends ModelKnobs {
  drums: DrumMode;
  listener: Point;
  mixMode: MixMode;
  name: string;
  prompts: StylePrompt[];
  /** Missing from scenes saved before style detail existed. */
  styleDetail?: number;
}

export interface FxState {
  /** Note division in beats, for example 0.75 is a dotted eighth. */
  delayDivision: number;
  delayFeedback: number;
  delayMix: number;
  eqHigh: number;
  eqLow: number;
  eqMid: number;
  /** -1 low-pass through 0 open to +1 high-pass. */
  filter: number;
  filterResonance: number;
  reverbMix: number;
  reverbSize: number;
}

/** How the engine refines text prompts before blending, as upstream does. */
export type TextMapperState = "off" | "on" | "pending" | "unavailable";

export interface EngineHealth {
  backend: string;
  error: string | null;
  gpu: string | null;
  model_loaded: boolean;
  ok: boolean;
  sample_rate: number;
  /** Absent on engines that predate the text mapper. */
  text_mapper?: TextMapperState;
  text_mapper_detail?: string;
}

export type EnginePhase =
  | "error"
  | "live"
  | "loading"
  | "offline"
  | "ready"
  | "restarting"
  | "starting";

export interface Take {
  createdAt: number;
  id: string;
  left: Float32Array;
  name: string;
  peaks: number[];
  right: Float32Array;
  sampleRate: number;
  seconds: number;
  source: "capture" | "record";
  url: string;
}
