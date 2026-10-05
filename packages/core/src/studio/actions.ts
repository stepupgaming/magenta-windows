// Stage actions shared by buttons, hotkeys, MIDI, and the command palette.

import { toast } from "sonner";
import type { StereoClip } from "./audio.ts";
import { clipSeconds, encodeWav, peaks, saveClip } from "./clips.ts";
import { engine } from "./engine.ts";
import { presetSettings, type SessionPreset } from "./library.ts";
import {
  clamp,
  makeId,
  nextColor,
  placeFor,
  STUDIO_DEFAULTS,
  type StudioSettings,
  textPrompt,
  useLive,
  useStudio,
} from "./store.ts";
import {
  MAX_PROMPTS,
  type Point,
  type StylePrompt,
  type Take,
} from "./types.ts";

const FULL_MESSAGE = "The model blends up to eight prompts. Remove one first.";

/** Near the listener in Space so a new prompt is heard, on the ring in the list. */
function placement(at?: Point): Point {
  const studio = useStudio.getState();
  if (at) {
    return at;
  }
  if (studio.mixMode === "space") {
    const angle = Math.random() * Math.PI * 2;
    return {
      x: clamp(studio.listener.x + Math.cos(angle) * 0.14, 0.06, 0.94),
      y: clamp(studio.listener.y + Math.sin(angle) * 0.14, 0.08, 0.92),
    };
  }
  return placeFor(studio.prompts.length);
}

export function addTextPrompt(text: string, at?: Point, weight = 0.6): boolean {
  const clean = text.trim().slice(0, 180);
  if (!clean) {
    return false;
  }
  const studio = useStudio.getState();
  if (studio.prompts.length >= MAX_PROMPTS) {
    toast(FULL_MESSAGE);
    return false;
  }
  const prompt = {
    ...textPrompt(clean, studio.prompts, weight),
    ...placement(at),
  };
  const added = studio.addPrompt(prompt);
  if (added) {
    remember(clean);
  }
  return added;
}

const RECENT_LIMIT = 40;

export function remember(text: string): void {
  const studio = useStudio.getState();
  const recents = [text, ...studio.recents.filter((item) => item !== text)];
  studio.patch({ recents: recents.slice(0, RECENT_LIMIT) });
}

export function toggleFavorite(text: string): void {
  const studio = useStudio.getState();
  const favorites = studio.favorites.includes(text)
    ? studio.favorites.filter((item) => item !== text)
    : [text, ...studio.favorites];
  studio.patch({ favorites });
}

/** Make this one prompt the whole blend. */
export function replaceBlend(text: string): void {
  const studio = useStudio.getState();
  const prompt = { ...textPrompt(text, [], 0.8), ...placement() };
  studio.patch({ prompts: [prompt] });
  remember(text);
}

export function removePrompt(id: string): void {
  const studio = useStudio.getState();
  const index = studio.prompts.findIndex((prompt) => prompt.id === id);
  const removed = studio.removePrompt(id);
  if (!removed) {
    return;
  }
  toast(`Removed “${removed.text}”`, {
    action: {
      label: "Undo",
      onClick: () => useStudio.getState().restorePrompt(removed, index),
    },
    duration: 5000,
  });
}

export function cycleColor(prompt: StylePrompt): void {
  const studio = useStudio.getState();
  const others = studio.prompts.filter((item) => item.id !== prompt.id);
  studio.updatePrompt(prompt.id, { color: nextColor([...others, prompt]) });
}

export async function addAudioPrompt(
  name: string,
  samples: Float32Array,
  at?: Point
): Promise<boolean> {
  const studio = useStudio.getState();
  if (studio.prompts.length >= MAX_PROMPTS) {
    toast(FULL_MESSAGE);
    return false;
  }
  const clipKey = makeId("clip");
  await saveClip(clipKey, samples);
  const prompt: StylePrompt = {
    audioSeconds: samples.length / 16_000,
    clipKey,
    color: nextColor(studio.prompts),
    id: makeId(),
    kind: "audio",
    muted: false,
    peaks: peaks([samples], 48),
    solo: false,
    text: name,
    weight: 0.6,
    ...placement(at),
  };
  const added = useStudio.getState().addPrompt(prompt);
  if (added && useLive.getState().phase === "live") {
    engine.uploadClip(clipKey).catch((error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : "The engine refused the clip"
      );
    });
  }
  return added;
}

// ---- Takes ---------------------------------------------------------------

function addTake(clip: StereoClip, source: Take["source"]): Take | null {
  const seconds = clipSeconds(clip);
  if (seconds < 0.25) {
    toast("Nothing to keep yet. Press play first.");
    return null;
  }
  const takes = useLive.getState().takes;
  const number = takes.filter((take) => take.source === source).length + 1;
  const take: Take = {
    createdAt: Date.now(),
    id: makeId("take"),
    left: clip.left,
    name: source === "record" ? `Take ${number}` : `Capture ${number}`,
    peaks: peaks([clip.left, clip.right], 96),
    right: clip.right,
    sampleRate: clip.sampleRate,
    seconds,
    source,
    url: URL.createObjectURL(encodeWav(clip)),
  };
  useLive.setState({ takes: [take, ...takes] });
  return take;
}

export async function toggleRecord(): Promise<void> {
  const audio = engine.audio;
  const recording = useLive.getState().recording;
  if (recording !== null) {
    useLive.setState({ recording: null });
    if (!audio) {
      return;
    }
    const clip = await audio.stopRecording();
    const take = addTake(clip, "record");
    if (take) {
      toast.success(`${take.name} saved`, {
        description: formatTime(take.seconds),
      });
    }
    return;
  }
  if (!audio) {
    toast("Press play first, then record.");
    return;
  }
  audio.startRecording();
  useLive.setState({ recording: performance.now() });
}

/** Keep the last `seconds` that already played. Nothing has to be armed. */
export async function captureLast(seconds: number): Promise<void> {
  const audio = engine.audio;
  if (!audio) {
    toast("Nothing has played yet.");
    return;
  }
  const clip = await audio.capture(seconds);
  const take = addTake(clip, "capture");
  if (take) {
    toast.success(`Kept the last ${formatTime(take.seconds)}`, {
      description: "It is in Takes.",
    });
  }
}

export function downloadTake(take: Take): void {
  const anchor = document.createElement("a");
  const stamp = new Date(take.createdAt)
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-");
  anchor.href = take.url;
  anchor.download = `magenta-${stamp}-${take.name.toLowerCase().replace(/\s+/g, "-")}.wav`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export function removeTake(id: string): void {
  const takes = useLive.getState().takes;
  const take = takes.find((item) => item.id === id);
  if (take) {
    URL.revokeObjectURL(take.url);
  }
  useLive.setState({ takes: takes.filter((item) => item.id !== id) });
}

export function renameTake(id: string, name: string): void {
  useLive.setState({
    takes: useLive
      .getState()
      .takes.map((take) => (take.id === id ? { ...take, name } : take)),
  });
}

export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

// ---- Sessions ------------------------------------------------------------

export function applyPreset(preset: SessionPreset): void {
  useLive.setState({ activeScene: null, morph: null });
  useStudio.getState().patch(presetSettings(preset));
  toast(preset.name, { description: preset.description });
}

const SESSION_KEYS: (keyof StudioSettings)[] = Object.keys(
  STUDIO_DEFAULTS
) as (keyof StudioSettings)[];

export function exportSession(): void {
  const studio = useStudio.getState();
  const data: Record<string, unknown> = { app: "magenta-studio", version: 1 };
  for (const key of SESSION_KEYS) {
    data[key] = studio[key];
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = "magenta-session.json";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(anchor.href), 2000);
}

export async function importSession(file: File): Promise<void> {
  try {
    const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
    if (parsed.app !== "magenta-studio") {
      throw new Error("This is not a Magenta session file.");
    }
    const values: Record<string, unknown> = {};
    for (const key of SESSION_KEYS) {
      if (key in parsed) {
        values[key] = parsed[key];
      }
    }
    useStudio.getState().patch(values as Partial<StudioSettings>);
    toast.success("Session loaded", {
      description:
        "Audio prompts from another computer need their files again.",
    });
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "The session did not load"
    );
  }
}
