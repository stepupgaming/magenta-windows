"use client";

import { cn } from "@workspace/ui/lib/utils";
import { AudioLines, BookOpen, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { cycleColor, removePrompt } from "../actions.ts";
import { useStudio } from "../store.ts";
import { MAX_PROMPTS, type StylePrompt } from "../types.ts";
import { Fader } from "./fader.tsx";
import { Hint } from "./kit.tsx";

function PromptText({ prompt }: { prompt: StylePrompt }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) {
      return;
    }
    const text = draft.trim();
    if (text && text !== prompt.text) {
      useStudio
        .getState()
        .updatePrompt(prompt.id, { text: text.slice(0, 180) });
    }
    setDraft(null);
  };
  if (prompt.kind === "audio") {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <AudioLines className="size-3.5 shrink-0 text-white/50" />
        <span className="truncate text-[13.5px] text-white/90">
          {prompt.text}
        </span>
        {prompt.peaks ? (
          <svg
            aria-hidden="true"
            className="hidden h-4 w-20 shrink-0 opacity-70 xl:block"
            preserveAspectRatio="none"
            viewBox={`0 0 ${prompt.peaks.length} 2`}
          >
            {prompt.peaks.map((peak, index) => (
              <rect
                fill={prompt.color}
                height={Math.max(0.08, peak * 2)}
                key={`${prompt.id}-${index.toString()}`}
                width={0.6}
                x={index}
                y={1 - Math.max(0.04, peak)}
              />
            ))}
          </svg>
        ) : null}
        <span className="shrink-0 font-mono text-[10.5px] text-white/40">
          {(prompt.audioSeconds ?? 0).toFixed(1)}s
        </span>
      </div>
    );
  }
  return (
    <input
      aria-label="Prompt text"
      className="w-full min-w-0 truncate rounded-md bg-transparent px-1 py-0.5 text-[13.5px] text-white/90 outline-none transition-colors hover:bg-white/[0.04] focus:bg-white/[0.06]"
      maxLength={180}
      onBlur={commit}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      spellCheck={false}
      value={draft ?? prompt.text}
    />
  );
}

function RowButton({
  active,
  activeClass,
  children,
  hint,
  onClick,
}: {
  active: boolean;
  activeClass: string;
  children: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <Hint label={hint}>
      <button
        aria-pressed={active}
        className={cn(
          "size-6 rounded-md font-semibold text-[10.5px] transition-colors",
          active
            ? activeClass
            : "text-white/40 hover:bg-white/[0.07] hover:text-white/80"
        )}
        onClick={onClick}
        type="button"
      >
        {children}
      </button>
    </Hint>
  );
}

function PromptRow({
  index,
  prompt,
  share,
}: {
  index: number;
  prompt: StylePrompt;
  share: number;
}) {
  const update = useStudio((state) => state.updatePrompt);
  const setWeight = useStudio((state) => state.setPromptWeight);
  const silent = share <= 0;
  return (
    <motion.li
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "group relative grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-xl border px-2.5 py-2 transition-colors",
        silent
          ? "border-white/[0.04] bg-white/[0.012]"
          : "border-white/[0.07] bg-white/[0.03]"
      )}
      exit={{ height: 0, opacity: 0, paddingBottom: 0, paddingTop: 0 }}
      initial={{ opacity: 0, y: 6 }}
      layout="position"
      transition={{ duration: 0.18 }}
    >
      <Hint label="Change color">
        <button
          aria-label={`Prompt ${index + 1} color`}
          className="flex size-6 items-center justify-center rounded-full font-mono font-semibold text-[10px] text-black transition-transform hover:scale-110"
          onClick={() => cycleColor(prompt)}
          style={{
            backgroundColor: prompt.color,
            boxShadow: silent
              ? undefined
              : `0 0 ${6 + share * 22}px ${prompt.color}`,
            opacity: silent ? 0.45 : 1,
          }}
          type="button"
        >
          {index + 1}
        </button>
      </Hint>
      <PromptText prompt={prompt} />
      <span
        className={cn(
          "w-11 text-right font-mono text-[13px] tabular-nums transition-colors",
          silent ? "text-white/25" : "text-white"
        )}
      >
        {Math.round(share * 100)}%
      </span>
      <span />
      <Fader
        color={prompt.color}
        effective={share}
        label={`${prompt.text} weight`}
        learnId={`slot.${index + 1}`}
        muted={prompt.muted}
        onChange={(value) => setWeight(prompt.id, value)}
        value={prompt.weight}
      />
      <div className="flex items-center gap-0.5">
        <RowButton
          active={prompt.muted}
          activeClass="bg-white/80 text-black"
          hint="Mute"
          onClick={() => update(prompt.id, { muted: !prompt.muted })}
        >
          M
        </RowButton>
        <RowButton
          active={prompt.solo}
          activeClass="bg-amber-300 text-black"
          hint="Solo this prompt"
          onClick={() => update(prompt.id, { solo: !prompt.solo })}
        >
          S
        </RowButton>
        <Hint label="Remove">
          <button
            aria-label={`Remove ${prompt.text}`}
            className="flex size-6 items-center justify-center rounded-md text-white/35 transition-colors hover:bg-white/[0.07] hover:text-white"
            onClick={() => removePrompt(prompt.id)}
            type="button"
          >
            <X className="size-3.5" />
          </button>
        </Hint>
      </div>
    </motion.li>
  );
}

export function PromptList({
  onLibrary,
  prompts,
  shares,
}: {
  onLibrary: () => void;
  prompts: StylePrompt[];
  shares: number[];
}) {
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-2">
      <AnimatePresence initial={false}>
        {prompts.map((prompt, index) => (
          <PromptRow
            index={index}
            key={prompt.id}
            prompt={prompt}
            share={shares[index] ?? 0}
          />
        ))}
      </AnimatePresence>
      {prompts.length === 0 ? (
        <li className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
          <span className="text-sm text-white/70">
            No prompts. The model picks its own style.
          </span>
          <button
            className="flex h-8 items-center gap-1.5 rounded-full bg-white px-4 font-medium text-black text-xs"
            onClick={onLibrary}
            type="button"
          >
            <BookOpen className="size-3.5" />
            Browse the sound library
          </button>
          <span className="text-white/40 text-xs">
            Or describe a sound below, or drop an audio file here.
          </span>
        </li>
      ) : null}
      {prompts.length > 0 && prompts.length < MAX_PROMPTS ? (
        <li className="mt-0.5 flex h-11 shrink-0 items-center justify-center gap-1 rounded-xl border border-white/[0.06] border-dashed text-[12px] text-white/35">
          {MAX_PROMPTS - prompts.length} more{" "}
          {MAX_PROMPTS - prompts.length === 1 ? "slot" : "slots"}. Type below,
          drop audio, or
          <button
            className="text-white/65 underline-offset-2 hover:text-white hover:underline"
            onClick={onLibrary}
            type="button"
          >
            browse the library
          </button>
        </li>
      ) : null}
    </ul>
  );
}
