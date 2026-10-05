"use client";

import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useRef } from "react";
import { type MonitorFrame, onFrame } from "../monitor.ts";
import { PITCH_NAMES } from "../music.ts";
import { heldNotes, useLive, useStudio } from "../store.ts";
import { Segmented } from "./kit.tsx";

const LOW_HZ = 30;
const HIGH_HZ = 16_000;
const FLOOR_DB = -105;
const CEIL_DB = -25;
const RIDGES = 44;
const RIDGE_POINTS = 120;

const STOPS: [number, [number, number, number]][] = [
  [0, [8, 8, 11]],
  [0.22, [38, 10, 58]],
  [0.48, [176, 23, 122]],
  [0.74, [255, 122, 26]],
  [1, [255, 241, 184]],
];

function buildPalette(): Uint8ClampedArray {
  const table = new Uint8ClampedArray(256 * 3);
  for (let index = 0; index < 256; index += 1) {
    const t = index / 255;
    let low = STOPS[0];
    let high = STOPS.at(-1);
    for (let stop = 0; stop < STOPS.length - 1; stop += 1) {
      const a = STOPS[stop];
      const b = STOPS[stop + 1];
      if (a && b && t >= a[0] && t <= b[0]) {
        low = a;
        high = b;
        break;
      }
    }
    if (!(low && high)) {
      continue;
    }
    const span = high[0] - low[0] || 1;
    const mix = (t - low[0]) / span;
    for (let channel = 0; channel < 3; channel += 1) {
      const from = low[1][channel] ?? 0;
      const to = high[1][channel] ?? 0;
      table[index * 3 + channel] = from + (to - from) * mix;
    }
  }
  return table;
}

const PALETTE = buildPalette();

function level(db: number): number {
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB)));
}

/** Decibels at a log-spaced position 0 (low) .. 1 (high). */
function sample(frame: MonitorFrame, position: number): number {
  const spectrum = frame.spectrum;
  if (!spectrum) {
    return FLOOR_DB;
  }
  const hz = LOW_HZ * (HIGH_HZ / LOW_HZ) ** position;
  const bin = (hz / (frame.spectrumRate / 2)) * spectrum.length;
  const index = Math.floor(bin);
  const mix = bin - index;
  const a = spectrum[index] ?? FLOOR_DB;
  const b = spectrum[index + 1] ?? a;
  return a + (b - a) * mix;
}

function fitCanvas(canvas: HTMLCanvasElement): {
  height: number;
  width: number;
} {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { height, width };
}

function paintSpectrum(canvas: HTMLCanvasElement, frame: MonitorFrame): void {
  const context = canvas.getContext("2d", { willReadFrequently: false });
  if (!context) {
    return;
  }
  const { height, width } = fitCanvas(canvas);
  const speed = Math.max(1, Math.round((window.devicePixelRatio || 1) * 1.5));
  context.drawImage(canvas, -speed, 0);
  const column = context.createImageData(speed, height);
  for (let y = 0; y < height; y += 1) {
    const position = 1 - y / (height - 1);
    const value = frame.spectrum ? level(sample(frame, position)) : 0;
    const shade = Math.round(value * 255) * 3;
    for (let x = 0; x < speed; x += 1) {
      const at = (y * speed + x) * 4;
      column.data[at] = PALETTE[shade] ?? 0;
      column.data[at + 1] = PALETTE[shade + 1] ?? 0;
      column.data[at + 2] = PALETTE[shade + 2] ?? 0;
      column.data[at + 3] = 255;
    }
  }
  context.putImageData(column, width - speed, 0);
}

function paintRidges(
  canvas: HTMLCanvasElement,
  frame: MonitorFrame,
  history: Float32Array[],
  tick: number
): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const { height, width } = fitCanvas(canvas);
  if (tick % 3 === 0) {
    const line = new Float32Array(RIDGE_POINTS);
    for (let point = 0; point < RIDGE_POINTS; point += 1) {
      line[point] = frame.spectrum
        ? level(sample(frame, 0.05 + (point / RIDGE_POINTS) * 0.85))
        : 0;
    }
    history.push(line);
    if (history.length > RIDGES) {
      history.shift();
    }
  }
  context.fillStyle = "#08080b";
  context.fillRect(0, 0, width, height);
  const count = history.length;
  for (let row = 0; row < count; row += 1) {
    const line = history[row];
    if (!line) {
      continue;
    }
    const depth = row / Math.max(1, RIDGES - 1);
    const base = height * (0.12 + depth * 0.84);
    const amplitude = height * (0.1 + depth * 0.32);
    const inset = width * (0.16 - depth * 0.12);
    context.beginPath();
    context.moveTo(inset, base);
    for (let point = 0; point < RIDGE_POINTS; point += 1) {
      const x = inset + ((width - inset * 2) * point) / (RIDGE_POINTS - 1);
      const lift = (line[point] ?? 0) ** 1.6 * amplitude;
      context.lineTo(x, base - lift);
    }
    context.lineTo(width - inset, base);
    context.closePath();
    context.fillStyle = "#08080b";
    context.fill();
    context.strokeStyle = `rgba(255, ${Math.round(120 + depth * 100)}, ${Math.round(180 - depth * 120)}, ${0.15 + depth * 0.8})`;
    context.lineWidth = (window.devicePixelRatio || 1) * (0.6 + depth * 0.8);
    context.stroke();
  }
}

function paintMeter(canvas: HTMLCanvasElement, frame: MonitorFrame): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const { height, width } = fitCanvas(canvas);
  context.clearRect(0, 0, width, height);
  const meter = frame.meter;
  const toY = (amplitude: number) => {
    const db = 20 * Math.log10(Math.max(1e-5, amplitude));
    return height * (1 - Math.min(1, Math.max(0, (db + 60) / 60)));
  };
  const bar = Math.floor((width - 2) / 2);
  const channels: [number, number, number][] = [
    [0, meter.rmsL, meter.holdL],
    [bar + 2, meter.rmsR, meter.holdR],
  ];
  for (const [x, rms, hold] of channels) {
    context.fillStyle = "rgba(255,255,255,0.06)";
    context.fillRect(x, 0, bar, height);
    const top = toY(rms * 1.4);
    const gradient = context.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, "#3dd6a8");
    gradient.addColorStop(0.7, "#ffc23c");
    gradient.addColorStop(1, "#ff4c5c");
    context.fillStyle = gradient;
    context.fillRect(x, top, bar, height - top);
    context.fillStyle = "rgba(255,255,255,0.85)";
    context.fillRect(x, toY(hold), bar, Math.max(1, height / 80));
  }
  if (performance.now() - meter.clipAt < 1500) {
    context.fillStyle = "#ff4c5c";
    context.fillRect(0, 0, width, Math.max(2, height / 30));
  }
}

function paintChroma(
  frame: MonitorFrame,
  bars: (HTMLSpanElement | null)[],
  names: (HTMLSpanElement | null)[]
): void {
  const held = new Set(heldNotes(useLive.getState()).map((note) => note % 12));
  for (let pc = 0; pc < 12; pc += 1) {
    const bar = bars[pc];
    const value = frame.chroma[pc] ?? 0;
    if (bar) {
      bar.style.transform = `scaleX(${Math.max(0.02, value)})`;
      bar.style.opacity = `${0.35 + value * 0.65}`;
    }
    const name = names[pc];
    if (name) {
      name.dataset.held = held.has(pc) ? "true" : "false";
    }
  }
}

export function Visualizer({ className }: { className?: string }) {
  const visual = useStudio((state) => state.visual);
  const patch = useStudio((state) => state.patch);
  const phase = useLive((state) => state.phase);
  const canvas = useRef<HTMLCanvasElement>(null);
  const meter = useRef<HTMLCanvasElement>(null);
  const keyLabel = useRef<HTMLSpanElement>(null);
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const names = useRef<(HTMLSpanElement | null)[]>([]);
  const history = useRef<Float32Array[]>([]);
  const ever = useRef(false);
  const hint = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let tick = 0;
    let lastKey = "";
    return onFrame((frame) => {
      tick += 1;
      const target = canvas.current;
      if (target) {
        if (useStudio.getState().visual === "spectrum") {
          paintSpectrum(target, frame);
        } else {
          paintRidges(target, frame, history.current, tick);
        }
      }
      if (meter.current) {
        paintMeter(meter.current, frame);
      }
      if (frame.hearing && !ever.current) {
        ever.current = true;
        hint.current?.classList.add("opacity-0");
      }
      paintChroma(frame, bars.current, names.current);
      const label = frame.key ? `Hearing ${frame.key.label}` : "";
      if (keyLabel.current && label !== lastKey) {
        lastKey = label;
        keyLabel.current.textContent = label;
      }
    });
  }, []);

  return (
    <section
      className={cn(
        "relative flex min-h-0 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#08080b]",
        className
      )}
    >
      <canvas className="h-full min-w-0 flex-1" ref={canvas} />
      <div
        className="pointer-events-none absolute inset-y-0 left-0 flex w-[calc(100%-168px)] items-center justify-center text-sm text-white/35 transition-opacity duration-1000"
        ref={hint}
      >
        {phase === "live"
          ? "Listening for the first sound"
          : "What the model plays scrolls here"}
      </div>
      <div className="pointer-events-none absolute top-2.5 left-3 flex items-center gap-2">
        <span className="font-medium text-[10.5px] text-white/45 uppercase tracking-[0.18em]">
          Monitor
        </span>
        <span
          className="font-medium text-[11px] text-white/80"
          ref={keyLabel}
        />
      </div>
      <div className="absolute bottom-2 left-3">
        <Segmented
          ariaLabel="Visual"
          onChange={(value) => patch({ visual: value })}
          options={[
            { label: "Spectrum", value: "spectrum" },
            { label: "Ridges", value: "lines" },
          ]}
          size="sm"
          value={visual}
        />
      </div>
      <div className="flex w-[150px] shrink-0 flex-col justify-center gap-[3px] border-white/[0.06] border-l bg-black/40 px-3 py-2">
        {PITCH_NAMES.map((name, pc) => (
          <div className="flex h-[9%] min-h-2 items-center gap-2" key={name}>
            <span
              className="w-5 font-mono text-[9.5px] text-white/40 data-[held=true]:font-bold data-[held=true]:text-[#ff8a1f]"
              data-held="false"
              ref={(node) => {
                names.current[pc] = node;
              }}
            >
              {name}
            </span>
            <span className="relative h-full flex-1 overflow-hidden rounded-sm bg-white/[0.04]">
              <span
                className="absolute inset-y-0 left-0 w-full origin-left rounded-sm bg-gradient-to-r from-[#b0177a] to-[#ffc23c]"
                ref={(node) => {
                  bars.current[pc] = node;
                }}
                style={{ transform: "scaleX(0.02)" }}
              />
            </span>
          </div>
        ))}
      </div>
      <div className="flex w-[18px] shrink-0 py-2.5 pr-1.5 pl-1">
        <canvas className="size-full" ref={meter} />
      </div>
    </section>
  );
}
