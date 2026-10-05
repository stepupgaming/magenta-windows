"use client";

import { cn } from "@workspace/ui/lib/utils";
import type { KeyboardEvent, PointerEvent } from "react";
import { useRef, useState } from "react";
import { clamp } from "../store.ts";
import { useLearn } from "./kit.tsx";

interface FaderProps {
  className?: string;
  color: string;
  defaultValue?: number;
  /** Share of the blend this prompt actually gets, drawn as a marker. */
  effective?: number;
  label: string;
  learnId?: string;
  muted?: boolean;
  onChange: (value: number) => void;
  value: number;
}

export function Fader({
  className,
  color,
  defaultValue = 0.6,
  effective,
  label,
  learnId,
  muted,
  onChange,
  value,
}: FaderProps) {
  const track = useRef<HTMLDivElement>(null);
  const fine = useRef<{ last: number; value: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const learn = useLearn(learnId);

  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    if (event.shiftKey) {
      const state = fine.current ?? { last: event.clientX, value };
      const next = clamp(
        state.value + ((event.clientX - state.last) / rect.width) * 0.2,
        0,
        1
      );
      fine.current = { last: event.clientX, value: next };
      onChange(next);
      return;
    }
    fine.current = null;
    onChange(clamp((event.clientX - rect.left) / rect.width, 0, 1));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      onChange(clamp(value + step, 0, 1));
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      onChange(clamp(value - step, 0, 1));
    } else if (event.key === "Home") {
      onChange(0);
    } else if (event.key === "End") {
      onChange(1);
    }
  };

  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(value * 100)}
      className={cn(
        "group relative h-6 cursor-ew-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/30",
        learn.armable && "ring-1 ring-sky-400/70",
        learn.armed && "animate-pulse ring-2 ring-sky-400",
        className
      )}
      onDoubleClick={() => onChange(defaultValue)}
      onKeyDown={onKeyDown}
      onLostPointerCapture={() => {
        fine.current = null;
        setDragging(false);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        if (learn.armable) {
          learn.arm();
          return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        fromPointer(event);
      }}
      onPointerMove={(event) => {
        if (dragging) {
          fromPointer(event);
        }
      }}
      ref={track}
      role="slider"
      tabIndex={0}
    >
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className="h-full rounded-full transition-[opacity] duration-200"
          style={{
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            opacity: muted ? 0.25 : 1,
            width: `${value * 100}%`,
          }}
        />
      </div>
      {effective !== undefined && effective > 0 ? (
        <div
          className="pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-white/60 transition-[left] duration-150"
          style={{ left: `calc(${effective * 100}% - 1px)` }}
        />
      ) : null}
      <div
        className={cn(
          "pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-[#111] transition-transform",
          dragging ? "scale-125" : "group-hover:scale-110"
        )}
        style={{
          borderColor: muted ? "rgba(255,255,255,0.3)" : color,
          boxShadow: dragging ? `0 0 14px ${color}` : undefined,
          left: `${value * 100}%`,
        }}
      />
      {learn.mapped ? (
        <span className="absolute -top-2 right-0 rounded-full bg-sky-500 px-1 font-mono text-[8px] text-black leading-3">
          M
        </span>
      ) : null}
    </div>
  );
}
