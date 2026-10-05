// Note input from the mouse, the computer keyboard, and MIDI. Hold latches
// chords, the sustain pedal keeps released notes, and a quick tap still lasts
// long enough for the engine to hear it.

import { type LiveState, useLive, useStudio } from "./store.ts";

export type NoteSource = "key" | "midi" | "pointer";

/** About three model frames, so a tap is never shorter than one engine step. */
const MIN_TAP_MS = 120;

const FIELD: Record<NoteSource, "keyNotes" | "midiNotes" | "pointerNotes"> = {
  key: "keyNotes",
  midi: "midiNotes",
  pointer: "pointerNotes",
};

const pressedAt = new Map<string, number>();
const releaseTimers = new Map<string, number>();

function physical(live: LiveState): number {
  return (
    live.keyNotes.length + live.midiNotes.length + live.pointerNotes.length
  );
}

export function noteOn(note: number, source: NoteSource): void {
  if (note < 0 || note > 127) {
    return;
  }
  const field = FIELD[source];
  const tag = `${source}:${note}`;
  const timer = releaseTimers.get(tag);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    releaseTimers.delete(tag);
  }
  pressedAt.set(tag, performance.now());
  const live = useLive.getState();
  if (live[field].includes(note)) {
    return;
  }
  const next: Partial<LiveState> = { [field]: [...live[field], note] };
  if (useStudio.getState().hold) {
    // A fresh chord replaces the latched one. Adding while keys are down
    // stacks onto it.
    next.latched =
      physical(live) === 0 ? [note] : [...new Set([...live.latched, note])];
  }
  if (live.sustained.includes(note)) {
    next.sustained = live.sustained.filter((item) => item !== note);
  }
  useLive.setState(next);
}

function release(note: number, source: NoteSource): void {
  const field = FIELD[source];
  const live = useLive.getState();
  if (!live[field].includes(note)) {
    return;
  }
  const next: Partial<LiveState> = {
    [field]: live[field].filter((item) => item !== note),
  };
  if (live.sustain && !useStudio.getState().hold) {
    next.sustained = [...new Set([...live.sustained, note])];
  }
  useLive.setState(next);
}

export function noteOff(note: number, source: NoteSource): void {
  const tag = `${source}:${note}`;
  const held = performance.now() - (pressedAt.get(tag) ?? 0);
  pressedAt.delete(tag);
  if (held >= MIN_TAP_MS) {
    release(note, source);
    return;
  }
  releaseTimers.set(
    tag,
    window.setTimeout(() => {
      releaseTimers.delete(tag);
      release(note, source);
    }, MIN_TAP_MS - held)
  );
}

export function setSustain(down: boolean): void {
  if (down) {
    useLive.setState({ sustain: true });
    return;
  }
  useLive.setState({ sustain: false, sustained: [] });
}

/** Release everything, including latched chords and chord pads. */
export function allNotesOff(): void {
  for (const timer of releaseTimers.values()) {
    window.clearTimeout(timer);
  }
  releaseTimers.clear();
  pressedAt.clear();
  useLive.setState({
    keyNotes: [],
    latched: [],
    midiNotes: [],
    padNotes: [],
    pointerNotes: [],
    sustained: [],
  });
}

export function setHold(on: boolean): void {
  useStudio.getState().patch({ hold: on });
  if (!on) {
    useLive.setState({ latched: [] });
  }
}

// Ableton's computer keyboard, by physical key so other layouts still line
// up: the home row is white keys, the row above is black.
const CODE_TO_SEMI: Record<string, number> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
  Quote: 17,
};

const PUNCTUATION: Record<string, string> = { Quote: "'", Semicolon: ";" };

const SEMI_TO_LABEL = new Map(
  Object.entries(CODE_TO_SEMI).map(([code, semi]) => [
    semi,
    PUNCTUATION[code] ?? code.slice(3),
  ])
);

export function keyboardBase(octave: number): number {
  return (octave + 1) * 12;
}

/** The MIDI note for a key code like "KeyA", or null when it is not a note key. */
export function noteForCode(code: string, octave: number): number | null {
  const semi = CODE_TO_SEMI[code];
  if (semi === undefined) {
    return null;
  }
  return keyboardBase(octave) + semi;
}

export function keyLabel(note: number, octave: number): string | null {
  return SEMI_TO_LABEL.get(note - keyboardBase(octave)) ?? null;
}
