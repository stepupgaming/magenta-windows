"use client";

import { useEffect, useRef } from "react";

const LINES = 72;
const POINTS = 96;

interface WaveformProps {
  analyser: AnalyserNode | null;
  live: boolean;
}

function idleSample(point: number, age: number, time: number): number {
  const across = point / (POINTS - 1);
  return (
    Math.sin(across * 17 + age * 0.55 + time * 0.002) * 0.42 +
    Math.sin(across * 46 - time * 0.0031 + age * 0.22) * 0.38 +
    Math.sin(across * 6.5 + time * 0.0011) * 0.2
  );
}

function seedHistory(time: number): Float32Array[] {
  const history: Float32Array[] = [];
  for (let age = 0; age < LINES; age += 1) {
    const line = new Float32Array(POINTS);
    for (let point = 0; point < POINTS; point += 1) {
      line[point] = idleSample(point, age, time);
    }
    history.push(line);
  }
  return history;
}

function fitCanvas(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const pixelRatio = window.devicePixelRatio || 1;
  const nextWidth = Math.floor(width * pixelRatio);
  const nextHeight = Math.floor(height * pixelRatio);
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function sampleAt(
  point: number,
  bins: Uint8Array,
  live: boolean,
  frame: number,
  time: number
): number {
  if (!live) {
    return idleSample(point, frame, time);
  }
  const source = Math.floor((point / POINTS) * bins.length);
  return ((bins[source] ?? 128) - 128) / 96;
}

function pushLine(
  history: Float32Array[],
  bins: Uint8Array,
  live: boolean,
  frame: number
): void {
  if (frame % 2 !== 0) {
    return;
  }
  const line = new Float32Array(POINTS);
  const time = performance.now();
  for (let point = 0; point < POINTS; point += 1) {
    line[point] = sampleAt(point, bins, live, frame, time);
  }
  history.push(line);
  if (history.length > LINES) {
    history.shift();
  }
}

function paintSheet(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  history: Float32Array[]
): void {
  const count = history.length;
  for (let index = 0; index < count; index += 1) {
    const line = history[index];
    if (!line) {
      continue;
    }
    const near = count <= 1 ? 1 : index / (count - 1);
    const spread = near ** 1.45;
    const y = height * (0.5 + spread * 0.46);
    const left = width * (0.5 - spread * 0.62);
    const right = width * (0.5 + spread * 0.62);
    const amplitude = 2 + spread * spread * 34;
    context.beginPath();
    context.strokeStyle = `rgba(255,255,255,${0.06 + near * 0.9})`;
    context.lineWidth = near > 0.86 ? 1.35 : 1;
    for (let point = 0; point < POINTS; point += 1) {
      const across = point / (POINTS - 1);
      const x = left + (right - left) * across;
      const bow = Math.sin(across * Math.PI) * near * 12;
      const sample = line[point] ?? 0;
      const edge = 0.12 + across * across * 1.7;
      const py = y + bow * 0.35 + sample * amplitude * edge;
      if (point === 0) {
        context.moveTo(x, py);
      } else {
        context.lineTo(x, py);
      }
    }
    context.stroke();
  }
}

export function Waveform({ analyser, live }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<Float32Array[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const bins = new Uint8Array(analyser ? analyser.fftSize : 1024);
    let frame = 0;
    let raf = 0;
    if (historyRef.current.length === 0) {
      historyRef.current = seedHistory(0);
    }

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      fitCanvas(canvas, context, width, height);
      context.clearRect(0, 0, width, height);
      if (analyser && live) {
        analyser.getByteTimeDomainData(bins);
      }
      pushLine(historyRef.current, bins, Boolean(analyser) && live, frame);
      frame += 1;
      paintSheet(context, width, height, historyRef.current);
      raf = window.requestAnimationFrame(draw);
    };

    raf = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(raf);
  }, [analyser, live]);

  return (
    <canvas
      className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
      ref={canvasRef}
    />
  );
}
