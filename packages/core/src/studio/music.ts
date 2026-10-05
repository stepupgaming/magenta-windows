// Music theory for the notes dock: names, scales, chord symbols, voicings.
// Everything here is pure so the stage, MIDI, and progression code share it.

export const PITCH_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

const FLAT_TO_SHARP: Record<string, string> = {
  Ab: "G#",
  Bb: "A#",
  Cb: "B",
  Db: "C#",
  Eb: "D#",
  Fb: "E",
  Gb: "F#",
};

export function noteName(midi: number): string {
  const pitch = PITCH_NAMES[((midi % 12) + 12) % 12] ?? "C";
  const octave = Math.floor(midi / 12) - 1;
  return `${pitch}${octave}`;
}

export function isBlackKey(midi: number): boolean {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  "minor pentatonic": [0, 3, 5, 7, 10],
  "harmonic minor": [0, 2, 3, 5, 7, 8, 11],
} as const;

export type ScaleName = keyof typeof SCALES;

export const SCALE_NAMES = Object.keys(SCALES) as ScaleName[];

const QUALITIES: Record<string, readonly number[]> = {
  "": [0, 4, 7],
  "5": [0, 7],
  "6": [0, 4, 7, 9],
  "7": [0, 4, 7, 10],
  "9": [0, 4, 7, 10, 14],
  add9: [0, 4, 7, 14],
  aug: [0, 4, 8],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  m: [0, 3, 7],
  m6: [0, 3, 7, 9],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  m9: [0, 3, 7, 10, 14],
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
};

const QUALITY_ALIASES: Record<string, string> = {
  "+": "aug",
  "-": "m",
  "-7": "m7",
  M7: "maj7",
  min: "m",
  min7: "m7",
  "°": "dim",
  ø: "m7b5",
};

export interface Chord {
  /** Intervals above the root in semitones. */
  intervals: readonly number[];
  /** Pitch class of the root, 0 = C. */
  root: number;
  /** Canonical symbol, for example "Am7". */
  symbol: string;
}

const CHORD_PATTERN = /^([A-Ga-g])([#b]?)(.*)$/;
const PROGRESSION_SEPARATOR = /[\s,|]+/;

export function parseChord(raw: string): Chord | null {
  const match = CHORD_PATTERN.exec(raw.trim());
  if (!match) {
    return null;
  }
  const letter = (match[1] ?? "C").toUpperCase();
  const accidental = match[2] ?? "";
  const rest = match[3] ?? "";
  let name = `${letter}${accidental}`;
  name = FLAT_TO_SHARP[name] ?? name;
  if (name === "E#") {
    name = "F";
  }
  if (name === "B#") {
    name = "C";
  }
  const root = PITCH_NAMES.indexOf(name as (typeof PITCH_NAMES)[number]);
  if (root < 0) {
    return null;
  }
  const quality = QUALITY_ALIASES[rest] ?? rest;
  const intervals = QUALITIES[quality];
  if (!intervals) {
    return null;
  }
  return { intervals, root, symbol: `${letter}${accidental}${quality}` };
}

export function parseProgression(raw: string): Chord[] {
  const chords: Chord[] = [];
  for (const token of raw.split(PROGRESSION_SEPARATOR)) {
    if (!token || token === "-" || token === "–") {
      continue;
    }
    const chord = parseChord(token);
    if (chord) {
      chords.push(chord);
    }
  }
  return chords;
}

export function formatProgression(chords: readonly Chord[]): string {
  return chords.map((chord) => chord.symbol).join(" ");
}

/**
 * Voice a chord as MIDI notes: the root an octave down as a bass anchor,
 * then the chord tones packed upward from the register floor.
 */
export function voiceChord(chord: Chord, floor = 52, bass = true): number[] {
  const notes = new Set<number>();
  let base = floor - ((((floor - chord.root) % 12) + 12) % 12);
  if (base < floor) {
    base += 12;
  }
  for (const interval of chord.intervals) {
    notes.add(base + interval);
  }
  if (bass) {
    notes.add(base - 12);
  }
  return [...notes]
    .filter((note) => note >= 0 && note < 128)
    .sort((a, b) => a - b);
}

const DIATONIC_QUALITY: Record<"major" | "minor", string[]> = {
  major: ["", "m", "m", "", "", "m", "dim"],
  minor: ["m", "dim", "", "m", "m", "", ""],
};

/** The seven diatonic triads of a key, for the chord pads. */
export function diatonicChords(
  root: number,
  flavor: "major" | "minor"
): Chord[] {
  const steps = SCALES[flavor];
  return steps.map((step, index) => {
    const pc = (root + step) % 12;
    const quality = DIATONIC_QUALITY[flavor][index] ?? "";
    const symbol = `${PITCH_NAMES[pc] ?? "C"}${quality}`;
    return parseChord(symbol) ?? { intervals: [0, 4, 7], root: pc, symbol };
  });
}

export const ROMAN_MAJOR = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
export const ROMAN_MINOR = ["i", "ii°", "III", "iv", "v", "VI", "VII"];

export function scaleNotes(root: number, scale: ScaleName): Set<number> {
  return new Set(SCALES[scale].map((step) => (root + step) % 12));
}

export interface ProgressionPreset {
  chords: string;
  label: string;
}

export const PROGRESSION_PRESETS: ProgressionPreset[] = [
  { chords: "C G Am F", label: "Pop I–V–vi–IV" },
  { chords: "Am F C G", label: "Anthem vi–IV–I–V" },
  { chords: "Dm7 G7 Cmaj7 Cmaj7", label: "Jazz ii–V–I" },
  { chords: "Am G F E", label: "Andalusian" },
  { chords: "Fmaj7 Em7 Dm7 Cmaj7", label: "Neo-soul descent" },
  { chords: "Cm Ab Eb Bb", label: "Epic minor" },
  { chords: "Dm Bb F C", label: "Dark pop" },
  { chords: "Cmaj7 Am7 Dm7 G7", label: "Turnaround" },
  { chords: "Em C G D", label: "Open road" },
  { chords: "Am7 D9 Am7 D9", label: "Dorian vamp" },
];

/**
 * Estimate the key from a 12-bin chroma using Krumhansl profiles.
 * Returns null when the signal is too flat to call.
 */
const MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

function correlate(
  chroma: ArrayLike<number>,
  profile: number[],
  shift: number
): number {
  let meanA = 0;
  let meanB = 0;
  for (let index = 0; index < 12; index += 1) {
    meanA += chroma[index] ?? 0;
    meanB += profile[index] ?? 0;
  }
  meanA /= 12;
  meanB /= 12;
  let top = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < 12; index += 1) {
    const a = (chroma[(index + shift) % 12] ?? 0) - meanA;
    const b = (profile[index] ?? 0) - meanB;
    top += a * b;
    left += a * a;
    right += b * b;
  }
  const bottom = Math.sqrt(left * right);
  return bottom > 0 ? top / bottom : 0;
}

export interface KeyGuess {
  confidence: number;
  label: string;
  minor: boolean;
  root: number;
}

export function guessKey(chroma: ArrayLike<number>): KeyGuess | null {
  let best: KeyGuess | null = null;
  for (let root = 0; root < 12; root += 1) {
    for (const minor of [false, true]) {
      const score = correlate(
        chroma,
        minor ? MINOR_PROFILE : MAJOR_PROFILE,
        root
      );
      if (!best || score > best.confidence) {
        const name = PITCH_NAMES[root] ?? "C";
        best = {
          confidence: score,
          label: `${name} ${minor ? "minor" : "major"}`,
          minor,
          root,
        };
      }
    }
  }
  if (!best || best.confidence < 0.55) {
    return null;
  }
  return best;
}
