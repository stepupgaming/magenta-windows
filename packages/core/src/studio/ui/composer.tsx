"use client";

import { cn } from "@workspace/ui/lib/utils";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Dices,
  FileAudio,
  Plus,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { addTextPrompt } from "../actions.ts";
import { ALL_IDEAS, PROMPT_SHELVES, randomIdea } from "../library.ts";
import { useStudio } from "../store.ts";
import { MAX_PROMPTS } from "../types.ts";
import { Hint } from "./kit.tsx";

const PLACEHOLDER_EVERY = 3200;

export function Composer({
  inputRef,
  onLibrary,
  onPickAudio,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onLibrary: () => void;
  onPickAudio: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [shelf, setShelf] = useState(0);
  const [hintIndex, setHintIndex] = useState(0);
  const rocker = useRef(-1);
  const prompts = useStudio((state) => state.prompts);
  const full = prompts.length >= MAX_PROMPTS;
  const present = new Set(prompts.map((prompt) => prompt.text.toLowerCase()));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setHintIndex((index) => (index + 1) % ALL_IDEAS.length);
    }, PLACEHOLDER_EVERY);
    return () => window.clearInterval(timer);
  }, []);

  const submit = () => {
    if (addTextPrompt(draft)) {
      setDraft("");
      rocker.current = -1;
    }
  };

  const step = (direction: number) => {
    rocker.current =
      (rocker.current + direction + ALL_IDEAS.length) % ALL_IDEAS.length;
    setDraft(ALL_IDEAS[rocker.current] ?? "");
  };

  const placeholder = full
    ? "Eight prompts is the most the model blends"
    : `Describe a sound, like “${ALL_IDEAS[(hintIndex * 7) % ALL_IDEAS.length]}”`;

  return (
    <div className="shrink-0 border-white/[0.06] border-t px-3 pt-2.5 pb-3">
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="relative flex min-w-0 flex-1 items-center rounded-xl border border-white/[0.09] bg-black/30 transition-colors focus-within:border-white/25">
          <div className="flex flex-col pl-1">
            <button
              aria-label="Previous suggestion"
              className="flex h-3.5 w-5 items-center justify-center text-white/35 hover:text-white"
              onClick={() => step(-1)}
              tabIndex={-1}
              type="button"
            >
              <ChevronUp className="size-3" />
            </button>
            <button
              aria-label="Next suggestion"
              className="flex h-3.5 w-5 items-center justify-center text-white/35 hover:text-white"
              onClick={() => step(1)}
              tabIndex={-1}
              type="button"
            >
              <ChevronDown className="size-3" />
            </button>
          </div>
          <input
            aria-label="New prompt"
            className="h-10 min-w-0 flex-1 bg-transparent px-2 text-[14px] text-white outline-none placeholder:text-white/30"
            disabled={full}
            maxLength={180}
            onChange={(event) => {
              setDraft(event.target.value);
              rocker.current = -1;
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "ArrowUp") {
                event.preventDefault();
                step(-1);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                step(1);
              } else if (event.key === "Escape") {
                setDraft("");
                event.currentTarget.blur();
              }
            }}
            placeholder={placeholder}
            ref={inputRef}
            spellCheck={false}
            value={draft}
          />
          <button
            aria-label="Add prompt"
            className="mr-1 flex h-8 items-center gap-1 rounded-lg bg-white px-3 font-medium text-black text-xs transition-opacity disabled:opacity-25"
            disabled={full || draft.trim().length === 0}
            type="submit"
          >
            <Plus className="size-3.5" />
            Add
          </button>
        </div>
        <Hint label="Add a random idea">
          <button
            aria-label="Add a random idea"
            className="flex size-10 items-center justify-center rounded-xl border border-white/[0.09] bg-black/30 text-white/70 transition-colors hover:border-white/25 hover:text-white disabled:opacity-30"
            disabled={full}
            onClick={() =>
              addTextPrompt(randomIdea(prompts.map((prompt) => prompt.text)))
            }
            type="button"
          >
            <Dices className="size-4" />
          </button>
        </Hint>
        <Hint label="Use an audio file as a style. You can also drop one here.">
          <button
            aria-label="Add an audio prompt"
            className="flex size-10 items-center justify-center rounded-xl border border-white/[0.09] bg-black/30 text-white/70 transition-colors hover:border-white/25 hover:text-white disabled:opacity-30"
            disabled={full}
            onClick={onPickAudio}
            type="button"
          >
            <FileAudio className="size-4" />
          </button>
        </Hint>
      </form>
      <div className="mt-2 flex items-center gap-2">
        <button
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-white/[0.08] px-2.5 font-medium text-[11px] text-white/80 transition-colors hover:bg-white/[0.14] hover:text-white"
          onClick={onLibrary}
          type="button"
        >
          <BookOpen className="size-3.5" />
          Browse all
        </button>
        <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-black/30 p-0.5">
          {PROMPT_SHELVES.map((item, index) => (
            <button
              className={cn(
                "h-6 rounded-full px-2.5 font-medium text-[11px] transition-colors",
                index === shelf
                  ? "bg-white/[0.12] text-white"
                  : "text-white/45 hover:text-white/80"
              )}
              key={item.label}
              onClick={() => setShelf(index)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
          {(PROMPT_SHELVES[shelf]?.ideas ?? []).map((idea) => {
            const added = present.has(idea.toLowerCase());
            return (
              <button
                className={cn(
                  "h-6 shrink-0 rounded-full border px-2.5 text-[11.5px] transition-colors",
                  added
                    ? "border-white/[0.04] text-white/25"
                    : "border-white/[0.09] text-white/70 hover:border-white/30 hover:bg-white/[0.05] hover:text-white"
                )}
                disabled={added || full}
                key={idea}
                onClick={() => addTextPrompt(idea)}
                type="button"
              >
                {idea}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
