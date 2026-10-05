"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet";
import { cn } from "@workspace/ui/lib/utils";
import { Download, Pause, Play, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  downloadTake,
  formatTime,
  removeTake,
  renameTake,
} from "../actions.ts";
import { useLive } from "../store.ts";
import type { Take } from "../types.ts";
import type { AudioSource } from "./audio-dialog.tsx";
import { Hint } from "./kit.tsx";

function barColor(played: boolean, source: Take["source"]): string {
  if (played) {
    return "#ff4c8d";
  }
  return source === "capture" ? "#7fb2ff99" : "#ffffff55";
}

function TakeRow({
  onStyle,
  onToggle,
  playing,
  progress,
  take,
}: {
  onStyle: () => void;
  onToggle: () => void;
  playing: boolean;
  progress: number;
  take: Take;
}) {
  const [name, setName] = useState(take.name);
  return (
    <li className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
      <div className="flex items-center gap-2">
        <button
          aria-label={playing ? "Pause" : "Play"}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
            playing ? "bg-[#ff4c8d] text-white" : "bg-white text-black"
          )}
          onClick={onToggle}
          type="button"
        >
          {playing ? (
            <Pause className="size-3.5 fill-current" />
          ) : (
            <Play className="ml-0.5 size-3.5 fill-current" />
          )}
        </button>
        <input
          aria-label="Take name"
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none"
          onBlur={() => renameTake(take.id, name.trim() || take.name)}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          value={name}
        />
        <span className="font-mono text-[11px] text-white/45 tabular-nums">
          {formatTime(take.seconds)}
        </span>
      </div>
      <div className="relative mt-2.5 flex h-9 items-center gap-px">
        {take.peaks.map((peak, index) => {
          const played = index / take.peaks.length < progress;
          return (
            <span
              className="flex-1 rounded-full"
              key={`${take.id}-${index.toString()}`}
              style={{
                background: barColor(played, take.source),
                height: `${Math.max(6, peak * 100)}%`,
              }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-white/40">
          {take.source === "capture" ? "Kept from the last minute" : "Recorded"}{" "}
          at{" "}
          {new Date(take.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <div className="flex items-center gap-0.5">
          <Hint label="Feed this take back to the model as a style">
            <button
              aria-label="Use as a style"
              className="flex h-7 items-center gap-1 rounded-full px-2 text-[11px] text-white/70 hover:bg-white/[0.07] hover:text-white"
              onClick={onStyle}
              type="button"
            >
              <Sparkles className="size-3.5" />
              Style
            </button>
          </Hint>
          <Hint label="Save as WAV">
            <button
              aria-label="Download"
              className="flex size-7 items-center justify-center rounded-full text-white/60 hover:bg-white/[0.07] hover:text-white"
              onClick={() => downloadTake(take)}
              type="button"
            >
              <Download className="size-3.5" />
            </button>
          </Hint>
          <Hint label="Delete">
            <button
              aria-label="Delete"
              className="flex size-7 items-center justify-center rounded-full text-white/40 hover:bg-rose-500/15 hover:text-rose-200"
              onClick={() => removeTake(take.id)}
              type="button"
            >
              <Trash2 className="size-3.5" />
            </button>
          </Hint>
        </div>
      </div>
    </li>
  );
}

export function TakesSheet({
  onOpenChange,
  onStyle,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  onStyle: (source: AudioSource) => void;
  open: boolean;
}) {
  const takes = useLive((state) => state.takes);
  const [playing, setPlaying] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const player = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!open) {
      player.current?.pause();
      setPlaying(null);
    }
  }, [open]);

  const toggle = (take: Take) => {
    if (playing === take.id) {
      player.current?.pause();
      setPlaying(null);
      return;
    }
    player.current?.pause();
    const audio = new Audio(take.url);
    audio.ontimeupdate = () =>
      setProgress(audio.currentTime / Math.max(0.01, take.seconds));
    audio.onended = () => {
      setPlaying(null);
      setProgress(0);
    };
    player.current = audio;
    setProgress(0);
    audio.play().catch(() => setPlaying(null));
    setPlaying(take.id);
  };

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className="w-[420px] border-white/10 bg-[#0f0e12] text-white sm:max-w-[420px]"
        side="right"
      >
        <SheetHeader>
          <SheetTitle className="text-white">Takes</SheetTitle>
          <SheetDescription className="text-white/50">
            Rec captures what you hear from now on. Keep saves the last stretch
            that already played, so a good moment is never lost. Takes stay
            until you close the window, so save the ones you love.
          </SheetDescription>
        </SheetHeader>
        <ul className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 pb-6">
          {takes.length === 0 ? (
            <li className="rounded-xl border border-white/[0.08] border-dashed p-6 text-center text-sm text-white/45">
              Nothing yet. Press R to record or C to keep the last 30 seconds.
            </li>
          ) : null}
          {takes.map((take) => (
            <TakeRow
              key={take.id}
              onStyle={() => {
                onOpenChange(false);
                onStyle({
                  clip: {
                    left: take.left,
                    right: take.right,
                    sampleRate: take.sampleRate,
                  },
                  name: take.name,
                });
              }}
              onToggle={() => toggle(take)}
              playing={playing === take.id}
              progress={playing === take.id ? progress : 0}
              take={take}
            />
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
