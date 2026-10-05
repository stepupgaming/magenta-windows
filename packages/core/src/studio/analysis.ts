// Pitch analysis of the model's output for the chroma display and the
// keyboard glow.

const LOWEST_HZ = 60;
const HIGHEST_HZ = 2400;

/** Pitch class of every FFT bin in the musical range, -1 outside it. */
export function binPitchClasses(
  bins: number,
  sampleRate: number,
  fftSize: number
): Int8Array {
  const classes = new Int8Array(bins).fill(-1);
  for (let bin = 1; bin < bins; bin += 1) {
    const hz = (bin * sampleRate) / fftSize;
    if (hz < LOWEST_HZ || hz > HIGHEST_HZ) {
      continue;
    }
    const midi = 69 + 12 * Math.log2(hz / 440);
    classes[bin] = ((Math.round(midi) % 12) + 12) % 12;
  }
  return classes;
}

/**
 * Twelve-bin chroma from analyser decibels, written into `out` and
 * normalized so the strongest pitch class is 1.
 */
export function chromaFromSpectrum(
  decibels: Float32Array,
  classes: Int8Array,
  out: Float32Array
): number {
  out.fill(0);
  let total = 0;
  for (let bin = 0; bin < decibels.length; bin += 1) {
    const pc = classes[bin] ?? -1;
    if (pc < 0) {
      continue;
    }
    const db = decibels[bin] ?? -140;
    if (db < -90) {
      continue;
    }
    const energy = 10 ** (db / 10);
    out[pc] = (out[pc] ?? 0) + energy;
    total += energy;
  }
  let loudest = 0;
  for (let pc = 0; pc < 12; pc += 1) {
    loudest = Math.max(loudest, out[pc] ?? 0);
  }
  if (loudest > 0) {
    for (let pc = 0; pc < 12; pc += 1) {
      out[pc] = Math.sqrt((out[pc] ?? 0) / loudest);
    }
  }
  return total;
}
