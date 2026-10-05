"use client";

import { cn } from "@workspace/ui/lib/utils";
import { Plus } from "lucide-react";
import { clearScene, recallScene, saveScene } from "../conductor.ts";
import { sceneColors } from "../scenes.ts";
import { useLive, useStudio } from "../store.ts";
import { Hint, Panel, Segmented } from "./kit.tsx";

const BEAT_CHOICES = [1, 2, 4, 8, 16, 32];

function ScenePad({ slot }: { slot: number }) {
  const scene = useStudio((state) => state.scenes[slot] ?? null);
  const active = useLive((state) => state.activeScene === slot);
  const morphing = useLive((state) => state.morph?.slot === slot);
  const progress = useLive((state) =>
    state.morph?.slot === slot ? state.morphProgress : 0
  );
  const colors = scene ? sceneColors(scene) : [];
  const background =
    colors.length > 0
      ? `linear-gradient(135deg, ${colors.map((color, index) => `${color}${index === 0 ? "55" : "33"}`).join(", ")})`
      : undefined;

  const pad = (
    <button
      className={cn(
        "group relative flex h-14 flex-col justify-between overflow-hidden rounded-xl border p-2 text-left transition-all",
        scene
          ? "border-white/[0.09] hover:border-white/30"
          : "border-white/[0.08] border-dashed text-white/30 hover:border-white/25 hover:text-white/60",
        active && "border-white/70 shadow-[0_0_22px_rgba(255,255,255,0.12)]"
      )}
      onClick={(event) => {
        if (event.shiftKey) {
          saveScene(slot);
          return;
        }
        recallScene(slot, event.altKey ? "cut" : undefined);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (scene) {
          clearScene(slot);
        }
      }}
      style={{ background }}
      type="button"
    >
      <span className="flex items-center justify-between font-mono text-[10px] text-white/55">
        {slot + 1}
        {scene ? null : <Plus className="size-3" />}
      </span>
      <span
        className={cn(
          "truncate text-[11px] leading-tight",
          scene ? "text-white/90" : "text-white/30"
        )}
      >
        {scene ? scene.name : "Save"}
      </span>
      {morphing ? (
        <span
          className="absolute bottom-0 left-0 h-0.5 bg-white"
          style={{ width: `${progress * 100}%` }}
        />
      ) : null}
    </button>
  );
  return (
    <Hint
      keys={`${slot + 1}`}
      label={
        scene
          ? "Recall. Shift-click to overwrite, Alt-click to cut, right-click to clear."
          : "Save the current sound here"
      }
    >
      {pad}
    </Hint>
  );
}

export function ScenesPanel() {
  const transition = useStudio((state) => state.transition);
  const morphBeats = useStudio((state) => state.morphBeats);
  const bpm = useStudio((state) => state.bpm);
  const patch = useStudio((state) => state.patch);
  const seconds = (morphBeats * 60) / bpm;
  return (
    <Panel
      actions={
        <Segmented
          ariaLabel="Scene transition"
          onChange={(value) => patch({ transition: value })}
          options={[
            {
              hint: "Glide prompts and knobs to the scene",
              label: "Morph",
              value: "morph",
            },
            {
              hint: "Jump at once, flushing the old style",
              label: "Cut",
              value: "cut",
            },
          ]}
          size="sm"
          value={transition}
        />
      }
      className="shrink-0"
      label="Scenes"
    >
      <div className="grid grid-cols-4 gap-1.5 px-3">
        {Array.from({ length: 8 }, (_, slot) => (
          <ScenePad key={`scene-${slot.toString()}`} slot={slot} />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-white/50 text-xs">
        <span>Morph over</span>
        <div className="flex items-center gap-0.5">
          {BEAT_CHOICES.map((beats) => (
            <button
              className={cn(
                "h-6 min-w-6 rounded-md px-1 font-mono text-[11px] transition-colors",
                beats === morphBeats
                  ? "bg-white/[0.14] text-white"
                  : "text-white/45 hover:text-white"
              )}
              disabled={transition === "cut"}
              key={beats}
              onClick={() => patch({ morphBeats: beats })}
              type="button"
            >
              {beats}
            </button>
          ))}
        </div>
        <span className="font-mono tabular-nums">
          {transition === "cut" ? "instant" : `${seconds.toFixed(1)} s`}
        </span>
      </div>
    </Panel>
  );
}
