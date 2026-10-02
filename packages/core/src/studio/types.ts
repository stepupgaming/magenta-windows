export interface PromptChip {
  color: string;
  id: string;
  text: string;
  x: number;
  y: number;
}

export interface PromptLine {
  color: string;
  id: string;
  text: string;
  weight: number;
}

export interface EngineHealth {
  backend: string;
  error: string | null;
  gpu: string | null;
  model_loaded: boolean;
  ok: boolean;
  sample_rate: number;
}

export const ENGINE = "http://127.0.0.1:8765";

export const CHIP_COLORS = [
  "#ff4d8d",
  "#4da3ff",
  "#f5c542",
  "#3dff8a",
  "#c084fc",
  "#fb7185",
] as const;
