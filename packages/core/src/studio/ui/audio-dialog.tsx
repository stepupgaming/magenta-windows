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
  clipSeconds,
  encodeWav,
  loudestWindow,
  PROMPT_MAX,
  PROMPT_WINDOW,
  peaks,
  toPromptClip,
} from "../clips.ts";
import { clamp } from "../store.ts";

export interface AudioSource {
  clip: StereoClip;
  name: string;
}

const BARS = 220;
const MIN_PICK = 1;

type Grab = { kind: "end" | "move" | "start"; offset: number } | null;

export function AudioPromptDialog({
  onClose,
  source,
}: {
  onClose: () => void;
  source: AudioSource | null;
}) {
  const total = source ? clipSeconds(source.clip) : 0;
  const [start, setStart] = useState(0);
  const [length, setLength] = useState(PROMPT_WINDOW);
  const [busy, setBusy] = useState(false);
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
    const pick = Math.min(PROMPT_WINDOW, clipSeconds(source.clip));
    setLength(pick);
    setStart(loudestWindow(source.clip, pick));
  }, [source]);

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
      const next = clamp(at, Math.max(0, end - PROMPT_MAX), end - MIN_PICK);
      setStart(next);
      setLength(end - next);
    } else {
      const next = clamp(
        at,
        start + MIN_PICK,
        Math.min(total, start + PROMPT_MAX)
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
            The model hears a style from audio the same way it hears a sentence.
            Pick the part that sounds like what you want. It listens in 10
            second windows, and longer picks are averaged.
          </DialogDescription>
        </DialogHeader>
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
          <button
            className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-5 font-medium text-black text-sm disabled:opacity-50"
            disabled={busy || length < MIN_PICK}
            onClick={() => {
              add().catch(() => setBusy(false));
            }}
            type="button"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Add as a style
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
