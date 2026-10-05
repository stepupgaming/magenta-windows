import { describe, expect, it } from "vitest";
import { noteForCode } from "../notes.ts";
import { KEY_ACTIONS } from "./hotkeys.ts";

const OTHER_KEYS = [
  "KeyQ",
  "KeyZ",
  "KeyX",
  "Space",
  "Escape",
  "Digit1",
  "Digit8",
];

describe("stage hotkeys", () => {
  it("never steal a key the piano needs", () => {
    for (const code of [...Object.keys(KEY_ACTIONS), ...OTHER_KEYS]) {
      expect(noteForCode(code, 3), code).toBeNull();
    }
  });

  it("play the Ableton layout from the home row", () => {
    expect(noteForCode("KeyA", 3)).toBe(48);
    expect(noteForCode("KeyW", 3)).toBe(49);
    expect(noteForCode("KeyK", 3)).toBe(60);
    expect(noteForCode("Quote", 3)).toBe(65);
  });
});
