"use client";

import type { PointerEvent } from "react";

interface KnobProps {
  accent: string;
  display: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}

function Knob({
  accent,
  display,
  label,
  max,
  min,
  onChange,
  value,
}: KnobProps) {
  const amount = max === min ? 0 : (value - min) / (max - min);
  const angle = (-130 + amount * 260) * (Math.PI / 180);
  const dotX = 22 + Math.sin(angle) * 15;
  const dotY = 22 - Math.cos(angle) * 15;

  const drag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.buttons !== 1) {
      return;
    }
    const next = value - event.movementY * ((max - min) / 140);
    onChange(Math.min(max, Math.max(min, next)));
  };

  return (
    <button
      className="flex w-[4.5rem] flex-col items-center gap-1 text-white"
      onPointerDown={(event) =>
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      onPointerMove={drag}
      type="button"
    >
      <span className="text-[9px] text-white/45 uppercase tracking-[0.14em]">
        {label}
      </span>
      <span className="relative h-11 w-11 rounded-full border border-white/10 bg-black">
        <span
          className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: accent, left: dotX, top: dotY }}
        />
      </span>
      <span className="text-[10px] text-white/80 tabular-nums">{display}</span>
    </button>
  );
}

interface DeckProps {
  comb: boolean;
  highPass: number;
  instGuide: number;
  lowPass: number;
  onComb: (value: boolean) => void;
  onHighPass: (value: number) => void;
  onInstGuide: (value: number) => void;
  onLowPass: (value: number) => void;
  onReverb: (value: boolean) => void;
  onTemperature: (value: number) => void;
  onTextGuide: (value: number) => void;
  onTopK: (value: number) => void;
  onVolume: (value: number) => void;
  reverb: boolean;
  temperature: number;
  textGuide: number;
  topK: number;
  volume: number;
}

export function Deck(props: DeckProps) {
  const padX = (props.temperature - 0.6) / 1;
  const padY = 1 - (props.topK - 8) / 152;

  const movePad = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.buttons !== 1) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width)
    );
    const y = Math.min(
      1,
      Math.max(0, (event.clientY - rect.top) / rect.height)
    );
    props.onTemperature(0.6 + x);
    props.onTopK(8 + (1 - y) * 152);
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <label className="flex flex-col items-center gap-2 text-[10px] text-white/50 uppercase tracking-[0.14em]">
        <input
          className="accent-rose-500"
          max={1.4}
          min={0}
          onChange={(event) => props.onVolume(Number(event.target.value))}
          step={0.01}
          style={{ direction: "rtl", height: 112, writingMode: "vertical-lr" }}
          type="range"
          value={props.volume}
        />
        Vol {props.volume.toFixed(1)}
      </label>
      <button
        className="relative h-36 w-44 rounded-xl border border-white/10 bg-black/50"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          movePad(event);
        }}
        onPointerMove={movePad}
        type="button"
      >
        <span className="pointer-events-none absolute inset-x-0 top-2 text-center text-[9px] text-white/40 uppercase tracking-[0.16em]">
          Probability space
        </span>
        <span className="pointer-events-none absolute top-8 right-3 left-3 h-px bg-white/20" />
        <span className="pointer-events-none absolute top-8 bottom-7 left-1/2 w-px bg-white/20" />
        <span
          className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-500"
          style={{ left: `${8 + padX * 84}%`, top: `${22 + padY * 58}%` }}
        />
        <span className="pointer-events-none absolute bottom-1.5 left-2 text-[10px] text-white/70 tabular-nums">
          T {props.temperature.toFixed(2)} | K {Math.round(props.topK)}
        </span>
      </button>
      <div className="grid flex-1 grid-cols-3 justify-items-center gap-y-2">
        <Knob
          accent="#f5c542"
          display={props.textGuide.toFixed(1)}
          label="Text-guide"
          max={5}
          min={0}
          onChange={props.onTextGuide}
          value={props.textGuide}
        />
        <Knob
          accent="#c084fc"
          display={props.instGuide.toFixed(1)}
          label="Inst-guide"
          max={5}
          min={0}
          onChange={props.onInstGuide}
          value={props.instGuide}
        />
        <Knob
          accent="#67e8f9"
          display={`${Math.round(props.lowPass)}Hz`}
          label="Low-pass"
          max={20_000}
          min={400}
          onChange={props.onLowPass}
          value={props.lowPass}
        />
        <Knob
          accent="#fb7185"
          display={props.comb ? "on" : "off"}
          label="Comb"
          max={1}
          min={0}
          onChange={(value) => props.onComb(value >= 0.5)}
          value={props.comb ? 1 : 0}
        />
        <Knob
          accent="#3dff8a"
          display={props.reverb ? "on" : "off"}
          label="Reverb"
          max={1}
          min={0}
          onChange={(value) => props.onReverb(value >= 0.5)}
          value={props.reverb ? 1 : 0}
        />
        <Knob
          accent="#60a5fa"
          display={`${Math.round(props.highPass)}Hz`}
          label="High-pass"
          max={2000}
          min={20}
          onChange={props.onHighPass}
          value={props.highPass}
        />
      </div>
    </div>
  );
}
