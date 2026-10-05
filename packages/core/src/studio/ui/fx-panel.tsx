"use client";

import { cn } from "@workspace/ui/lib/utils";
import { FX_DEFAULTS, useStudio } from "../store.ts";
import { Hint, Panel } from "./kit.tsx";
import { Knob } from "./knob.tsx";

const DIVISIONS = [
  { beats: 1, label: "1/4" },
  { beats: 0.75, label: "3/16" },
  { beats: 0.5, label: "1/8" },
  { beats: 1 / 3, label: "1/8T" },
  { beats: 0.25, label: "1/16" },
];

export function FxPanel() {
  const division = useStudio((state) => state.fx.delayDivision);
  const patchFx = useStudio((state) => state.patchFx);
  const fx = useStudio((state) => state.fx);
  const dirty = (Object.keys(FX_DEFAULTS) as (keyof typeof FX_DEFAULTS)[]).some(
    (key) => fx[key] !== FX_DEFAULTS[key]
  );
  return (
    <Panel
      actions={
        <Hint label="Effects run on this computer, after the model. Recordings include them.">
          <button
            className={cn(
              "h-6 rounded-full px-2.5 font-medium text-[11px] transition-colors",
              dirty
                ? "text-white/70 hover:bg-white/[0.07] hover:text-white"
                : "text-white/25"
            )}
            disabled={!dirty}
            onClick={() => patchFx(FX_DEFAULTS)}
            type="button"
          >
            Reset
          </button>
        </Hint>
      }
      className="shrink-0"
      label="Effects"
    >
      <div className="grid grid-cols-5 justify-items-center gap-y-3 px-2 pb-2">
        <Knob
          bipolar={true}
          color="#84f3ed"
          hint="DJ filter. Left is low-pass, right is high-pass."
          label="Filter"
          paramId="fx.filter"
          size={44}
        />
        <Knob
          color="#84f3ed"
          label="Resonance"
          paramId="fx.filterResonance"
          size={44}
        />
        <Knob
          color="#7fb2ff"
          hint="Low shelf. Home kills it."
          label="Low"
          paramId="fx.eqLow"
          size={44}
        />
        <Knob color="#7fb2ff" label="Mid" paramId="fx.eqMid" size={44} />
        <Knob color="#7fb2ff" label="High" paramId="fx.eqHigh" size={44} />
        <Knob
          color="#ae5cff"
          hint="Ping-pong echo, synced to the tempo"
          label="Echo"
          paramId="fx.delayMix"
          size={44}
        />
        <Knob
          color="#ae5cff"
          label="Repeats"
          paramId="fx.delayFeedback"
          size={44}
        />
        <Knob color="#ff70f9" label="Reverb" paramId="fx.reverbMix" size={44} />
        <Knob color="#ff70f9" label="Size" paramId="fx.reverbSize" size={44} />
        <Knob
          color="#ffffff"
          hint="Master volume, after a limiter"
          label="Volume"
          paramId="master.volume"
          size={44}
        />
      </div>
      <div className="flex items-center gap-2 px-4 pb-3 text-white/50 text-xs">
        <span>Echo time</span>
        <div className="flex items-center gap-0.5">
          {DIVISIONS.map((item) => (
            <button
              className={cn(
                "h-6 rounded-md px-1.5 font-mono text-[11px] transition-colors",
                Math.abs(item.beats - division) < 0.001
                  ? "bg-white/[0.14] text-white"
                  : "text-white/45 hover:text-white"
              )}
              key={item.label}
              onClick={() => patchFx({ delayDivision: item.beats })}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
}
