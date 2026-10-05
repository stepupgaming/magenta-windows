"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import { Cable, X } from "lucide-react";
import { mappingLabel, startMidi, unmap } from "../midi.ts";
import { targetLabel } from "../params.ts";
import { useLive, useStudio } from "../store.ts";
import { Toggle } from "./kit.tsx";

function learnHint(learn: boolean, target: string | null): string {
  if (!learn) {
    return "Map any knob or fader to your controller";
  }
  if (target) {
    return `Move a knob for ${targetLabel(target)}`;
  }
  return "Click a knob, fader, or button, then move a control";
}

export function MidiButton() {
  const status = useLive((state) => state.midiStatus);
  const devices = useLive((state) => state.midiDevices);
  const learn = useLive((state) => state.learn);
  const target = useLive((state) => state.learnTarget);
  const map = useStudio((state) => state.midiMap);
  const connected = status === "ready" && devices.length > 0;
  const entries = Object.entries(map);

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) {
          startMidi().catch(() => undefined);
        }
      }}
    >
      <PopoverTrigger asChild={true}>
        <button
          aria-label="MIDI"
          className={cn(
            "relative flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors hover:bg-white/[0.07]",
            learn
              ? "bg-sky-500/20 text-sky-200"
              : "text-white/60 hover:text-white"
          )}
          type="button"
        >
          <Cable className="size-4" />
          {connected ? (
            <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-emerald-400" />
          ) : null}
          {learn ? "Learning" : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 border-white/10 bg-[#16151a] p-0 text-white"
        sideOffset={8}
      >
        <div className="border-white/[0.07] border-b p-3">
          <p className="font-medium text-sm">MIDI</p>
          <p className="mt-1 text-white/55 text-xs leading-relaxed">
            {status === "unsupported" && "This window has no Web MIDI."}
            {status === "denied" &&
              "MIDI access was refused. Allow it and open this again."}
            {status === "off" && "Connecting to MIDI devices…"}
            {status === "ready" &&
              (devices.length > 0
                ? devices.map((device) => device.name).join(", ")
                : "No MIDI inputs. Plug a controller in and it shows up here.")}
          </p>
          <p className="mt-2 text-[11px] text-white/40 leading-relaxed">
            Keys play notes, the sustain pedal holds them, the pitch wheel
            drives Chaos, and program changes 1 to 8 recall scenes.
          </p>
        </div>
        <div className="flex items-center justify-between gap-2 p-3">
          <div className="min-w-0">
            <p className="text-sm">Learn</p>
            <p className="text-[11px] text-white/45">
              {learnHint(learn, target)}
            </p>
          </div>
          <Toggle
            active={learn}
            color="#38bdf8"
            keys="M"
            onClick={() =>
              useLive.setState({ learn: !learn, learnTarget: null })
            }
          >
            {learn ? "Done" : "Learn"}
          </Toggle>
        </div>
        {entries.length > 0 ? (
          <ul className="max-h-56 overflow-y-auto border-white/[0.07] border-t p-1.5">
            {entries.map(([key, value]) => (
              <li
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white/[0.04]"
                key={key}
              >
                <span className="font-mono text-sky-300/90">
                  {mappingLabel(key)}
                </span>
                <span className="min-w-0 flex-1 truncate text-right text-white/75">
                  {targetLabel(value)}
                </span>
                <button
                  aria-label={`Remove mapping ${mappingLabel(key)}`}
                  className="flex size-5 items-center justify-center rounded text-white/40 hover:bg-white/10 hover:text-white"
                  onClick={() => unmap(key)}
                  type="button"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
