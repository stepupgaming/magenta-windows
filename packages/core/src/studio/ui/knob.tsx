"use client";

import { cn } from "@workspace/ui/lib/utils";
import type { KeyboardEvent, PointerEvent } from "react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { param, snap } from "../params.ts";
import { clamp, useLive, useStudio } from "../store.ts";
import { Hint, useLearn } from "./kit.tsx";

const SWEEP = 270;
const START = -135;
const DRAG_PIXELS = 180;

interface KnobProps {
  bipolar?: boolean;
  className?: string;
  color?: string;
  defaultValue?: number;
  disabled?: boolean;
  format?: (value: number) => string;
  hint?: string;
  label: string;
  max?: number;
  min?: number;
  onChange?: (value: number) => void;
  /** Param id from params.ts. Supplies range, value, and MIDI learn. */
  paramId?: string;
  size?: number;
  /** Return to the default when released, like a pitch wheel. */
  spring?: boolean;
  step?: number;
  value?: number;
}

function polar(cx: number, cy: number, radius: number, degrees: number) {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function arc(
  cx: number,
  cy: number,
  radius: number,
  from: number,
  to: number
): string {
  const start = polar(cx, cy, radius, from);
  const end = polar(cx, cy, radius, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} ${sweep} ${end.x} ${end.y}`;
}

function subscribeBoth(listener: () => void): () => void {
  const offStudio = useStudio.subscribe(listener);
  const offLive = useLive.subscribe(listener);
  return () => {
    offStudio();
    offLive();
  };
}

/** The live value of a param, re-rendering only when it changes. */
export function useParam(id: string | undefined): number {
  const def = id ? param(id) : undefined;
  return useSyncExternalStore(
    subscribeBoth,
    () => def?.get() ?? 0,
    () => def?.defaultValue ?? 0
  );
}

export function Knob({
  bipolar,
  className,
  color = "#ffffff",
  defaultValue,
  disabled,
  format,
  hint,
  label,
  max: maxProp,
  min: minProp,
  onChange,
  paramId,
  size = 52,
  spring,
  step: stepProp,
  value: valueProp,
}: KnobProps) {
  const def = paramId ? param(paramId) : undefined;
  const min = minProp ?? def?.min ?? 0;
  const max = maxProp ?? def?.max ?? 1;
  const step = stepProp ?? def?.step ?? 0.01;
  const fallback = defaultValue ?? def?.defaultValue ?? min;
  const show = format ?? def?.format ?? ((value: number) => value.toFixed(2));
  const bound = useParam(paramId);
  const value = valueProp ?? (def ? bound : fallback);
  const faceId = `knob-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const change = (next: number) => {
    const snapped = clamp(snap(next, step, min), min, max);
    if (onChange) {
      onChange(snapped);
    } else {
      def?.set(snapped);
    }
  };
  const changeRef = useRef(change);
  changeRef.current = change;

  const learn = useLearn(paramId);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ last: number; value: number } | null>(null);
  const springFrame = useRef(0);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = shellRef.current;
    if (!node || disabled) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      const fine = event.shiftKey ? 1 : 4;
      changeRef.current(valueRef.current + direction * step * fine);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [disabled, step]);

  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => () => window.cancelAnimationFrame(springFrame.current), []);

  const release = () => {
    drag.current = null;
    setDragging(false);
    if (!spring) {
      return;
    }
    const from = valueRef.current;
    const begin = performance.now();
    const settle = (now: number) => {
      const t = Math.min(1, (now - begin) / 380);
      const eased = 1 - (1 - t) ** 3;
      changeRef.current(from + (fallback - from) * eased);
      if (t < 1) {
        springFrame.current = window.requestAnimationFrame(settle);
      }
    };
    springFrame.current = window.requestAnimationFrame(settle);
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0) {
      return;
    }
    if (learn.armable) {
      learn.arm();
      return;
    }
    window.cancelAnimationFrame(springFrame.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { last: event.clientY, value };
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state) {
      return;
    }
    const fine = event.shiftKey ? 0.15 : 1;
    const delta =
      ((state.last - event.clientY) / DRAG_PIXELS) * (max - min) * fine;
    const next = clamp(state.value + delta, min, max);
    drag.current = { last: event.clientY, value: next };
    change(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const big = (max - min) / 10;
    const moves: Record<string, number> = {
      ArrowDown: -step,
      ArrowLeft: -step,
      ArrowRight: step,
      ArrowUp: step,
      PageDown: -big,
      PageUp: big,
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      change(value + move * (event.shiftKey ? 5 : 1));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      change(min);
    } else if (event.key === "End") {
      event.preventDefault();
      change(max);
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      change(fallback);
    }
  };

  const amount = max === min ? 0 : (clamp(value, min, max) - min) / (max - min);
  const angle = START + amount * SWEEP;
  const center = size / 2;
  const radius = size / 2 - 4;
  const zero = bipolar ? START + ((0 - min) / (max - min)) * SWEEP : START;
  const tip = polar(center, center, radius - 7, angle);
  const base = polar(center, center, radius - 15, angle);
  const atRest = Math.abs(angle - zero) < 0.5;

  const control = (
    <button
      aria-label={label}
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value}
      aria-valuetext={show(value)}
      className={cn(
        "group relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/40",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-ns-resize",
        learn.armable &&
          "ring-1 ring-sky-400/70 ring-offset-2 ring-offset-black",
        learn.armed && "animate-pulse ring-2 ring-sky-400"
      )}
      disabled={disabled}
      onDoubleClick={() => change(fallback)}
      onKeyDown={onKeyDown}
      onLostPointerCapture={release}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      role="slider"
      style={{ height: size, width: size }}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="overflow-visible"
        height={size}
        width={size}
      >
        <circle
          cx={center}
          cy={center}
          fill={`url(#${faceId})`}
          r={radius - 9}
          stroke="rgba(255,255,255,0.08)"
        />
        <path
          d={arc(center, center, radius, START, START + SWEEP)}
          fill="none"
          stroke="rgba(255,255,255,0.09)"
          strokeLinecap="round"
          strokeWidth={3}
        />
        {atRest ? null : (
          <path
            d={arc(
              center,
              center,
              radius,
              Math.min(zero, angle),
              Math.max(zero, angle)
            )}
            fill="none"
            stroke={color}
            strokeLinecap="round"
            strokeWidth={3}
            style={{
              filter: dragging ? `drop-shadow(0 0 6px ${color})` : undefined,
            }}
          />
        )}
        <line
          stroke={dragging ? color : "rgba(255,255,255,0.85)"}
          strokeLinecap="round"
          strokeWidth={2}
          x1={base.x}
          x2={tip.x}
          y1={base.y}
          y2={tip.y}
        />
        <defs>
          <radialGradient cx="40%" cy="30%" id={faceId} r="75%">
            <stop offset="0%" stopColor="#2a2730" />
            <stop offset="100%" stopColor="#0e0d11" />
          </radialGradient>
        </defs>
      </svg>
      {learn.mapped ? (
        <span className="absolute -top-1 -right-1 rounded-full bg-sky-500 px-1 font-mono text-[8px] text-black leading-3">
          M
        </span>
      ) : null}
    </button>
  );

  return (
    <div
      className={cn("flex select-none flex-col items-center gap-1", className)}
      ref={shellRef}
    >
      {hint ? <Hint label={hint}>{control}</Hint> : control}
      <span className="max-w-20 truncate text-center font-medium text-[10.5px] text-white/50 leading-none">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-[10.5px] tabular-nums leading-none transition-colors",
          dragging ? "text-white" : "text-white/70"
        )}
      >
        {show(value)}
      </span>
    </div>
  );
}
