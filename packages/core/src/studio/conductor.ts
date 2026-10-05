// The conductor keeps the engine, the audio graph, and the studio state in
// step: it steers the model, applies effects, gates Solo, runs scene morphs,
// and advances the chord progression.

import { engine } from "./engine.ts";
import { parseProgression, voiceChord } from "./music.ts";
import { blendScenes, ease, snapshot } from "./scenes.ts";
import { buildSpec, type WireSpec } from "./spec.ts";
import {
  heldNotes,
  isPlaying,
  type LiveState,
  useLive,
  useStudio,
} from "./store.ts";

const STEER_EVERY = 40;
const PROGRESSION_FLOOR = 52;

let cutPending = false;

export function currentSpec(): WireSpec {
  const live = useLive.getState();
  return buildSpec(useStudio.getState(), {
    audition: live.audition,
    chaos: live.chaos,
    held: heldNotes(live),
    uploaded: engine.uploads,
  });
}

export function steerNow(): void {
  if (!isPlaying(useLive.getState().phase)) {
    cutPending = false;
    return;
  }
  const cut = cutPending;
  cutPending = false;
  engine.steer(currentSpec(), cut);
}

export function play(): void {
  engine.play(currentSpec).catch(() => undefined);
}

export function togglePlay(): void {
  const phase = useLive.getState().phase;
  if (phase === "live" || phase === "restarting" || phase === "starting") {
    engine.stop();
    return;
  }
  play();
}

/** New seed, fresh model memory. */
export function reroll(): void {
  const seed = Math.floor(Math.random() * 1_000_000);
  useStudio.getState().patch({ seed });
  engine.restart(currentSpec());
}

/** Apply pending seed and choices with a fresh stream. */
export function freshStart(): void {
  engine.restart(currentSpec());
}

// ---- Scenes --------------------------------------------------------------

export function saveScene(slot: number): void {
  const studio = useStudio.getState();
  const scenes = [...studio.scenes];
  scenes[slot] = snapshot(studio);
  studio.patch({ scenes });
  useLive.setState({ activeScene: slot });
}

export function clearScene(slot: number): void {
  const studio = useStudio.getState();
  const scenes = [...studio.scenes];
  scenes[slot] = null;
  studio.patch({ scenes });
  if (useLive.getState().activeScene === slot) {
    useLive.setState({ activeScene: null });
  }
}

export function recallScene(slot: number, transition?: "cut" | "morph"): void {
  const studio = useStudio.getState();
  const scene = studio.scenes[slot];
  if (!scene) {
    saveScene(slot);
    return;
  }
  const mode = transition ?? studio.transition;
  const beats = studio.morphBeats;
  if (mode === "cut" || beats <= 0) {
    useLive.setState({ activeScene: slot, morph: null, morphProgress: 0 });
    studio.patch(blendScenes(scene, scene, 1));
    cutPending = true;
    steerNow();
    return;
  }
  useLive.setState({
    activeScene: slot,
    morph: {
      duration: (beats * 60_000) / Math.max(30, studio.bpm),
      from: snapshot(studio),
      slot,
      start: performance.now(),
      to: scene,
    },
    morphProgress: 0,
  });
}

function morphStep(now: number): boolean {
  const morph = useLive.getState().morph;
  if (!morph) {
    return false;
  }
  const t = Math.min(1, (now - morph.start) / morph.duration);
  useStudio
    .getState()
    .patch(blendScenes(morph.from, morph.to, t >= 1 ? 1 : ease(t)));
  if (t >= 1) {
    useLive.setState({ morph: null, morphProgress: 0 });
    return false;
  }
  useLive.setState({ morphProgress: t });
  return true;
}

// ---- Chord progression ----------------------------------------------------

let progressionStart = 0;

export function startProgression(): void {
  const chords = parseProgression(useStudio.getState().progression);
  if (chords.length === 0) {
    return;
  }
  progressionStart = performance.now();
  const first = chords[0];
  useLive.setState({
    progressionIndex: 0,
    progressionNotes: first ? voiceChord(first, PROGRESSION_FLOOR) : [],
    progressionRunning: true,
  });
}

export function stopProgression(): void {
  useLive.setState({
    progressionIndex: 0,
    progressionNotes: [],
    progressionRunning: false,
  });
}

export function toggleProgression(): void {
  if (useLive.getState().progressionRunning) {
    stopProgression();
  } else {
    startProgression();
  }
}

/** Beats into the current chord, for the progress ring. */
export function progressionPhase(now: number): { beat: number; index: number } {
  const studio = useStudio.getState();
  const beatMs = 60_000 / Math.max(30, studio.bpm);
  const beats = (now - progressionStart) / beatMs;
  const per = Math.max(1, studio.progressionBeats);
  const count = Math.max(1, parseProgression(studio.progression).length);
  return { beat: beats % per, index: Math.floor(beats / per) % count };
}

function progressionStep(now: number): void {
  const live = useLive.getState();
  if (!live.progressionRunning) {
    return;
  }
  const chords = parseProgression(useStudio.getState().progression);
  if (chords.length === 0) {
    stopProgression();
    return;
  }
  const { index } = progressionPhase(now);
  if (index !== live.progressionIndex || live.progressionNotes.length === 0) {
    const chord = chords[index % chords.length];
    useLive.setState({
      progressionIndex: index,
      progressionNotes: chord ? voiceChord(chord, PROGRESSION_FLOOR) : [],
    });
  }
}

// ---- Tap tempo -----------------------------------------------------------

let taps: number[] = [];

export function tapTempo(): number | null {
  const now = performance.now();
  taps = [...taps.filter((time) => now - time < 2500), now];
  if (taps.length < 2) {
    return null;
  }
  const gaps = taps.slice(1).map((time, index) => time - (taps[index] ?? time));
  const average = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const bpm = Math.round(60_000 / average);
  if (bpm >= 40 && bpm <= 220) {
    useStudio.getState().patch({ bpm });
    return bpm;
  }
  return null;
}

// ---- The loop -------------------------------------------------------------

function sameNotes(a: LiveState, b: LiveState): boolean {
  return (
    a.pointerNotes === b.pointerNotes &&
    a.keyNotes === b.keyNotes &&
    a.midiNotes === b.midiNotes &&
    a.latched === b.latched &&
    a.sustained === b.sustained &&
    a.padNotes === b.padNotes &&
    a.progressionNotes === b.progressionNotes
  );
}

function applyGate(): void {
  const audio = engine.audio;
  if (!audio) {
    return;
  }
  const studio = useStudio.getState();
  const live = useLive.getState();
  if (
    studio.noteMode !== "solo" ||
    !studio.gate ||
    heldNotes(live).length > 0
  ) {
    audio.setGate(true);
    return;
  }
  // The model answers about one cushion later, so close after that.
  audio.setGate(false, live.stats.queued + audio.outputLatency);
}

function applyFx(): void {
  const audio = engine.audio;
  if (!audio) {
    return;
  }
  const studio = useStudio.getState();
  audio.setFx(studio.fx, studio.bpm);
  audio.setVolume(studio.volume);
}

/** Start the conductor. Returns the stop function. */
export function startConductor(): () => void {
  const timer = window.setInterval(() => {
    steerNow();
  }, STEER_EVERY);

  let raf = 0;
  const frame = (now: number) => {
    morphStep(now);
    progressionStep(now);
    raf = window.requestAnimationFrame(frame);
  };
  raf = window.requestAnimationFrame(frame);

  const offLive = useLive.subscribe((live, previous) => {
    if (live.audition !== previous.audition) {
      // Auditions jump straight to the new style instead of gliding.
      cutPending = true;
      steerNow();
    }
    if (!sameNotes(live, previous)) {
      // Notes are the most latency sensitive input. Send them at once.
      steerNow();
      applyGate();
    }
    if (live.phase !== previous.phase && isPlaying(live.phase)) {
      applyFx();
      applyGate();
    }
  });

  const offStudio = useStudio.subscribe((studio, previous) => {
    if (
      studio.fx !== previous.fx ||
      studio.volume !== previous.volume ||
      studio.bpm !== previous.bpm
    ) {
      applyFx();
    }
    if (studio.bufferSeconds !== previous.bufferSeconds) {
      engine.audio?.setTarget(studio.bufferSeconds);
    }
    if (
      studio.noteMode !== previous.noteMode ||
      studio.gate !== previous.gate
    ) {
      applyGate();
    }
    if (
      studio.prompts !== previous.prompts &&
      isPlaying(useLive.getState().phase)
    ) {
      const missing = studio.prompts.filter(
        (prompt) =>
          prompt.kind === "audio" &&
          prompt.clipKey &&
          !engine.uploads.has(prompt.clipKey)
      );
      for (const prompt of missing) {
        engine
          .uploadClip(prompt.clipKey ?? "")
          .then(() => steerNow())
          .catch(() => undefined);
      }
    }
  });

  return () => {
    window.clearInterval(timer);
    window.cancelAnimationFrame(raf);
    offLive();
    offStudio();
  };
}
