// Computer keyboard for the stage: notes on the home rows, single keys for
// performance actions, and Ctrl/Cmd+K for the palette.

import { useEffect } from "react";
import {
  allNotesOff,
  noteForCode,
  noteOff,
  noteOn,
  setHold,
} from "../notes.ts";
import { runAction } from "../params.ts";
import { useLive, useStudio } from "../store.ts";

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/** Single keys that run a registered action. */
export const KEY_ACTIONS: Record<string, string> = {
  Backspace: "continue.rewind",
  KeyB: "tempo.tap",
  KeyC: "takes.keep30",
  KeyM: "midi.learn",
  KeyN: "prompt.focus",
  KeyR: "takes.record",
  KeyV: "style.mode",
  Slash: "library.open",
};

export const SHORTCUT_LABELS: Record<string, string> = {
  "continue.rewind": "Backspace",
  "help.open": "?",
  "library.open": "/",
  "midi.learn": "M",
  "notes.hold": "Q",
  "notes.release": "Esc",
  "palette.open": "Ctrl K",
  "prompt.focus": "N",
  "style.mode": "V",
  "takes.keep30": "C",
  "takes.record": "R",
  "tempo.tap": "B",
  "transport.play": "Space",
};

/** Leave modified keys, text fields, and open dialogs alone. */
function ignored(event: KeyboardEvent): boolean {
  return (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    typing(event.target) ||
    document.querySelector("[role=dialog]") !== null
  );
}

function sceneKey(event: KeyboardEvent): boolean {
  if (!event.code.startsWith("Digit")) {
    return false;
  }
  const slot = Number(event.code.slice(5));
  if (slot >= 1 && slot <= 8) {
    event.preventDefault();
    runAction(event.shiftKey ? `scene.save.${slot}` : `scene.${slot}`);
  }
  return true;
}

function noteKey(event: KeyboardEvent): boolean {
  const studio = useStudio.getState();
  if (event.code === "Escape") {
    allNotesOff();
    useLive.setState({ learn: false, learnTarget: null });
    return true;
  }
  if (event.code === "KeyQ") {
    setHold(!studio.hold);
    return true;
  }
  if (event.code === "KeyZ" || event.code === "KeyX") {
    const step = event.code === "KeyZ" ? -1 : 1;
    studio.patch({ octave: Math.min(8, Math.max(0, studio.octave + step)) });
    return true;
  }
  return false;
}

function performKey(event: KeyboardEvent, onHelp: () => void): void {
  if (event.code === "Space") {
    event.preventDefault();
    runAction("transport.play");
    return;
  }
  if (event.key === "?") {
    onHelp();
    return;
  }
  if (sceneKey(event) || noteKey(event)) {
    return;
  }
  const action = KEY_ACTIONS[event.code];
  if (action) {
    event.preventDefault();
    runAction(action);
  }
}

export function useStageHotkeys(
  onPalette: () => void,
  onHelp: () => void
): void {
  useEffect(() => {
    const held = new Map<string, number>();

    const down = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyK") {
        event.preventDefault();
        onPalette();
        return;
      }
      if (ignored(event)) {
        return;
      }
      const studio = useStudio.getState();
      const note = noteForCode(event.code, studio.octave);
      if (note !== null && !event.shiftKey) {
        event.preventDefault();
        if (!(event.repeat || held.has(event.code))) {
          held.set(event.code, note);
          noteOn(note, "key");
        }
        return;
      }
      if (!event.repeat) {
        performKey(event, onHelp);
      }
    };

    const up = (event: KeyboardEvent) => {
      const note = held.get(event.code);
      if (note !== undefined) {
        held.delete(event.code);
        noteOff(note, "key");
      }
    };

    const blur = () => {
      for (const note of held.values()) {
        noteOff(note, "key");
      }
      held.clear();
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [onPalette, onHelp]);
}
