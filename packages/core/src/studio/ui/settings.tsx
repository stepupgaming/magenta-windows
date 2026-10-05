"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Download, Settings2, Upload } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { exportSession, importSession } from "../actions.ts";
import { useLive, useStudio } from "../store.ts";
import type { EngineHealth, TextMapperState } from "../types.ts";
import { Hint, Toggle } from "./kit.tsx";

const BUFFERS = [
  { label: "Tight", seconds: 0.5 },
  { label: "Normal", seconds: 1 },
  { label: "Safe", seconds: 1.5 },
  { label: "Solid", seconds: 2.5 },
];

const MAPPER_COPY: Record<TextMapperState, { label: string; tone: string }> = {
  off: { label: "Off", tone: "text-white/50" },
  on: { label: "On", tone: "text-emerald-300" },
  pending: { label: "Loads with the model", tone: "text-white/50" },
  unavailable: { label: "Unavailable", tone: "text-amber-200" },
};

function mapperSummary(health: EngineHealth | null): {
  label: string;
  tone: string;
} {
  if (!health) {
    return { label: "Engine offline", tone: "text-white/40" };
  }
  if (!health.text_mapper) {
    return { label: "Not supported by this engine", tone: "text-white/40" };
  }
  return MAPPER_COPY[health.text_mapper];
}

function encoderSummary(health: EngineHealth | null): {
  label: string;
  tone: string;
} {
  if (!health) {
    return { label: "Engine offline", tone: "text-white/40" };
  }
  if (!health.clip_encoder) {
    return { label: "Not supported by this engine", tone: "text-white/40" };
  }
  return MAPPER_COPY[health.clip_encoder];
}

function EngineSection() {
  const health = useLive((state) => state.health);
  const mapper = mapperSummary(health);
  const encoder = encoderSummary(health);
  return (
    <div className="border-white/[0.07] border-b p-3">
      <p className="font-medium text-sm">Engine</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-white/45">GPU</dt>
        <dd className="truncate text-right text-white/80">
          {health?.gpu ?? "Not connected"}
        </dd>
        <dt className="text-white/45">Text mapper</dt>
        <dd className={`text-right ${mapper.tone}`}>
          <Hint
            label={
              health?.text_mapper_detail ??
              "Refines text prompts toward the sounds the model learned from, as Google's apps do."
            }
          >
            <span>{mapper.label}</span>
          </Hint>
        </dd>
        <dt className="text-white/45">Continue from audio</dt>
        <dd className={`text-right ${encoder.tone}`}>
          <Hint
            label={
              health?.clip_encoder_detail ??
              "Google's SpectroStream encoder turns a clip back into music the model can carry on."
            }
          >
            <span>{encoder.label}</span>
          </Hint>
        </dd>
      </dl>
      {health?.text_mapper === "unavailable" ? (
        <p className="mt-2 text-[11px] text-white/45 leading-relaxed">
          Text prompts still work, but they will not sound quite like
          Google&apos;s apps. Connect to the internet once and reload the model
          to fetch it.
        </p>
      ) : null}
    </div>
  );
}

export function SettingsButton() {
  const bufferSeconds = useStudio((state) => state.bufferSeconds);
  const keyLabels = useStudio((state) => state.keyLabels);
  const patch = useStudio((state) => state.patch);
  const reset = useStudio((state) => state.reset);
  const file = useRef<HTMLInputElement>(null);
  return (
    <Popover>
      <Hint label="Settings">
        <PopoverTrigger asChild={true}>
          <button
            aria-label="Settings"
            className="flex size-8 items-center justify-center rounded-full text-white/60 hover:bg-white/[0.07] hover:text-white"
            type="button"
          >
            <Settings2 className="size-4" />
          </button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent
        align="end"
        className="w-80 border-white/10 bg-[#16151a] p-0 text-white"
        sideOffset={8}
      >
        <EngineSection />
        <div className="border-white/[0.07] border-b p-3">
          <p className="font-medium text-sm">Playback cushion</p>
          <p className="mt-1 text-white/50 text-xs leading-relaxed">
            Audio the window holds before it plays. Less is quicker to answer
            your hands. More rides out a slow GPU without gaps.
          </p>
          <div className="mt-2.5 grid grid-cols-4 gap-1">
            {BUFFERS.map((item) => (
              <button
                className={
                  item.seconds === bufferSeconds
                    ? "rounded-lg bg-white py-1.5 text-black text-xs"
                    : "rounded-lg border border-white/[0.08] py-1.5 text-white/70 text-xs hover:border-white/25"
                }
                key={item.label}
                onClick={() => patch({ bufferSeconds: item.seconds })}
                type="button"
              >
                <span className="block font-medium">{item.label}</span>
                <span className="font-mono text-[10px] opacity-60">
                  {item.seconds}s
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between border-white/[0.07] border-b p-3">
          <span className="text-sm">Computer key labels</span>
          <Toggle
            active={keyLabels}
            onClick={() => patch({ keyLabels: !keyLabels })}
          >
            {keyLabels ? "On" : "Off"}
          </Toggle>
        </div>
        <div className="flex flex-col gap-1 p-2">
          <button
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-white/80 hover:bg-white/[0.06] hover:text-white"
            onClick={exportSession}
            type="button"
          >
            <Download className="size-4 text-white/50" />
            Save session to a file
          </button>
          <button
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-white/80 hover:bg-white/[0.06] hover:text-white"
            onClick={() => file.current?.click()}
            type="button"
          >
            <Upload className="size-4 text-white/50" />
            Open a session file
          </button>
          <button
            className="rounded-md px-2 py-1.5 text-left text-rose-300/90 text-sm hover:bg-rose-500/10"
            onClick={() => {
              reset();
              toast("Back to the first session", {
                description: "MIDI mappings were kept.",
              });
            }}
            type="button"
          >
            Reset everything except MIDI
          </button>
        </div>
        <input
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const picked = event.target.files?.[0];
            event.target.value = "";
            if (picked) {
              importSession(picked).catch(() => undefined);
            }
          }}
          ref={file}
          type="file"
        />
      </PopoverContent>
    </Popover>
  );
}
