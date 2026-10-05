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
import { useStudio } from "../store.ts";
import { Hint, Toggle } from "./kit.tsx";

const BUFFERS = [
  { label: "Tight", seconds: 0.5 },
  { label: "Normal", seconds: 1 },
  { label: "Safe", seconds: 1.5 },
  { label: "Solid", seconds: 2.5 },
];

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
