"use client";

import type { PromptLine } from "./types.ts";

interface SliderProps {
  label: string;
  max: number;
  min: number;
  note?: string;
  onChange: (value: number) => void;
  step: number;
  value: number;
}

interface PromptStackProps {
  draft: string;
  onAdd: () => void;
  onDraft: (value: string) => void;
  onRemove: (id: string) => void;
  onText: (id: string, text: string) => void;
  onWeight: (id: string, weight: number) => void;
  prompts: PromptLine[];
}

function shareLabel(weight: number, total: number): string {
  if (total <= 0) {
    return "0%";
  }
  return `${Math.round((weight / total) * 100)}%`;
}

export function Slider({
  label,
  max,
  min,
  note,
  onChange,
  step,
  value,
}: SliderProps) {
  const shown = Number.isInteger(step) ? String(value) : value.toFixed(2);
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="text-white/70 tabular-nums">{shown}</span>
      </span>
      <input
        className="mt-1 w-full accent-orange-500"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
      {note ? (
        <span className="mt-0.5 block text-white/45 text-xs">{note}</span>
      ) : null}
    </label>
  );
}

export function PromptStack({
  draft,
  onAdd,
  onDraft,
  onRemove,
  onText,
  onWeight,
  prompts,
}: PromptStackProps) {
  const total = prompts.reduce((sum, prompt) => sum + prompt.weight, 0);
  const full = prompts.length >= 8;

  return (
    <section className="flex min-h-0 flex-col">
      <h1 className="font-medium text-2xl tracking-tight">Sounds</h1>
      <p className="mt-1 text-sm text-white/55">
        Type any description. Add more than one and set how much each line
        counts.
      </p>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd();
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-base outline-none placeholder:text-white/30 focus:border-orange-400"
          onChange={(event) => onDraft(event.target.value)}
          placeholder="string ensemble, dusty breakbeat, rain on a tin roof"
          value={draft}
        />
        <button
          className="rounded-lg bg-orange-500 px-4 py-2 font-medium text-black disabled:opacity-40"
          disabled={full || draft.trim().length === 0}
          type="submit"
        >
          Add
        </button>
      </form>
      <ul className="mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-auto pr-1">
        {prompts.length === 0 ? (
          <li className="text-sm text-white/45">
            Nothing here yet. An empty list plays warm analog pads.
          </li>
        ) : null}
        {prompts.map((prompt) => (
          <li
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-3"
            key={prompt.id}
          >
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: prompt.color }}
              />
              <input
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                onChange={(event) => onText(prompt.id, event.target.value)}
                value={prompt.text}
              />
              <span className="w-10 text-right text-white/60 text-xs tabular-nums">
                {shareLabel(prompt.weight, total)}
              </span>
              <button
                className="text-white/45 text-xs hover:text-white"
                onClick={() => onRemove(prompt.id)}
                type="button"
              >
                Remove
              </button>
            </div>
            <input
              aria-label={`${prompt.text} weight`}
              className="mt-2 w-full accent-orange-500"
              max={100}
              min={0}
              onChange={(event) =>
                onWeight(prompt.id, Number(event.target.value))
              }
              step={1}
              type="range"
              value={prompt.weight}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
