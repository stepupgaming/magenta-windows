import { describe, expect, it } from "vitest";
import {
  diatonicChords,
  guessKey,
  noteName,
  parseChord,
  parseProgression,
  voiceChord,
} from "./music.ts";

describe("parseChord", () => {
  it("reads roots, accidentals, and qualities", () => {
    expect(parseChord("Am7")).toMatchObject({
      intervals: [0, 3, 7, 10],
      root: 9,
    });
    expect(parseChord("Bb")).toMatchObject({ intervals: [0, 4, 7], root: 10 });
    expect(parseChord("F#dim")).toMatchObject({
      intervals: [0, 3, 6],
      root: 6,
    });
    expect(parseChord("Cmaj7")?.symbol).toBe("Cmaj7");
  });

  it("accepts common aliases", () => {
    expect(parseChord("C-7")?.intervals).toEqual([0, 3, 7, 10]);
    expect(parseChord("CM7")?.intervals).toEqual([0, 4, 7, 11]);
  });

  it("rejects what it cannot read", () => {
    expect(parseChord("H")).toBeNull();
    expect(parseChord("Cxyz")).toBeNull();
  });
});

describe("parseProgression", () => {
  it("splits on spaces, commas, bars, and lone dashes", () => {
    const chords = parseProgression("Am | F, C - G");
    expect(chords.map((chord) => chord.symbol)).toEqual(["Am", "F", "C", "G"]);
  });
});

describe("voiceChord", () => {
  it("packs tones above the floor with a bass note an octave down", () => {
    const chord = parseChord("C");
    expect(chord).not.toBeNull();
    if (chord) {
      expect(voiceChord(chord, 52)).toEqual([48, 60, 64, 67]);
    }
  });
});

describe("diatonicChords", () => {
  it("gives the seven triads of A minor", () => {
    expect(diatonicChords(9, "minor").map((chord) => chord.symbol)).toEqual([
      "Am",
      "Bdim",
      "C",
      "Dm",
      "Em",
      "F",
      "G",
    ]);
  });
});

describe("guessKey", () => {
  it("finds C major from its scale", () => {
    const chroma = [1, 0, 0.8, 0, 0.9, 0.7, 0, 1, 0, 0.7, 0, 0.5];
    expect(guessKey(chroma)?.label).toBe("C major");
  });

  it("stays quiet on a flat spectrum", () => {
    expect(guessKey(Array.from({ length: 12 }, () => 1))).toBeNull();
  });
});

describe("noteName", () => {
  it("uses scientific pitch", () => {
    expect(noteName(60)).toBe("C4");
    expect(noteName(69)).toBe("A4");
  });
});
