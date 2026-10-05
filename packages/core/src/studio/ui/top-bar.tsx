"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import {
  AlertTriangle,
  ChevronDown,
  CircleHelp,
  Command,
  History,
  Library,
  Loader2,
  Play,
  RotateCw,
  Square,
} from "lucide-react";
import { useEffect, useState } from "react";
import { captureLast, formatTime, toggleRecord } from "../actions.ts";
import { tapTempo, togglePlay } from "../conductor.ts";
import { engine } from "../engine.ts";
import { useLive, useStudio } from "../store.ts";
import { FRAME_MS } from "../types.ts";
import { Hint } from "./kit.tsx";
import { MidiButton } from "./midi-button.tsx";
import { SettingsButton } from "./settings.tsx";

function useElapsed(since: number | null): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (since === null) {
      return;
    }
    const timer = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, (now - since) / 1000);
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 pr-2">
      <span className="relative flex size-7 items-center justify-center overflow-hidden rounded-[9px] bg-[conic-gradient(from_210deg,#ff4c8d,#ae5cff,#7fb2ff,#ffc23c,#ff4c8d)]">
        <span className="absolute inset-[3px] rounded-[7px] bg-[#0b0a0e]" />
        <span className="relative flex h-3 items-end gap-[2px]">
          {[5, 10, 7, 12, 6].map((height, index) => (
            <span
              className="w-[2px] rounded-full bg-white"
              key={`bar-${index.toString()}`}
              style={{ height }}
            />
          ))}
        </span>
      </span>
      <div className="flex flex-col leading-none">
        <span className="font-semibold text-[14px] tracking-tight">
          Magenta
        </span>
        <span className="mt-0.5 font-mono text-[9.5px] text-white/40 tracking-wider">
          REALTIME 2
        </span>
      </div>
    </div>
  );
}

function PlayButton() {
  const phase = useLive((state) => state.phase);
  const busy =
    phase === "loading" || phase === "starting" || phase === "restarting";
  const live = phase === "live";
  let label = "Play";
  let icon = <Play className="ml-0.5 size-4 fill-current" />;
  if (live) {
    label = "Stop";
    icon = <Square className="size-3.5 fill-current" />;
  } else if (busy) {
    label = "Working";
    icon = <Loader2 className="size-4 animate-spin" />;
  } else if (phase === "error") {
    label = "Try again";
    icon = <RotateCw className="size-4" />;
  }
  return (
    <Hint keys="Space" label={live ? "Stop" : "Load the model and play"}>
      <button
        aria-label={label}
        className={cn(
          "relative flex size-10 items-center justify-center rounded-full transition-all disabled:opacity-30",
          live
            ? "bg-[#ff4c8d] text-white shadow-[0_0_28px_#ff4c8d88]"
            : "bg-white text-black hover:scale-105",
          phase === "error" && "bg-rose-400 text-black"
        )}
        disabled={phase === "offline" || phase === "loading"}
        onClick={togglePlay}
        type="button"
      >
        {live ? (
          <span className="absolute inset-0 animate-ping rounded-full bg-[#ff4c8d] opacity-20" />
        ) : null}
        {icon}
      </button>
    </Hint>
  );
}

function Status() {
  const phase = useLive((state) => state.phase);
  const status = useLive((state) => state.status);
  const health = useLive((state) => state.health);
  const [since, setSince] = useState<number | null>(null);
  useEffect(() => {
    setSince(
      phase === "loading" || phase === "starting" ? performance.now() : null
    );
  }, [phase]);
  const elapsed = useElapsed(since);
  const dot: Record<string, string> = {
    error: "bg-rose-400",
    live: "bg-[#ff4c8d]",
    loading: "bg-amber-300 animate-pulse",
    offline: "bg-white/25",
    ready: "bg-emerald-400",
    restarting: "bg-amber-300 animate-pulse",
    starting: "bg-amber-300 animate-pulse",
  };
  const detail =
    phase === "live" || phase === "ready" ? (health?.gpu ?? "") : "";
  return (
    <div className="flex min-w-0 max-w-[340px] items-center gap-2.5">
      <span className={cn("size-2 shrink-0 rounded-full", dot[phase])} />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[13px] text-white/90">
          {status}
          {since === null ? null : (
            <span className="ml-1.5 font-mono text-white/45 tabular-nums">
              {formatTime(elapsed)}
            </span>
          )}
        </span>
        {detail && status !== detail ? (
          <span className="truncate text-[11px] text-white/40">{detail}</span>
        ) : null}
      </div>
    </div>
  );
}

function loadTone(load: number): string {
  if (load < 0.9) {
    return "border-emerald-400/25 text-emerald-300";
  }
  if (load < 1.05) {
    return "border-amber-300/25 text-amber-200";
  }
  return "border-rose-400/30 text-rose-300";
}

function Vitals() {
  const phase = useLive((state) => state.phase);
  const stats = useLive((state) => state.stats);
  if (phase !== "live" && phase !== "restarting") {
    return null;
  }
  const load = stats.msPerFrame === null ? null : stats.msPerFrame / FRAME_MS;
  const latency = stats.queued + (engine.audio?.outputLatency ?? 0);
  return (
    <div className="hidden items-center gap-1.5 xl:flex">
      {load === null ? null : (
        <Hint label="Time the GPU needs for each 40 ms frame. Under 100% keeps up with the speakers.">
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums",
              loadTone(load)
            )}
          >
            GPU {Math.round(load * 100)}%
          </span>
        </Hint>
      )}
      <Hint label="How long after you play before you hear the model answer">
        <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[11px] text-white/65 tabular-nums">
          {latency.toFixed(1)} s
        </span>
      </Hint>
      {stats.underruns > 0 ? (
        <Hint label="Times the playback buffer ran dry. Raise the buffer in Settings if this keeps climbing.">
          <span className="flex items-center gap-1 rounded-full border border-amber-300/25 px-2 py-0.5 font-mono text-[11px] text-amber-200 tabular-nums">
            <AlertTriangle className="size-3" />
            {stats.underruns}
          </span>
        </Hint>
      ) : null}
    </div>
  );
}

function Tempo() {
  const bpm = useStudio((state) => state.bpm);
  const patch = useStudio((state) => state.patch);
  const [flash, setFlash] = useState(false);
  return (
    <div className="flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] pr-1 pl-3">
      <Hint label="Tempo for chord progressions, scene morphs, and the echo. The model keeps its own groove, so tap along to it.">
        <label className="flex items-center gap-1.5 text-[11px] text-white/45">
          BPM
          <input
            aria-label="Tempo"
            className="w-9 bg-transparent font-mono text-[13px] text-white tabular-nums outline-none"
            max={220}
            min={40}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (value >= 40 && value <= 220) {
                patch({ bpm: value });
              }
            }}
            onKeyDown={(event) => event.stopPropagation()}
            type="number"
            value={bpm}
          />
        </label>
      </Hint>
      <Hint keys="B" label="Tap along to set the tempo">
        <button
          className={cn(
            "h-6 rounded-full px-2.5 font-medium text-[11px] transition-colors",
            flash
              ? "bg-white text-black"
              : "text-white/65 hover:bg-white/[0.08] hover:text-white"
          )}
          onClick={() => {
            tapTempo();
            setFlash(true);
            window.setTimeout(() => setFlash(false), 90);
          }}
          type="button"
        >
          Tap
        </button>
      </Hint>
    </div>
  );
}

function RecordControls({ onTakes }: { onTakes: () => void }) {
  const recording = useLive((state) => state.recording);
  const takes = useLive((state) => state.takes.length);
  const elapsed = useElapsed(recording);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <Hint
        keys="R"
        label={recording === null ? "Record what you hear" : "Stop recording"}
      >
        <button
          aria-label={recording === null ? "Record" : "Stop recording"}
          className={cn(
            "flex h-8 items-center gap-2 rounded-full border px-3 font-medium text-xs transition-colors",
            recording === null
              ? "border-white/[0.09] text-white/75 hover:border-white/25 hover:text-white"
              : "border-rose-400/40 bg-rose-500/15 text-rose-100"
          )}
          onClick={() => {
            toggleRecord().catch(() => undefined);
          }}
          type="button"
        >
          <span
            className={cn(
              "size-2.5 rounded-full bg-rose-500",
              recording !== null && "animate-pulse"
            )}
          />
          {recording === null ? "Rec" : formatTime(elapsed)}
        </button>
      </Hint>
      <div className="flex h-8 items-center rounded-full border border-white/[0.09]">
        <Hint
          keys="C"
          label="Keep the last 30 seconds you heard. Nothing needs to be armed."
        >
          <button
            className="flex h-full items-center gap-1.5 rounded-l-full pr-1.5 pl-3 font-medium text-white/75 text-xs hover:text-white"
            onClick={() => {
              captureLast(30).catch(() => undefined);
            }}
            type="button"
          >
            <History className="size-3.5" />
            Keep 30s
          </button>
        </Hint>
        <Popover onOpenChange={setOpen} open={open}>
          <PopoverTrigger asChild={true}>
            <button
              aria-label="Keep a different length"
              className="flex h-full items-center rounded-r-full pr-2 pl-1 text-white/50 hover:text-white"
              type="button"
            >
              <ChevronDown className="size-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-44 border-white/10 bg-[#16151a] p-1 text-white"
            sideOffset={6}
          >
            {[10, 15, 30, 60].map((seconds) => (
              <button
                className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm text-white/80 hover:bg-white/[0.07] hover:text-white"
                key={seconds}
                onClick={() => {
                  setOpen(false);
                  captureLast(seconds).catch(() => undefined);
                }}
                type="button"
              >
                Keep last {seconds}s
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>
      <Hint label="Recordings and captures">
        <button
          className="relative flex h-8 items-center gap-1.5 rounded-full border border-white/[0.09] px-3 font-medium text-white/75 text-xs hover:border-white/25 hover:text-white"
          onClick={onTakes}
          type="button"
        >
          <Library className="size-3.5" />
          Takes
          {takes > 0 ? (
            <span className="rounded-full bg-white px-1.5 font-mono text-[10px] text-black">
              {takes}
            </span>
          ) : null}
        </button>
      </Hint>
    </div>
  );
}

export function TopBar({
  onHelp,
  onPalette,
  onTakes,
}: {
  onHelp: () => void;
  onPalette: () => void;
  onTakes: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 px-4">
      <Brand />
      <PlayButton />
      <Status />
      <Vitals />
      <div className="flex-1" />
      <Tempo />
      <RecordControls onTakes={onTakes} />
      <div className="flex items-center gap-0.5">
        <MidiButton />
        <Hint keys="Ctrl K" label="Every action, searchable">
          <button
            aria-label="Command palette"
            className="flex size-8 items-center justify-center rounded-full text-white/60 hover:bg-white/[0.07] hover:text-white"
            onClick={onPalette}
            type="button"
          >
            <Command className="size-4" />
          </button>
        </Hint>
        <Hint keys="?" label="Shortcuts and how the model listens">
          <button
            aria-label="Help"
            className="flex size-8 items-center justify-center rounded-full text-white/60 hover:bg-white/[0.07] hover:text-white"
            onClick={onHelp}
            type="button"
          >
            <CircleHelp className="size-4" />
          </button>
        </Hint>
        <SettingsButton />
      </div>
    </header>
  );
}
