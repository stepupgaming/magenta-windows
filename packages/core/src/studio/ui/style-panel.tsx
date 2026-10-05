"use client";

import { cn } from "@workspace/ui/lib/utils";
import { BookOpen, FileAudio } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { decodeFile } from "../clips.ts";
import { promptShares } from "../spec.ts";
import { useStudio } from "../store.ts";
import type { StylePrompt } from "../types.ts";
import type { AudioSource } from "./audio-dialog.tsx";
import { Composer } from "./composer.tsx";
import { Hint, Panel, SectionLabel, Segmented } from "./kit.tsx";
import { PromptList } from "./prompt-list.tsx";
import { PromptSpace } from "./prompt-space.tsx";

const EXTENSION = /\.[^.]+$/;

function ShareBar({
  prompts,
  shares,
}: {
  prompts: StylePrompt[];
  shares: number[];
}) {
  const silent = shares.every((share) => share <= 0);
  return (
    <Hint
      label={
        silent
          ? "Nothing is audible, so the model picks its own style"
          : "How much of the blend each prompt gets right now"
      }
    >
      <div className="flex h-1.5 w-full min-w-24 max-w-72 overflow-hidden rounded-full bg-white/[0.06]">
        {prompts.map((prompt, index) => (
          <motion.span
            animate={{ width: `${(shares[index] ?? 0) * 100}%` }}
            className="h-full"
            key={prompt.id}
            style={{ backgroundColor: prompt.color }}
            transition={{ duration: 0.12 }}
          />
        ))}
      </div>
    </Hint>
  );
}

export function StylePanel({
  inputRef,
  onAudio,
  onLibrary,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onAudio: (source: AudioSource) => void;
  onLibrary: () => void;
}) {
  const prompts = useStudio((state) => state.prompts);
  const mixMode = useStudio((state) => state.mixMode);
  const listener = useStudio((state) => state.listener);
  const patch = useStudio((state) => state.patch);
  const shares = useMemo(
    () => promptShares(prompts, mixMode, listener),
    [prompts, mixMode, listener]
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);

  const openFile = async (file: File) => {
    try {
      const clip = await decodeFile(file);
      onAudio({ clip, name: file.name.replace(EXTENSION, "") });
    } catch {
      toast.error("That file did not decode as audio.");
    }
  };

  return (
    <Panel
      actions={
        <Hint keys="/" label="Hundreds of sounds the model knows, searchable">
          <button
            className="flex h-7 items-center gap-1.5 rounded-full border border-white/[0.09] px-3 font-medium text-white/75 text-xs transition-colors hover:border-white/25 hover:text-white"
            onClick={onLibrary}
            type="button"
          >
            <BookOpen className="size-3.5" />
            Library
          </button>
        </Hint>
      }
      className={cn(
        "flex-1 transition-colors",
        dropping && "border-[#ff4c8d]/60"
      )}
      label={
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <SectionLabel>Style</SectionLabel>
          <Segmented
            ariaLabel="Mix mode"
            onChange={(value) => patch({ mixMode: value })}
            options={[
              {
                hint: "Set each prompt's weight on its fader",
                label: "List",
                value: "list",
              },
              {
                hint: "Move a listener through prompts placed in 2D. Closer is louder.",
                label: "Space",
                value: "space",
              },
            ]}
            size="sm"
            value={mixMode}
          />
          <ShareBar prompts={prompts} shares={shares} />
        </div>
      }
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: A drop target for audio files. The file button in the composer is the keyboard path. */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Same drop target. */}
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        onDragLeave={() => setDropping(false)}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setDropping(true);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDropping(false);
          const file = event.dataTransfer.files[0];
          if (file) {
            openFile(file).catch(() => undefined);
          }
        }}
      >
        {mixMode === "list" ? (
          <PromptList onLibrary={onLibrary} prompts={prompts} shares={shares} />
        ) : (
          <PromptSpace prompts={prompts} shares={shares} />
        )}
        {dropping ? (
          <div className="pointer-events-none absolute inset-2 z-40 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-[#ff4c8d] border-dashed bg-black/70 text-white">
            <FileAudio className="size-6" />
            <span className="text-sm">Drop to use this audio as a style</span>
          </div>
        ) : null}
      </div>
      <Composer
        inputRef={inputRef}
        onLibrary={onLibrary}
        onPickAudio={() => fileInput.current?.click()}
      />
      <input
        accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            openFile(file).catch(() => undefined);
          }
        }}
        ref={fileInput}
        type="file"
      />
    </Panel>
  );
}
