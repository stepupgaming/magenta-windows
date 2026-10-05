"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useId } from "react";
import { mappingFor, mappingLabel } from "../midi.ts";
import { useLive, useStudio } from "../store.ts";

export function Panel({
  children,
  className,
  label,
  actions,
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  label?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "relative flex min-h-0 flex-col rounded-2xl border border-white/[0.07] bg-white/[0.025] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        className
      )}
    >
      {label || actions ? (
        <header className="flex h-10 shrink-0 items-center justify-between gap-3 px-4">
          {typeof label === "string" ? (
            <SectionLabel>{label}</SectionLabel>
          ) : (
            label
          )}
          {actions ? (
            <div className="flex items-center gap-1.5">{actions}</div>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-medium text-[10.5px] text-white/45 uppercase tracking-[0.18em]">
      {children}
    </h2>
  );
}

export function Hint({
  children,
  label,
  keys,
  side = "top",
}: {
  children: ReactNode;
  keys?: string;
  label: ReactNode;
  side?: "bottom" | "left" | "right" | "top";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        className="max-w-64 border border-white/10 bg-[#1c1a21] text-white/85 text-xs leading-relaxed"
        side={side}
      >
        <span>{label}</span>
        {keys ? (
          <kbd className="ml-2 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/70">
            {keys}
          </kbd>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

export interface SegmentOption<T extends string> {
  hint?: string;
  label: ReactNode;
  value: T;
}

export function Segmented<T extends string>({
  ariaLabel,
  className,
  onChange,
  options,
  size = "md",
  value,
}: {
  ariaLabel: string;
  className?: string;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  size?: "md" | "sm";
  value: T;
}) {
  const group = useId();
  return (
    <fieldset
      aria-label={ariaLabel}
      className={cn(
        "relative inline-flex items-center rounded-full border border-white/[0.08] bg-black/30 p-0.5",
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        const button = (
          <button
            aria-pressed={active}
            className={cn(
              "relative z-10 rounded-full font-medium transition-colors",
              size === "sm" ? "h-6 px-2.5 text-[11px]" : "h-7 px-3 text-xs",
              active ? "text-black" : "text-white/60 hover:text-white"
            )}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {active ? (
              <motion.span
                className="absolute inset-0 -z-10 rounded-full bg-white"
                layoutId={`seg-${group}`}
                transition={{ damping: 34, stiffness: 420, type: "spring" }}
              />
            ) : null}
            {option.label}
          </button>
        );
        return option.hint ? (
          <Hint key={option.value} label={option.hint}>
            {button}
          </Hint>
        ) : (
          button
        );
      })}
    </fieldset>
  );
}

export function Toggle({
  active,
  children,
  className,
  color = "#ffffff",
  hint,
  keys,
  onClick,
  learnId,
}: {
  active: boolean;
  children: ReactNode;
  className?: string;
  color?: string;
  hint?: ReactNode;
  keys?: string;
  learnId?: string;
  onClick: () => void;
}) {
  const learn = useLearn(learnId);
  const button = (
    <button
      aria-pressed={active}
      className={cn(
        "relative inline-flex h-7 items-center gap-1.5 rounded-full border px-3 font-medium text-xs transition-all",
        active
          ? "border-transparent text-black"
          : "border-white/[0.08] bg-white/[0.03] text-white/65 hover:border-white/20 hover:text-white",
        learn.armable && "ring-1 ring-dashed ring-sky-400/60",
        learn.armed && "animate-pulse ring-2 ring-sky-400",
        className
      )}
      onClick={learn.armable ? learn.arm : onClick}
      style={
        active
          ? { backgroundColor: color, boxShadow: `0 0 18px ${color}55` }
          : undefined
      }
      type="button"
    >
      {children}
    </button>
  );
  if (!hint) {
    return button;
  }
  return (
    <Hint keys={keys} label={hint}>
      {button}
    </Hint>
  );
}

export function IconButton({
  children,
  className,
  hint,
  keys,
  label,
  onClick,
  disabled,
  active,
}: {
  active?: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  hint?: ReactNode;
  keys?: string;
  label: string;
  onClick?: () => void;
}) {
  const button = (
    <button
      aria-label={label}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white disabled:pointer-events-none disabled:opacity-35",
        active && "bg-white/[0.09] text-white",
        className
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
  return (
    <Hint keys={keys} label={hint ?? label}>
      {button}
    </Hint>
  );
}

/** MIDI learn state for one param or action id. */
export function useLearn(id: string | undefined) {
  const learning = useLive((state) => state.learn);
  const target = useLive((state) => state.learnTarget);
  const mapped = useStudio((state) =>
    id ? mappingFor(id, state.midiMap) : null
  );
  const armable = Boolean(id) && learning;
  return {
    arm: () => {
      if (id) {
        useLive.setState({ learnTarget: id });
      }
    },
    armable,
    armed: armable && target === id,
    mapped: mapped ? mappingLabel(mapped) : null,
  };
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-white/10 bg-white/[0.06] px-1.5 font-mono text-[10px] text-white/70">
      {children}
    </kbd>
  );
}
