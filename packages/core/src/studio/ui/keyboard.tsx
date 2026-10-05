"use client";

import { cn } from "@workspace/ui/lib/utils";
import type { PointerEvent } from "react";
import { useEffect, useMemo, useRef } from "react";
import useMeasure from "react-use-measure";
import { onFrame } from "../monitor.ts";
import { isBlackKey, noteName, scaleNotes } from "../music.ts";
import { keyboardBase, keyLabel, noteOff, noteOn } from "../notes.ts";
import { useLive, useStudio } from "../store.ts";

const WHITE_WIDTH = 30;
const MIN_OCTAVES = 2;
const MAX_OCTAVES = 7;

/** Left edge of a black key, in white-key widths from the octave start. */
const BLACK_OFFSET: Record<number, number> = {
  1: 0.68,
  3: 1.72,
  6: 3.66,
  8: 4.7,
  10: 5.74,
};
const WHITE_INDEX: Record<number, number> = {
  0: 0,
  2: 1,
  4: 2,
  5: 3,
  7: 4,
  9: 5,
  11: 6,
};

type KeyState = "chord" | "held" | "idle" | "latched";

function useKeyStates(): Map<number, KeyState> {
  const pointer = useLive((state) => state.pointerNotes);
  const keys = useLive((state) => state.keyNotes);
  const midi = useLive((state) => state.midiNotes);
  const latched = useLive((state) => state.latched);
  const sustained = useLive((state) => state.sustained);
  const pads = useLive((state) => state.padNotes);
  const progression = useLive((state) => state.progressionNotes);
  return useMemo(() => {
    const states = new Map<number, KeyState>();
    for (const note of [...pads, ...progression]) {
      states.set(note, "chord");
    }
    for (const note of [...latched, ...sustained]) {
      states.set(note, "latched");
    }
    for (const note of [...pointer, ...keys, ...midi]) {
      states.set(note, "held");
    }
    return states;
  }, [pointer, keys, midi, latched, sustained, pads, progression]);
}

export function Keyboard({ className }: { className?: string }) {
  const [measure, bounds] = useMeasure();
  const octave = useStudio((state) => state.octave);
  const labels = useStudio((state) => state.keyLabels);
  const keyRoot = useStudio((state) => state.keyRoot);
  const keyFlavor = useStudio((state) => state.keyFlavor);
  const states = useKeyStates();
  const glows = useRef(new Map<number, HTMLSpanElement>());
  const pointers = useRef(new Map<number, number>());

  const octaves = Math.min(
    MAX_OCTAVES,
    Math.max(MIN_OCTAVES, Math.floor(bounds.width / (WHITE_WIDTH * 7)))
  );
  const below = Math.floor((octaves - 2) / 2);
  const start = Math.max(0, keyboardBase(octave) - below * 12);
  const end = Math.min(127, start + octaves * 12);
  const whites = ((end - start) / 12) * 7 + 1;
  const width = 100 / whites;
  const inScale = useMemo(
    () => scaleNotes(keyRoot, keyFlavor),
    [keyRoot, keyFlavor]
  );

  const notes = useMemo(() => {
    const list: number[] = [];
    for (let note = start; note <= end; note += 1) {
      list.push(note);
    }
    return list;
  }, [start, end]);

  useEffect(
    () =>
      onFrame((frame) => {
        for (const [note, node] of glows.current) {
          const value = frame.chroma[note % 12] ?? 0;
          node.style.opacity = `${value > 0.35 ? (value - 0.35) * 1.5 : 0}`;
        }
      }),
    []
  );

  const noteAt = (event: PointerEvent): number | null => {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const value =
      target instanceof HTMLElement ? target.dataset.note : undefined;
    return value === undefined ? null : Number(value);
  };

  const press = (event: PointerEvent<HTMLDivElement>) => {
    const note = noteAt(event);
    const previous = pointers.current.get(event.pointerId);
    if (note === previous) {
      return;
    }
    if (previous !== undefined) {
      noteOff(previous, "pointer");
      pointers.current.delete(event.pointerId);
    }
    if (note !== null) {
      noteOn(note, "pointer");
      pointers.current.set(event.pointerId, note);
    }
  };

  const lift = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (previous !== undefined) {
      noteOff(previous, "pointer");
      pointers.current.delete(event.pointerId);
    }
  };

  const keyColor = (state: KeyState | undefined, black: boolean): string => {
    if (state === "held") {
      // White keys rise above their white neighbors for the glow, but stay
      // under the black keys.
      return black
        ? "bg-[#fff4e6] shadow-[0_0_26px_#ff8a1f]"
        : "z-[5] bg-[#fff4e6] shadow-[0_0_26px_#ff8a1f]";
    }
    if (state === "latched") {
      return black
        ? "bg-[#ffd9b0] shadow-[0_0_16px_#ff8a1f99]"
        : "bg-[#ffe2c2] shadow-[0_0_16px_#ff8a1f99]";
    }
    if (state === "chord") {
      return black ? "bg-[#d99a2b]" : "bg-[#ffe08a]";
    }
    return black ? "bg-[#141216]" : "bg-[#ff8a1f]";
  };

  return (
    <div
      className={cn("relative h-full touch-none select-none", className)}
      onPointerCancel={lift}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        press(event);
      }}
      onPointerLeave={lift}
      onPointerMove={(event) => {
        if (pointers.current.has(event.pointerId) && event.buttons === 1) {
          press(event);
        }
      }}
      onPointerUp={lift}
      ref={measure}
    >
      {notes
        .filter((note) => !isBlackKey(note))
        .map((note) => {
          const index =
            Math.floor((note - start) / 12) * 7 + (WHITE_INDEX[note % 12] ?? 0);
          const state = states.get(note);
          const label = labels ? keyLabel(note, octave) : null;
          return (
            <div
              className={cn(
                "absolute top-0 bottom-0 rounded-b-md border border-black/60 transition-[background-color,box-shadow] duration-75",
                keyColor(state, false)
              )}
              data-note={note}
              key={note}
              style={{ left: `${index * width}%`, width: `${width}%` }}
            >
              <span
                className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[#ff4c8d] opacity-0"
                ref={(node) => {
                  if (node) {
                    glows.current.set(note, node);
                  } else {
                    glows.current.delete(note);
                  }
                }}
              />
              {inScale.has(note % 12) && !state ? (
                <span className="pointer-events-none absolute bottom-6 left-1/2 size-1 -translate-x-1/2 rounded-full bg-black/30" />
              ) : null}
              <span className="pointer-events-none absolute inset-x-0 bottom-1 flex flex-col items-center gap-0.5 font-mono text-[9px] text-black/55 leading-none">
                {label ? (
                  <span className="font-semibold text-black/70">{label}</span>
                ) : null}
                {note % 12 === 0 ? <span>{noteName(note)}</span> : null}
              </span>
            </div>
          );
        })}
      {notes.filter(isBlackKey).map((note) => {
        const octaveIndex = Math.floor((note - start) / 12);
        const left = (octaveIndex * 7 + (BLACK_OFFSET[note % 12] ?? 0)) * width;
        const state = states.get(note);
        const label = labels ? keyLabel(note, octave) : null;
        return (
          <div
            className={cn(
              "absolute top-0 z-10 h-[60%] rounded-b-md border border-black transition-[background-color,box-shadow] duration-75",
              keyColor(state, true)
            )}
            data-note={note}
            key={note}
            style={{ left: `${left}%`, width: `${width * 0.62}%` }}
          >
            <span
              className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[#ff4c8d] opacity-0"
              ref={(node) => {
                if (node) {
                  glows.current.set(note, node);
                } else {
                  glows.current.delete(note);
                }
              }}
            />
            {label ? (
              <span className="pointer-events-none absolute inset-x-0 bottom-1 text-center font-mono font-semibold text-[9px] text-white/45">
                {label}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
