"use client";

import type { PromptChip } from "./types.ts";

interface SurfaceProps {
  cursor: { x: number; y: number };
  draft: string;
  onAdd: () => void;
  onClose: () => void;
  onDraft: (value: string) => void;
  onMoveCursor: (x: number, y: number) => void;
  onMovePrompt: (id: string, x: number, y: number) => void;
  onRemove: (id: string) => void;
  prompts: PromptChip[];
}

function clampPoint(
  clientX: number,
  clientY: number,
  rect: DOMRect
): { x: number; y: number } {
  return {
    x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  };
}

export function weightsFor(
  prompts: PromptChip[],
  cursor: { x: number; y: number }
): number[] {
  const raw = prompts.map((prompt) => {
    const distance =
      Math.hypot(prompt.x - cursor.x, prompt.y - cursor.y) + 0.08;
    return 1 / distance;
  });
  const total = raw.reduce((sum, value) => sum + value, 0) || 1;
  return raw.map((value) => value / total);
}

export function PromptSurface({
  cursor,
  draft,
  onAdd,
  onClose,
  onDraft,
  onMoveCursor,
  onMovePrompt,
  onRemove,
  prompts,
}: SurfaceProps) {
  const weights = weightsFor(prompts, cursor);

  return (
    <section className="rounded-2xl border border-white/10 bg-black/55 px-4 pt-3 pb-3 shadow-2xl backdrop-blur-xl">
      <div className="mb-2 flex items-center justify-between text-[10px] text-white/45 uppercase tracking-[0.22em]">
        <span>Text prompt</span>
        <button className="text-white/60" onClick={onClose} type="button">
          Hide
        </button>
      </div>
      <div className="relative h-56 overflow-hidden rounded-xl">
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
        >
          {prompts.map((prompt) => (
            <line
              key={prompt.id}
              stroke="rgba(255,255,255,0.28)"
              strokeWidth="1.25"
              vectorEffect="non-scaling-stroke"
              x1={cursor.x * 100}
              x2={prompt.x * 100}
              y1={cursor.y * 100}
              y2={prompt.y * 100}
            />
          ))}
        </svg>
        {prompts.map((prompt, index) => (
          <div
            className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center"
            key={prompt.id}
            style={{ left: `${prompt.x * 100}%`, top: `${prompt.y * 100}%` }}
          >
            <span
              className="z-10 flex h-5 w-5 items-center justify-center rounded-full border bg-black/80 font-medium text-[10px]"
              style={{ borderColor: prompt.color, color: prompt.color }}
            >
              {index + 1}
            </span>
            <button
              className="-ml-1 flex items-center whitespace-nowrap rounded-full border border-white/15 bg-black/75 py-1 pr-2 pl-3 text-sm text-white"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (event.buttons !== 1) {
                  return;
                }
                const field = event.currentTarget.parentElement?.parentElement;
                if (!field) {
                  return;
                }
                const rect = field.getBoundingClientRect();
                onMovePrompt(
                  prompt.id,
                  Math.min(
                    1,
                    Math.max(0, (event.clientX - rect.left) / rect.width)
                  ),
                  Math.min(
                    1,
                    Math.max(0, (event.clientY - rect.top) / rect.height)
                  )
                );
              }}
              type="button"
            >
              {prompt.text}
            </button>
            <button
              aria-label={`Remove ${prompt.text}`}
              className="ml-1 text-white/35 text-xs"
              onClick={() => onRemove(prompt.id)}
              type="button"
            >
              ×
            </button>
          </div>
        ))}
        <button
          aria-label="Mix cursor"
          className="absolute z-20 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black"
          onPointerDown={(event) => {
            const field = event.currentTarget.parentElement;
            if (!(field instanceof HTMLDivElement)) {
              return;
            }
            field.dataset.drag = "cursor";
            event.currentTarget.setPointerCapture(event.pointerId);
            const point = clampPoint(
              event.clientX,
              event.clientY,
              field.getBoundingClientRect()
            );
            onMoveCursor(point.x, point.y);
          }}
          onPointerMove={(event) => {
            if (event.buttons !== 1) {
              return;
            }
            const field = event.currentTarget.parentElement;
            if (
              !(field instanceof HTMLDivElement) ||
              field.dataset.drag !== "cursor"
            ) {
              return;
            }
            const point = clampPoint(
              event.clientX,
              event.clientY,
              field.getBoundingClientRect()
            );
            onMoveCursor(point.x, point.y);
          }}
          style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
          type="button"
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {prompts.map((prompt, index) => (
          <span className="text-[11px] text-white/75" key={prompt.id}>
            <span style={{ color: prompt.color }}>●</span> {prompt.text}{" "}
            {Math.round((weights[index] ?? 0) * 100)}%
          </span>
        ))}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd();
        }}
      >
        <input
          className="flex-1 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-sm text-white outline-none placeholder:text-white/30"
          maxLength={80}
          onChange={(event) => onDraft(event.target.value)}
          placeholder="Add a prompt"
          value={draft}
        />
        <button
          className="rounded-full bg-white px-3 py-1.5 text-black text-sm"
          type="submit"
        >
          Add
        </button>
      </form>
    </section>
  );
}
