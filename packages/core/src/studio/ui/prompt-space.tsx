"use client";

import { cn } from "@workspace/ui/lib/utils";
import { Crosshair, Orbit, Sparkles, Trash2 } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import useMeasure from "react-use-measure";
import { addTextPrompt, removePrompt } from "../actions.ts";
import { currentFrame } from "../monitor.ts";
import { clamp, useStudio } from "../store.ts";
import type { Point, StylePrompt } from "../types.ts";
import { Hint, Toggle } from "./kit.tsx";

const EDGE = 0.04;
const FRICTION = 2.4;
const MAX_FLING = 1.6;
const ORBIT_RATE = 0.32;

interface Drag {
  id: string;
  moved: boolean;
  samples: { t: number; x: number; y: number }[];
}

function hexAlpha(hex: string, alpha: number): string {
  const value = Math.round(clamp(alpha, 0, 1) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${value}`;
}

function drawField(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  prompts: StylePrompt[],
  shares: number[],
  listener: Point,
  time: number
): void {
  const context = canvas.getContext("2d");
  if (!context || width === 0) {
    return;
  }
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const size = Math.min(width, height);
  context.globalCompositeOperation = "lighter";
  prompts.forEach((prompt, index) => {
    const share = shares[index] ?? 0;
    const x = prompt.x * width;
    const y = prompt.y * height;
    const radius = size * (0.14 + prompt.weight * 0.26);
    const glow = context.createRadialGradient(x, y, 0, x, y, radius);
    const strength = prompt.muted ? 0.05 : 0.1 + share * 0.35;
    glow.addColorStop(0, hexAlpha(prompt.color, strength));
    glow.addColorStop(1, hexAlpha(prompt.color, 0));
    context.fillStyle = glow;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  });
  context.globalCompositeOperation = "source-over";
  const lx = listener.x * width;
  const ly = listener.y * height;
  prompts.forEach((prompt, index) => {
    const share = shares[index] ?? 0;
    if (share <= 0.002) {
      return;
    }
    context.beginPath();
    context.moveTo(prompt.x * width, prompt.y * height);
    context.lineTo(lx, ly);
    context.strokeStyle = hexAlpha(prompt.color, 0.25 + share * 0.65);
    context.lineWidth = 0.75 + share * 5;
    context.setLineDash([3 + share * 6, 7]);
    context.lineDashOffset = -time * 0.012 * (0.4 + share * 2.5);
    context.stroke();
  });
  context.setLineDash([]);
  const meter = currentFrame().meter;
  const level = Math.min(1, (meter.rmsL + meter.rmsR) * 2.2);
  context.beginPath();
  context.arc(lx, ly, 18 + level * 26, 0, Math.PI * 2);
  context.strokeStyle = `rgba(255,255,255,${0.08 + level * 0.35})`;
  context.lineWidth = 1.5;
  context.stroke();
}

type Velocities = Map<string, { vx: number; vy: number }>;

/** Move flung prompts one step. Returns null when nothing moved. */
function drift(
  prompts: StylePrompt[],
  velocities: Velocities,
  held: string | undefined,
  float: boolean,
  dt: number
): StylePrompt[] | null {
  let moved = false;
  const decay = Math.exp(-FRICTION * dt);
  const next = prompts.map((prompt) => {
    const velocity = velocities.get(prompt.id);
    if (!velocity || held === prompt.id) {
      return prompt;
    }
    let x = prompt.x + velocity.vx * dt;
    let y = prompt.y + velocity.vy * dt;
    if (x < EDGE || x > 1 - EDGE) {
      velocity.vx = -velocity.vx;
      x = clamp(x, EDGE, 1 - EDGE);
    }
    if (y < EDGE || y > 1 - EDGE) {
      velocity.vy = -velocity.vy;
      y = clamp(y, EDGE, 1 - EDGE);
    }
    if (!float) {
      velocity.vx *= decay;
      velocity.vy *= decay;
      if (Math.hypot(velocity.vx, velocity.vy) < 0.004) {
        velocities.delete(prompt.id);
      }
    }
    moved = true;
    return { ...prompt, x, y };
  });
  return moved ? next : null;
}

function AddField({ at, onDone }: { at: Point; onDone: () => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="absolute z-30 -translate-x-1/2 -translate-y-1/2"
      onPointerDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        addTextPrompt(text, at);
        onDone();
      }}
      style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
    >
      <input
        autoFocus={true}
        className="w-56 rounded-full border border-white/20 bg-black/80 px-3.5 py-1.5 text-sm text-white shadow-2xl outline-none backdrop-blur placeholder:text-white/35 focus:border-white/40"
        maxLength={180}
        onBlur={onDone}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            onDone();
          }
        }}
        placeholder="Describe a sound, then Enter"
        value={text}
      />
    </form>
  );
}

export function PromptSpace({
  prompts,
  shares,
}: {
  prompts: StylePrompt[];
  shares: number[];
}) {
  const [measure, bounds] = useMeasure();
  const field = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const velocities = useRef<Velocities>(new Map());
  const drag = useRef<Drag | null>(null);
  const [adding, setAdding] = useState<Point | null>(null);
  const [trashArmed, setTrashArmed] = useState(false);
  const [draggingPrompt, setDraggingPrompt] = useState(false);
  const listener = useStudio((state) => state.listener);
  const orbit = useStudio((state) => state.orbit);
  const float = useStudio((state) => state.float);
  const patch = useStudio((state) => state.patch);
  const view = useRef({ bounds, shares });
  view.current = { bounds, shares };

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let phase = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const studio = useStudio.getState();
      const next = drift(
        studio.prompts,
        velocities.current,
        drag.current?.id,
        studio.float,
        dt
      );
      const values: Parameters<typeof studio.patch>[0] = {};
      if (next) {
        values.prompts = next;
      }
      if (studio.orbit > 0 && drag.current?.id !== "listener") {
        phase += dt * studio.orbit * ORBIT_RATE;
        const target = {
          x: 0.5 + 0.36 * Math.sin(phase),
          y: 0.5 + 0.32 * Math.sin(phase * 1.31 + 0.9),
        };
        const pull = 1 - Math.exp(-dt * 1.6);
        values.listener = {
          x: studio.listener.x + (target.x - studio.listener.x) * pull,
          y: studio.listener.y + (target.y - studio.listener.y) * pull,
        };
      }
      if (values.prompts || values.listener) {
        studio.patch(values);
      }
      const current = useStudio.getState();
      if (canvas.current) {
        drawField(
          canvas.current,
          view.current.bounds.width,
          view.current.bounds.height,
          current.prompts,
          view.current.shares,
          current.listener,
          now
        );
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (float) {
      // Give resting prompts a gentle push so Float is visible at once.
      for (const prompt of useStudio.getState().prompts) {
        if (!velocities.current.has(prompt.id)) {
          const angle = Math.random() * Math.PI * 2;
          velocities.current.set(prompt.id, {
            vx: Math.cos(angle) * 0.05,
            vy: Math.sin(angle) * 0.05,
          });
        }
      }
    }
  }, [float]);

  const point = (event: ReactPointerEvent): Point => {
    const rect = field.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0.5, y: 0.5 };
    }
    return {
      x: clamp((event.clientX - rect.left) / rect.width, EDGE, 1 - EDGE),
      y: clamp((event.clientY - rect.top) / rect.height, EDGE, 1 - EDGE),
    };
  };

  const overTrash = (event: ReactPointerEvent): boolean => {
    const rect = field.current?.getBoundingClientRect();
    if (!rect) {
      return false;
    }
    return (
      Math.abs(event.clientX - (rect.left + rect.width / 2)) < 70 &&
      rect.bottom - event.clientY < 52 &&
      rect.bottom - event.clientY > -8
    );
  };

  const begin = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    velocities.current.delete(id);
    const at = point(event);
    drag.current = {
      id,
      moved: false,
      samples: [{ t: performance.now(), ...at }],
    };
    if (id === "listener") {
      patch({ listener: at });
    } else {
      setDraggingPrompt(true);
    }
  };

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state) {
      return;
    }
    const at = point(event);
    const now = performance.now();
    state.moved = true;
    state.samples = [
      ...state.samples.filter((sample) => now - sample.t < 90),
      { t: now, ...at },
    ];
    if (state.id === "listener") {
      patch({ listener: at });
      return;
    }
    setTrashArmed(overTrash(event));
    useStudio.getState().updatePrompt(state.id, at);
  };

  const end = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    drag.current = null;
    setDraggingPrompt(false);
    setTrashArmed(false);
    if (!state || state.id === "listener") {
      return;
    }
    if (overTrash(event)) {
      velocities.current.delete(state.id);
      removePrompt(state.id);
      return;
    }
    const first = state.samples[0];
    const latest = state.samples.at(-1);
    if (!(first && latest) || latest.t - first.t < 16) {
      return;
    }
    const seconds = (latest.t - first.t) / 1000;
    const vx = clamp((latest.x - first.x) / seconds, -MAX_FLING, MAX_FLING);
    const vy = clamp((latest.y - first.y) / seconds, -MAX_FLING, MAX_FLING);
    if (Math.hypot(vx, vy) > 0.08) {
      velocities.current.set(state.id, { vx, vy });
    }
  };

  return (
    <div className="relative min-h-0 flex-1 px-3 pb-2">
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: A 2D pointer surface. The listener and prompt buttons inside it carry the keyboard access. */}
      <div
        className="relative h-full overflow-hidden rounded-xl border border-white/[0.06] bg-[length:22px_22px] bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.05)_1px,transparent_1px)]"
        onDoubleClick={(event) => {
          if (
            event.target === event.currentTarget ||
            event.target === canvas.current
          ) {
            const rect = event.currentTarget.getBoundingClientRect();
            setAdding({
              x: clamp((event.clientX - rect.left) / rect.width, 0.12, 0.88),
              y: clamp((event.clientY - rect.top) / rect.height, 0.08, 0.92),
            });
          }
        }}
        onLostPointerCapture={end}
        onPointerDown={(event) => begin(event, "listener")}
        onPointerMove={move}
        ref={(node) => {
          field.current = node;
          measure(node);
        }}
        role="application"
      >
        <canvas
          className="pointer-events-none absolute inset-0 size-full"
          ref={canvas}
        />
        {prompts.map((prompt, index) => {
          const share = shares[index] ?? 0;
          const size = 18 + prompt.weight * 26;
          return (
            <div
              className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center"
              key={prompt.id}
              style={{ left: `${prompt.x * 100}%`, top: `${prompt.y * 100}%` }}
            >
              <button
                aria-label={`${prompt.text}, ${Math.round(share * 100)} percent. Drag to move, scroll to change weight, double-click to mute.`}
                className={cn(
                  "relative cursor-grab touch-none rounded-full border-2 transition-[box-shadow,opacity] active:cursor-grabbing",
                  prompt.muted && "border-dashed opacity-40"
                )}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  useStudio
                    .getState()
                    .updatePrompt(prompt.id, { muted: !prompt.muted });
                }}
                onLostPointerCapture={end}
                onPointerDown={(event) => begin(event, prompt.id)}
                onPointerMove={move}
                onWheel={(event) => {
                  const delta = event.deltaY < 0 ? 0.04 : -0.04;
                  useStudio
                    .getState()
                    .setPromptWeight(prompt.id, prompt.weight + delta);
                }}
                style={{
                  backgroundColor: `${prompt.color}${prompt.muted ? "22" : "55"}`,
                  borderColor: prompt.color,
                  boxShadow:
                    share > 0
                      ? `0 0 ${10 + share * 40}px ${prompt.color}`
                      : undefined,
                  height: size,
                  width: size,
                }}
                type="button"
              />
              <span className="pointer-events-none ml-2 flex max-w-48 items-baseline gap-1.5 whitespace-nowrap rounded-full bg-black/55 px-2 py-0.5 text-[12px] text-white/90 backdrop-blur-sm">
                <span className="truncate">{prompt.text}</span>
                <span className="font-mono text-[10.5px] text-white/50 tabular-nums">
                  {Math.round(share * 100)}%
                </span>
              </span>
            </div>
          );
        })}
        <button
          aria-label="Listener. Drag to move through the space. Arrow keys nudge it."
          className="absolute z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 border-white bg-black/60 shadow-[0_0_24px_rgba(255,255,255,0.35)] active:cursor-grabbing"
          onKeyDown={(event) => {
            const step = event.shiftKey ? 0.05 : 0.01;
            const moves: Record<string, Point> = {
              ArrowDown: { x: 0, y: step },
              ArrowLeft: { x: -step, y: 0 },
              ArrowRight: { x: step, y: 0 },
              ArrowUp: { x: 0, y: -step },
            };
            const by = moves[event.key];
            if (by) {
              event.preventDefault();
              event.stopPropagation();
              patch({
                listener: {
                  x: clamp(listener.x + by.x, EDGE, 1 - EDGE),
                  y: clamp(listener.y + by.y, EDGE, 1 - EDGE),
                },
              });
            }
          }}
          onLostPointerCapture={end}
          onPointerDown={(event) => begin(event, "listener")}
          onPointerMove={move}
          style={{ left: `${listener.x * 100}%`, top: `${listener.y * 100}%` }}
          type="button"
        >
          <span className="size-1.5 rounded-full bg-white" />
        </button>
        {adding ? (
          <AddField at={adding} onDone={() => setAdding(null)} />
        ) : null}
        <div
          className={cn(
            "pointer-events-none absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-all",
            draggingPrompt ? "opacity-100" : "translate-y-2 opacity-0",
            trashArmed
              ? "border-rose-400 bg-rose-500/30 text-white"
              : "border-white/15 bg-black/60 text-white/60"
          )}
        >
          <Trash2 className="size-3.5" />
          Drop to remove
        </div>
        {prompts.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/45">
            Double-click anywhere to place a prompt.
          </div>
        ) : null}
      </div>
      <div className="pointer-events-none absolute top-2 right-5 left-5 z-20 flex items-center justify-between">
        <div className="pointer-events-auto flex items-center gap-1.5">
          <Toggle
            active={orbit > 0}
            color="#84f3ed"
            hint="The listener drifts through the space on its own"
            onClick={() => patch({ orbit: orbit > 0 ? 0 : 0.5 })}
          >
            <Orbit className="size-3.5" />
            Orbit
          </Toggle>
          {orbit > 0 ? (
            <input
              aria-label="Orbit speed"
              className="w-20 accent-[#84f3ed]"
              max={1}
              min={0.05}
              onChange={(event) => patch({ orbit: Number(event.target.value) })}
              step={0.01}
              type="range"
              value={orbit}
            />
          ) : null}
          <Toggle
            active={float}
            color="#ae5cff"
            hint="Prompts keep drifting and bounce off the walls. Fling one to start it."
            onClick={() => patch({ float: !float })}
          >
            <Sparkles className="size-3.5" />
            Float
          </Toggle>
        </div>
        <Hint label="Center the listener">
          <button
            aria-label="Center the listener"
            className="pointer-events-auto flex size-7 items-center justify-center rounded-full bg-black/50 text-white/60 hover:text-white"
            onClick={() => patch({ listener: { x: 0.5, y: 0.5 } })}
            type="button"
          >
            <Crosshair className="size-3.5" />
          </button>
        </Hint>
      </div>
    </div>
  );
}
