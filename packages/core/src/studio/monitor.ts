// One animation loop reads the analysers and shares the results with every
// visual on the stage: spectrum, chroma, the key guess, and the meters.

import { binPitchClasses, chromaFromSpectrum } from "./analysis.ts";
import type { MeterReading } from "./audio.ts";
import { engine } from "./engine.ts";
import { guessKey, type KeyGuess } from "./music.ts";

export interface MonitorFrame {
  /** Smoothed 0..1 chroma of the model's output. */
  chroma: Float32Array;
  /** True while sound is reaching the speakers. */
  hearing: boolean;
  key: KeyGuess | null;
  meter: MeterReading & { clipAt: number; holdL: number; holdR: number };
  /** Master analyser decibels, or null before audio starts. */
  spectrum: Float32Array | null;
  spectrumRate: number;
  time: number;
}

const frame: MonitorFrame = {
  chroma: new Float32Array(12),
  hearing: false,
  key: null,
  meter: {
    clipAt: 0,
    holdL: 0,
    holdR: 0,
    peakL: 0,
    peakR: 0,
    rmsL: 0,
    rmsR: 0,
  },
  spectrum: null,
  spectrumRate: 48_000,
  time: 0,
};

type Painter = (frame: MonitorFrame) => void;

const painters = new Set<Painter>();
const rawChroma = new Float32Array(12);
const longChroma = new Float32Array(12);
let modelBins: Float32Array | null = null;
let classes: Int8Array | null = null;
let raf = 0;
let lastKey = 0;
let wired: object | null = null;

function wireMeter(): void {
  const audio = engine.audio;
  if (!audio || wired === audio) {
    return;
  }
  wired = audio;
  audio.onMeter = (reading) => {
    const meter = frame.meter;
    const now = performance.now();
    meter.peakL = reading.peakL;
    meter.peakR = reading.peakR;
    meter.rmsL = reading.rmsL;
    meter.rmsR = reading.rmsR;
    meter.holdL = Math.max(reading.peakL, meter.holdL * 0.97);
    meter.holdR = Math.max(reading.peakR, meter.holdR * 0.97);
    if (reading.peakL >= 0.999 || reading.peakR >= 0.999) {
      meter.clipAt = now;
    }
  };
}

function analyse(time: number): void {
  const audio = engine.audio;
  frame.time = time;
  if (!audio) {
    frame.hearing = false;
    frame.spectrum = null;
    return;
  }
  wireMeter();
  const master = audio.masterAnalyser;
  if (!frame.spectrum || frame.spectrum.length !== master.frequencyBinCount) {
    frame.spectrum = new Float32Array(master.frequencyBinCount);
  }
  master.getFloatFrequencyData(frame.spectrum as Float32Array<ArrayBuffer>);
  frame.spectrumRate = audio.sampleRate;

  const model = audio.modelAnalyser;
  if (!modelBins || modelBins.length !== model.frequencyBinCount) {
    modelBins = new Float32Array(model.frequencyBinCount);
    classes = binPitchClasses(
      model.frequencyBinCount,
      audio.sampleRate,
      model.fftSize
    );
  }
  model.getFloatFrequencyData(modelBins as Float32Array<ArrayBuffer>);
  const energy = chromaFromSpectrum(modelBins, classes as Int8Array, rawChroma);
  frame.hearing = energy > 1e-7;
  for (let pc = 0; pc < 12; pc += 1) {
    const target = frame.hearing ? (rawChroma[pc] ?? 0) : 0;
    const current = frame.chroma[pc] ?? 0;
    frame.chroma[pc] = current + (target - current) * 0.18;
    longChroma[pc] = (longChroma[pc] ?? 0) * 0.995 + target * 0.005;
  }
  if (time - lastKey > 500) {
    lastKey = time;
    frame.key = frame.hearing ? guessKey(longChroma) : frame.key;
  }
}

function loop(time: number): void {
  analyse(time);
  for (const painter of painters) {
    painter(frame);
  }
  raf = window.requestAnimationFrame(loop);
}

/** Paint on every animation frame. Returns the unsubscribe. */
export function onFrame(painter: Painter): () => void {
  painters.add(painter);
  if (painters.size === 1) {
    raf = window.requestAnimationFrame(loop);
  }
  return () => {
    painters.delete(painter);
    if (painters.size === 0) {
      window.cancelAnimationFrame(raf);
    }
  };
}

export function currentFrame(): MonitorFrame {
  return frame;
}
