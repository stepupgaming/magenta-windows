"use client";

import { cn } from "@workspace/ui/lib/utils";
import { Dices, RotateCcw } from "lucide-react";
import { freshStart, reroll } from "../conductor.ts";
import { isPlaying, useLive, useStudio } from "../store.ts";
import { Hint, Panel, Segmented } from "./kit.tsx";
import { Knob } from "./knob.tsx";

const TOP_K_STEPS = [8, 16, 24, 32, 40, 48, 64, 80, 100, 128, 160, 200, 256];

export function ModelPanel() {
  const drums = useStudio((state) => state.drums);
  const topK = useStudio((state) => state.topK);
  const seed = useStudio((state) => state.seed);
  const patch = useStudio((state) => state.patch);
  const styleStrength = useStudio((state) => state.styleStrength);
  const phase = useLive((state) => state.phase);
  const runningTopK = useLive((state) => state.runningTopK);
  const runningSeed = useLive((state) => state.runningSeed);
  const playing = isPlaying(phase);
  const pending =
    playing &&
    ((runningTopK !== null && runningTopK !== topK) ||
      (runningSeed !== null && runningSeed !== seed));
  const kIndex = Math.max(
    0,
    TOP_K_STEPS.findIndex((value) => value >= topK)
  );

  return (
    <Panel className="shrink-0" label="Model">
      <div className="grid grid-cols-4 justify-items-center px-2 pb-3">
        <Knob
          color="#ff4c8d"
          hint={
            styleStrength > 3.5
              ? "Very high. Held for long, this can run away or fade out."
              : "How closely the music follows the style prompts"
          }
          label="Style"
          paramId="model.style"
        />
        <Knob
          color="#ff8a1f"
          hint="How strictly the model follows the notes you hold. Lower drifts more freely."
          label="Notes"
          paramId="model.notes"
        />
        <Knob
          color="#ffc23c"
          hint="How adventurous each choice is. Low is safe and repetitive, high is wild."
          label="Temperature"
          paramId="model.temperature"
        />
        <Knob
          bipolar={true}
          color="#ae5cff"
          hint="Spring-loaded. Push it for a moment of wildness, or pull it for calm. The pitch wheel drives it too."
          label="Chaos"
          paramId="model.chaos"
          spring={true}
        />
      </div>
      <div className="flex items-center justify-between gap-2 border-white/[0.05] border-t px-4 py-2.5">
        <span className="text-white/55 text-xs">Drums</span>
        <div className="flex items-center gap-2">
          <Segmented
            ariaLabel="Drums"
            onChange={(value) => patch({ drums: value })}
            options={[
              { hint: "The model decides", label: "Auto", value: "auto" },
              { hint: "Ask for drums", label: "On", value: "on" },
              { hint: "Ask for no drums", label: "Off", value: "off" },
            ]}
            size="sm"
            value={drums}
          />
          <Knob
            className="[&>span]:hidden"
            color="#84f3ed"
            disabled={drums === "auto"}
            hint="How hard the drum request is pushed"
            label="Drum strength"
            paramId="model.drums"
            size={30}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 border-white/[0.05] border-t px-4 py-2.5">
        <Hint label="How many candidates the model picks from at each step (top-k). Applies on a restart.">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-white/55 text-xs">
            Choices
            <input
              aria-label="Choices"
              className="min-w-0 flex-1 accent-white"
              max={TOP_K_STEPS.length - 1}
              min={0}
              onChange={(event) =>
                patch({ topK: TOP_K_STEPS[Number(event.target.value)] ?? 48 })
              }
              step={1}
              type="range"
              value={kIndex}
            />
            <span className="w-7 text-right font-mono text-white/80 tabular-nums">
              {topK}
            </span>
          </label>
        </Hint>
        <Hint label="Seed for the next restart">
          <span className="font-mono text-[11px] text-white/45 tabular-nums">
            #{seed}
          </span>
        </Hint>
        <Hint label="New seed and a fresh start">
          <button
            aria-label="Re-roll"
            className="flex size-7 items-center justify-center rounded-full text-white/60 hover:bg-white/[0.07] hover:text-white disabled:opacity-30"
            disabled={!playing}
            onClick={reroll}
            type="button"
          >
            <Dices className="size-3.5" />
          </button>
        </Hint>
        <Hint label="Clear the model's memory of the last 20 seconds and start again">
          <button
            aria-label="Fresh start"
            className={cn(
              "flex h-7 items-center gap-1 rounded-full px-2.5 font-medium text-[11px] transition-colors disabled:opacity-30",
              pending
                ? "bg-amber-300 text-black"
                : "text-white/60 hover:bg-white/[0.07] hover:text-white"
            )}
            disabled={!playing}
            onClick={freshStart}
            type="button"
          >
            <RotateCcw className="size-3" />
            {pending ? "Apply" : "Fresh"}
          </button>
        </Hint>
      </div>
    </Panel>
  );
}
