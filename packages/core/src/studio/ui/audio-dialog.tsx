"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Loader2, Pause, Play } from "lucide-react";
import type { PointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { addAudioPrompt, formatTime } from "../actions.ts";
import type { StereoClip } from "../audio.ts";
import {
  CONTINUE_MAX,
  CONTINUE_MIN,
  clipSeconds,
  encodeWav,
  loudestWindow,
  PROMPT_MAX,
  PROMPT_WINDOW,
  peaks,
  toPromptClip,
} from "../clips.ts";
import { continueClip } from "../conductor.ts";
import { clamp, useLive } from "../store.ts";
import { Segmented } from "./kit.tsx";

/** Style hears the pick as a prompt. Continue carries the music on from its end. */
export type AudioUse = "continue" | "style";

export interface AudioSource {
  clip: StereoClip;
  name: string;
  use?: AudioUse;
}

const BARS = 220;
const LIMITS: Record<AudioUse, { max: number; min: number }> = {
  continue: { max: CONTINUE_MAX, min: CONTINUE_MIN },
  style: { max: PROMPT_MAX, min: 1 },
};

const COPY: Record<AudioUse, string> = {
  continue:
    "The model listens to the pick and carries on from its end, as if it had just played it. It hears up to 28 seconds, and the new music starts about a second before the end of the pick. Your prompts steer where it goes next.",
  style:
    "The model hears a style from audio the same way it hears a sentence. Pick the part that sounds like what you want. It listens in 10 second windows, and longer picks are averaged.",
};

/** The default pick: the loudest stretch for a style, the end for a continuation. */
function defaultPick(clip: StereoClip, use: AudioUse): [number, number] {
  const total = clipSeconds(clip);
  if (use === "continue") {
    const length = Math.min(CONTINUE_MAX, total);
    return [total - length, length];
  }
  const length = Math.min(PROMPT_WINDOW, total);
  return [loudestWindow(clip, length), length];
}

type Grab = { kind: "end" | "move" | "start"; offset: number } | null;

export function AudioPromptDialog({
  onClose,
  source,
}: {
  onClose: () => void;
  source: AudioSource | null;
}) {
  const total = source ? clipSeconds(source.clip) : 0;
  const [use, setUse] = useState<AudioUse>("style");
  const [start, setStart] = useState(0);
  const [length, setLength] = useState(PROMPT_WINDOW);
  const [busy, setBusy] = useState(false);
  const continuing = useLive((state) => state.continuing !== null);
  const limits = LIMITS[use];
  const [playing, setPlaying] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const grab = useRef<Grab>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const bars = useMemo(
    () => (source ? peaks([source.clip.left, source.clip.right], BARS) : []),
    [source]
  );

  useEffect(() => {
    if (!source) {
      return;
    }
    const opening = source.use ?? "style";
    const [from, pick] = defaultPick(source.clip, opening);
    setUse(opening);
    setStart(from);
    setLength(pick);
  }, [source]);

  const switchUse = (next: AudioUse) => {
    if (!source || next === use) {
      return;
    }
    const [from, pick] = defaultPick(source.clip, next);
    setUse(next);
    setStart(from);
    setLength(pick);
  };

  useEffect(
    () => () => {
      player.current?.pause();
    },
    []
  );

  const seconds = (event: PointerEvent) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) {
      return 0;
    }
    return clamp((event.clientX - rect.left) / rect.width, 0, 1) * total;
  };

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = seconds(event);
    const end = start + length;
    const near = total * 0.015;
    if (Math.abs(at - start) < near) {
      grab.current = { kind: "start", offset: 0 };
    } else if (Math.abs(at - end) < near) {
      grab.current = { kind: "end", offset: 0 };
    } else if (at > start && at < end) {
      grab.current = { kind: "move", offset: at - start };
    } else {
      const next = clamp(at - length / 2, 0, Math.max(0, total - length));
      setStart(next);
      grab.current = { kind: "move", offset: at - next };
    }
  };

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = grab.current;
    if (!state) {
      return;
    }
    const at = seconds(event);
    const end = start + length;
    if (state.kind === "move") {
      setStart(clamp(at - state.offset, 0, Math.max(0, total - length)));
    } else if (state.kind === "start") {
      const next = clamp(at, Math.max(0, end - limits.max), end - limits.min);
      setStart(next);
      setLength(end - next);
    } else {
      const next = clamp(
        at,
        start + limits.min,
        Math.min(total, start + limits.max)
      );
      setLength(next - start);
    }
  };

  const preview = () => {
    if (!source) {
      return;
    }
    if (playing) {
      player.current?.pause();
      setPlaying(false);
      return;
    }
    const rate = source.clip.sampleRate;
    const from = Math.floor(start * rate);
    const to = Math.floor((start + length) * rate);
    const blob = encodeWav({
      left: source.clip.left.slice(from, to),
      right: source.clip.right.slice(from, to),
      sampleRate: rate,
    });
    const audio = new Audio(URL.createObjectURL(blob));
    audio.onended = () => setPlaying(false);
    player.current?.pause();
    player.current = audio;
    audio.play().catch(() => setPlaying(false));
    setPlaying(true);
  };

  const add = async () => {
    if (!source) {
      return;
    }
    setBusy(true);
    try {
      const samples = await toPromptClip(source.clip, start, start + length);
      const added = await addAudioPrompt(source.name, samples);
      if (added) {
        player.current?.pause();
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const carryOn = async () => {
    if (!source) {
      return;
    }
    const rate = source.clip.sampleRate;
    const from = Math.floor(start * rate);
    const to = Math.floor((start + length) * rate);
    player.current?.pause();
    setPlaying(false);
    const done = await continueClip(
      {
        left: source.clip.left.slice(from, to),
        right: source.clip.right.slice(from, to),
        sampleRate: rate,
      },
      source.name
    );
    if (done) {
      onClose();
    }
  };

  const left = total > 0 ? (start / total) * 100 : 0;
  const width = total > 0 ? (length / total) * 100 : 0;

  return (
    <Dialog
      onOpenChange={(open) => (open ? undefined : onClose())}
      open={source !== null}
    >
      <DialogContent className="border-white/10 bg-[#121116] text-white sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">
            {source?.name ?? "Audio prompt"}
          </DialogTitle>
          <DialogDescription className="text-white/55">
            {COPY[use]}
          </DialogDescription>
        </DialogHeader>
        <Segmented
          ariaLabel="Use the audio"
          className="justify-self-start"
          onChange={switchUse}
          options={[
            {
              hint: "Blend the audio's sound in with the prompts",
              label: "Use as a style",
              value: "style",
            },
            {
              hint: "Let the model play on from the end of the pick",
              label: "Continue from it",
              value: "continue",
            },
          ]}
          size="sm"
          value={use}
        />
        <div
          className="relative h-28 cursor-pointer touch-none select-none overflow-hidden rounded-xl border border-white/[0.08] bg-black/40"
          onLostPointerCapture={() => {
            grab.current = null;
          }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          ref={track}
        >
          <div className="absolute inset-0 flex items-center gap-px px-px">
            {bars.map((value, index) => {
              const at = (index / BARS) * 100;
              const inside = at >= left && at <= left + width;
              return (
                <span
                  className="flex-1 rounded-full"
                  key={`bar-${index.toString()}`}
                  style={{
                    background: inside ? "#ff4c8d" : "rgba(255,255,255,0.22)",
                    height: `${Math.max(3, value * 92)}%`,
                  }}
                />
              );
            })}
          </div>
          <div
            className="absolute inset-y-0 border-[#ff4c8d] border-x-2 bg-[#ff4c8d]/10"
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            <span className="absolute inset-y-0 -left-1.5 w-3 cursor-ew-resize" />
            <span className="absolute inset-y-0 -right-1.5 w-3 cursor-ew-resize" />
          </div>
        </div>
        <div className="flex items-center justify-between font-mono text-white/55 text-xs tabular-nums">
          <span>
            {formatTime(start)} to {formatTime(start + length)}
          </span>
          <span>
            {length.toFixed(1)} s of {total.toFixed(1)} s
          </span>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-full border border-white/15 px-4 text-sm text-white/80 hover:border-white/30 hover:text-white"
            onClick={preview}
            type="button"
          >
            {playing ? (
              <Pause className="size-4" />
            ) : (
              <Play className="size-4" />
            )}
            {playing ? "Stop" : "Preview the pick"}
          </button>
          {use === "style" ? (
            <button
              className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-5 font-medium text-black text-sm disabled:opacity-50"
              disabled={busy || length < limits.min}
              onClick={() => {
                add().catch(() => setBusy(false));
              }}
              type="button"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Add as a style
            </button>
          ) : (
            <button
              className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-5 font-medium text-black text-sm disabled:opacity-50"
              disabled={continuing || length < limits.min - 0.01}
              onClick={() => {
                carryOn().catch(() => undefined);
              }}
              type="button"
            >
              {continuing ? <Loader2 className="size-4 animate-spin" /> : null}
              {total < CONTINUE_MIN
                ? `Needs ${CONTINUE_MIN} seconds`
                : "Continue from here"}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
