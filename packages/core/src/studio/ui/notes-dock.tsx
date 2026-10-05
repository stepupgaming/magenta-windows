"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Pause,
  Play,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { progressionPhase, toggleProgression } from "../conductor.ts";
import {
  diatonicChords,
  noteName,
  PITCH_NAMES,
  PROGRESSION_PRESETS,
  parseProgression,
  ROMAN_MAJOR,
  ROMAN_MINOR,
  voiceChord,
} from "../music.ts";
import { allNotesOff, setHold } from "../notes.ts";
import { heldNotes, useLive, useStudio } from "../store.ts";
import { Keyboard } from "./keyboard.tsx";
import { Hint, SectionLabel, Segmented, Toggle } from "./kit.tsx";

const PAD_FLOOR = 52;
const BEATS = [2, 4, 8, 16];

function heldSummary(held: number[], mode: "jam" | "solo"): string {
  if (held.length > 0) {
    return held.map(noteName).join(" ");
  }
  return mode === "solo"
    ? "Silent until you play"
    : "Free. The model picks the notes.";
}

function NoteControls() {
  const noteMode = useStudio((state) => state.noteMode);
  const hold = useStudio((state) => state.hold);
  const strum = useStudio((state) => state.strum);
  const clearance = useStudio((state) => state.clearance);
  const gate = useStudio((state) => state.gate);
  const octave = useStudio((state) => state.octave);
  const patch = useStudio((state) => state.patch);
  const held = useLive(useShallow(heldNotes));

  return (
    <div className="flex w-[232px] shrink-0 flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <SectionLabel>Notes</SectionLabel>
        <Segmented
          ariaLabel="Note mode"
          onChange={(value) => patch({ noteMode: value })}
          options={[
            {
              hint: "The model accompanies the notes you hold and adds its own",
              label: "Jam",
              value: "jam",
            },
            {
              hint: "Only the notes you hold sound. Nothing plays between them.",
              label: "Solo",
              value: "solo",
            },
          ]}
          size="sm"
          value={noteMode}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Toggle
          active={hold}
          color="#ff8a1f"
          hint="Latch chords. A new chord replaces the last one."
          keys="Q"
          learnId="notes.hold"
          onClick={() => setHold(!hold)}
        >
          Hold
        </Toggle>
        <Toggle
          active={strum}
          color="#ffc23c"
          hint="Held notes may re-strike, bow, or arpeggiate. Off, each press is one attack that sustains."
          onClick={() => patch({ strum: !strum })}
        >
          Strum
        </Toggle>
        {noteMode === "solo" ? (
          <Toggle
            active={gate}
            color="#84f3ed"
            hint="Fade the output out about a second after you let go"
            onClick={() => patch({ gate: !gate })}
          >
            Gate
          </Toggle>
        ) : (
          <Hint label="Semitones around your notes the model leaves silent, so it does not clash">
            <div className="flex h-7 items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] px-1 text-white/65 text-xs">
              <button
                aria-label="Less clearance"
                className="size-5 rounded-full hover:bg-white/10"
                onClick={() => patch({ clearance: Math.max(0, clearance - 1) })}
                type="button"
              >
                −
              </button>
              <span className="w-12 text-center font-mono text-[11px] tabular-nums">
                ±{clearance} st
              </span>
              <button
                aria-label="More clearance"
                className="size-5 rounded-full hover:bg-white/10"
                onClick={() =>
                  patch({ clearance: Math.min(12, clearance + 1) })
                }
                type="button"
              >
                +
              </button>
            </div>
          </Hint>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex h-7 items-center rounded-full border border-white/[0.08] bg-white/[0.03]">
          <Hint keys="Z" label="Octave down">
            <button
              aria-label="Octave down"
              className="flex size-7 items-center justify-center rounded-full text-white/60 hover:text-white"
              onClick={() => patch({ octave: Math.max(0, octave - 1) })}
              type="button"
            >
              <ChevronLeft className="size-3.5" />
            </button>
          </Hint>
          <span className="w-8 text-center font-mono text-[11px] text-white/80">
            C{octave}
          </span>
          <Hint keys="X" label="Octave up">
            <button
              aria-label="Octave up"
              className="flex size-7 items-center justify-center rounded-full text-white/60 hover:text-white"
              onClick={() => patch({ octave: Math.min(8, octave + 1) })}
              type="button"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </Hint>
        </div>
        <Hint keys="Esc" label="Release every note, latched chords included">
          <button
            className="h-7 rounded-full px-3 text-white/55 text-xs hover:bg-white/[0.07] hover:text-white disabled:opacity-30"
            disabled={held.length === 0}
            onClick={allNotesOff}
            type="button"
          >
            Release all
          </button>
        </Hint>
      </div>
      <p className="truncate font-mono text-[11px] text-white/45">
        {heldSummary(held, noteMode)}
      </p>
    </div>
  );
}

function ProgressRing({ running }: { running: boolean }) {
  const beats = useStudio((state) => state.progressionBeats);
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (!running) {
      setBeat(0);
      return;
    }
    let raf = 0;
    const tick = () => {
      setBeat(progressionPhase(performance.now()).beat);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [running]);
  const fraction = running ? beat / Math.max(1, beats) : 0;
  return (
    <span
      className="absolute inset-x-0 bottom-0 h-0.5 bg-[#ffd27a]"
      style={{ transform: `scaleX(${fraction})`, transformOrigin: "left" }}
    />
  );
}

function ProgressionIdeas({ onPick }: { onPick: (chords: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <Hint label="Progression ideas">
        <PopoverTrigger asChild={true}>
          <button
            aria-label="Progression ideas"
            className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-black/40 text-white/60 hover:text-white"
            type="button"
          >
            <Lightbulb className="size-3.5" />
          </button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent
        align="end"
        className="w-64 border-white/10 bg-[#16151a] p-1 text-white"
        side="top"
      >
        {PROGRESSION_PRESETS.map((preset) => (
          <button
            className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left hover:bg-white/[0.07]"
            key={preset.label}
            onClick={() => {
              onPick(preset.chords);
              setOpen(false);
            }}
            type="button"
          >
            <span className="text-[13px] text-white/85">{preset.label}</span>
            <span className="font-mono text-[11px] text-white/45">
              {preset.chords}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function Chords() {
  const keyRoot = useStudio((state) => state.keyRoot);
  const keyFlavor = useStudio((state) => state.keyFlavor);
  const progression = useStudio((state) => state.progression);
  const progressionBeats = useStudio((state) => state.progressionBeats);
  const hold = useStudio((state) => state.hold);
  const patch = useStudio((state) => state.patch);
  const running = useLive((state) => state.progressionRunning);
  const index = useLive((state) => state.progressionIndex);
  const pads = useLive((state) => state.padNotes);
  const [draft, setDraft] = useState<string | null>(null);
  const chords = useMemo(
    () => diatonicChords(keyRoot, keyFlavor),
    [keyRoot, keyFlavor]
  );
  const parsed = useMemo(() => parseProgression(progression), [progression]);
  const romans = keyFlavor === "major" ? ROMAN_MAJOR : ROMAN_MINOR;
  const padKey = pads.join(",");

  const pressPad = (notes: number[]) => {
    if (hold && padKey === notes.join(",")) {
      useLive.setState({ padNotes: [] });
      return;
    }
    useLive.setState({ padNotes: notes });
  };

  const commit = () => {
    if (draft === null) {
      return;
    }
    if (parseProgression(draft).length > 0) {
      patch({ progression: draft.trim() });
    }
    setDraft(null);
  };

  return (
    <div className="flex w-[360px] shrink-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Chords</SectionLabel>
        <div className="flex items-center gap-1">
          <select
            aria-label="Key"
            className="h-6 rounded-md border border-white/[0.08] bg-black/40 px-1.5 text-[11px] text-white/80 outline-none"
            onChange={(event) => patch({ keyRoot: Number(event.target.value) })}
            value={keyRoot}
          >
            {PITCH_NAMES.map((name, pc) => (
              <option key={name} value={pc}>
                {name}
              </option>
            ))}
          </select>
          <Segmented
            ariaLabel="Key flavor"
            onChange={(value) => patch({ keyFlavor: value })}
            options={[
              { label: "Major", value: "major" },
              { label: "Minor", value: "minor" },
            ]}
            size="sm"
            value={keyFlavor}
          />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {chords.map((chord, position) => {
          const notes = voiceChord(chord, PAD_FLOOR);
          const active = padKey === notes.join(",");
          return (
            <button
              className={cn(
                "flex h-11 flex-col items-center justify-center rounded-lg border transition-all",
                active
                  ? "border-transparent bg-[#ffd27a] text-black shadow-[0_0_18px_#ffd27a88]"
                  : "border-white/[0.08] bg-white/[0.03] text-white/80 hover:border-white/25"
              )}
              key={chord.symbol}
              onPointerDown={(event) => {
                if (event.button === 0) {
                  pressPad(notes);
                }
              }}
              onPointerLeave={() => {
                if (!hold && active) {
                  useLive.setState({ padNotes: [] });
                }
              }}
              onPointerUp={() => {
                if (!hold) {
                  useLive.setState({ padNotes: [] });
                }
              }}
              type="button"
            >
              <span className="font-semibold text-[12px] leading-tight">
                {chord.symbol}
              </span>
              <span
                className={cn(
                  "font-mono text-[9px] leading-tight",
                  active ? "text-black/60" : "text-white/35"
                )}
              >
                {romans[position]}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5">
        <Hint
          label={
            running
              ? "Stop the progression"
              : "Play the progression at the tempo"
          }
        >
          <button
            aria-label={running ? "Stop progression" : "Play progression"}
            className={cn(
              "relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border transition-colors",
              running
                ? "border-transparent bg-[#ffd27a] text-black"
                : "border-white/[0.1] text-white/70 hover:text-white"
            )}
            onClick={toggleProgression}
            type="button"
          >
            {running ? (
              <Pause className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
          </button>
        </Hint>
        <input
          aria-label="Chord progression"
          className="h-7 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/30 px-2 font-mono text-[12px] text-white/85 outline-none focus:border-white/25"
          onBlur={commit}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          placeholder="Am F C G"
          spellCheck={false}
          value={draft ?? progression}
        />
        <select
          aria-label="Beats per chord"
          className="h-7 rounded-lg border border-white/[0.08] bg-black/40 px-1 text-[11px] text-white/75 outline-none"
          onChange={(event) =>
            patch({ progressionBeats: Number(event.target.value) })
          }
          value={progressionBeats}
        >
          {BEATS.map((beats) => (
            <option key={beats} value={beats}>
              {beats} beats
            </option>
          ))}
        </select>
        <ProgressionIdeas onPick={(chords) => patch({ progression: chords })} />
      </div>
      <div className="flex gap-1 overflow-hidden">
        {parsed.map((chord, position) => {
          const current = running && position === index % parsed.length;
          return (
            <span
              className={cn(
                "relative overflow-hidden rounded-md px-2 py-0.5 font-mono text-[11px] transition-colors",
                current ? "bg-[#ffd27a]/20 text-[#ffd27a]" : "text-white/40"
              )}
              key={`${chord.symbol}-${position.toString()}`}
            >
              {chord.symbol}
              {current ? <ProgressRing running={running} /> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function NotesDock() {
  return (
    <section className="flex h-[200px] shrink-0 gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <NoteControls />
      <Keyboard className="min-w-0 flex-1" />
      <Chords />
    </section>
  );
}
