"use client";

import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { LiveAudio } from "./audio.ts";
import { noteFromKey, Piano } from "./piano.tsx";
import { PromptStack, Slider } from "./prompts.tsx";
import {
  CHIP_COLORS,
  ENGINE,
  type EngineHealth,
  type PromptLine,
} from "./types.ts";

const START_PROMPTS: PromptLine[] = [
  { color: "#f5c542", id: "chords", text: "soothing chords", weight: 70 },
];

type Phase = "error" | "live" | "loading" | "offline" | "ready";

function notesPayload(held: number[], gate: boolean): number[] | null {
  if (held.length === 0) {
    return gate ? Array.from({ length: 128 }, () => 0) : null;
  }
  const notes = Array.from({ length: 128 }, () => -1);
  for (const note of held) {
    if (note >= 0 && note < 128) {
      notes[note] = 1;
    }
  }
  return notes;
}

async function bootstrapText(): Promise<string> {
  if (!isTauri()) {
    return "";
  }
  try {
    return await invoke<string>("bootstrap_status");
  } catch {
    return "";
  }
}

async function fetchHealth(): Promise<EngineHealth | null> {
  const response = await fetch(`${ENGINE}/health`);
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as EngineHealth;
}

function applyHealth(
  body: EngineHealth | null,
  phase: Phase,
  setHealth: (value: EngineHealth | null) => void,
  setPhase: (value: Phase) => void,
  setStatus: (value: string) => void
): void {
  if (!body) {
    setHealth(null);
    if (phase !== "live" && phase !== "loading") {
      setPhase("offline");
      setStatus("Engine offline");
    }
    return;
  }
  setHealth(body);
  if (phase === "offline" || phase === "ready") {
    setPhase("ready");
    setStatus(body.gpu ?? "Engine ready");
  }
}

interface StreamMessage {
  message?: string;
  msPerFrame?: number;
  type?: string;
}

function handleStreamText(
  raw: string,
  setLatency: (value: number | null) => void,
  setPhase: (value: Phase) => void,
  setStatus: (value: string) => void
): void {
  const message = JSON.parse(raw) as StreamMessage;
  if (message.type === "status" && message.message) {
    setStatus(message.message);
  }
  if (message.type === "started") {
    setPhase("live");
    setStatus("Live. Sound in about a second.");
  }
  if (message.type === "stats" && typeof message.msPerFrame === "number") {
    setLatency(message.msPerFrame);
  }
  if (message.type === "error") {
    setPhase("error");
    setStatus(message.message ?? "Stream failed");
  }
}

interface PlayColumnProps {
  drumGuide: number;
  drums: boolean;
  gate: boolean;
  held: number[];
  instGuide: number;
  onDown: (note: number) => void;
  onDrumGuide: (value: number) => void;
  onDrums: (value: boolean) => void;
  onGate: (value: boolean) => void;
  onInstGuide: (value: number) => void;
  onTemperature: (value: number) => void;
  onTextGuide: (value: number) => void;
  onTopK: (value: number) => void;
  onUp: (note: number) => void;
  onVolume: (value: number) => void;
  temperature: number;
  textGuide: number;
  topK: number;
  volume: number;
}

function PlayColumn({
  drumGuide,
  drums,
  gate,
  held,
  instGuide,
  onDown,
  onDrumGuide,
  onDrums,
  onGate,
  onInstGuide,
  onTemperature,
  onTextGuide,
  onTopK,
  onUp,
  onVolume,
  temperature,
  textGuide,
  topK,
  volume,
}: PlayColumnProps) {
  return (
    <section className="flex flex-col gap-4 overflow-auto">
      <div>
        <h2 className="font-medium text-lg">Notes</h2>
        <div className="mt-3">
          <Piano held={held} onDown={onDown} onUp={onUp} />
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            checked={gate}
            className="accent-orange-500"
            onChange={(event) => onGate(event.target.checked)}
            type="checkbox"
          />
          Wait for a key before playing notes
        </label>
      </div>
      <Slider
        label="Style strength"
        max={6}
        min={0}
        onChange={onTextGuide}
        step={0.1}
        value={textGuide}
      />
      <Slider
        label="Note strength"
        max={6}
        min={0}
        onChange={onInstGuide}
        step={0.1}
        value={instGuide}
      />
      <Slider
        label="Temperature"
        max={2}
        min={0.2}
        onChange={onTemperature}
        step={0.05}
        value={temperature}
      />
      <Slider
        label="Choices"
        max={160}
        min={8}
        note="Applies the next time you load. A live change waits for that."
        onChange={onTopK}
        step={1}
        value={topK}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          checked={drums}
          className="accent-orange-500"
          onChange={(event) => onDrums(event.target.checked)}
          type="checkbox"
        />
        Drums
      </label>
      <Slider
        label="Drum strength"
        max={4}
        min={0}
        onChange={onDrumGuide}
        step={0.1}
        value={drumGuide}
      />
      <Slider
        label="Volume"
        max={1.4}
        min={0}
        onChange={onVolume}
        step={0.05}
        value={volume}
      />
    </section>
  );
}

export function Stage() {
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const [phase, setPhase] = useState<Phase>("offline");
  const [status, setStatus] = useState("Engine offline");
  const [prompts, setPrompts] = useState<PromptLine[]>(START_PROMPTS);
  const [draft, setDraft] = useState("");
  const [temperature, setTemperature] = useState(1.05);
  const [topK, setTopK] = useState(48);
  const [textGuide, setTextGuide] = useState(2.4);
  const [instGuide, setInstGuide] = useState(0.8);
  const [drumGuide, setDrumGuide] = useState(1);
  const [drums, setDrums] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [gate, setGate] = useState(false);
  const [held, setHeld] = useState<number[]>([]);
  const [latency, setLatency] = useState<number | null>(null);
  const audioRef = useRef<LiveAudio | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const heldRef = useRef<number[]>([]);
  const phaseRef = useRef<Phase>("offline");
  phaseRef.current = phase;

  useEffect(() => {
    heldRef.current = held;
  }, [held]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      let body: EngineHealth | null = null;
      try {
        body = await fetchHealth();
      } catch {
        body = null;
      }
      if (!stop && !body) {
        const text = await bootstrapText();
        if (!stop && text) {
          setHealth(null);
          if (phaseRef.current !== "live" && phaseRef.current !== "loading") {
            setPhase("offline");
            setStatus(text);
          }
          return;
        }
      }
      if (!stop) {
        applyHealth(body, phaseRef.current, setHealth, setPhase, setStatus);
      }
    };
    const timer = window.setInterval(() => {
      tick().catch(() => undefined);
    }, 2000);
    tick().catch(() => undefined);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  const spec = useCallback(
    () => ({
      cfg_drums: drums ? drumGuide : 0,
      cfg_musiccoca: textGuide,
      cfg_notes: instGuide,
      drums,
      notes: notesPayload(heldRef.current, gate),
      op: "steer",
      prompts: prompts
        .filter((prompt) => prompt.text.trim().length > 0)
        .map((prompt) => ({
          text: prompt.text.trim(),
          weight: prompt.weight,
        })),
      seed: 7,
      temperature,
      top_k: Math.round(topK),
    }),
    [prompts, temperature, topK, textGuide, instGuide, drumGuide, drums, gate]
  );

  useEffect(() => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(spec()));
    }
  }, [spec]);

  useEffect(() => {
    audioRef.current?.setVolume(volume);
  }, [volume]);

  const stopStream = useCallback(() => {
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ op: "stop" }));
      socket.close();
    }
    audioRef.current?.close();
    audioRef.current = null;
    setPhase("ready");
    setStatus(health?.gpu ?? "Stopped");
  }, [health]);

  const startStream = useCallback(async () => {
    const audio = new LiveAudio();
    audioRef.current = audio;
    await audio.resume();
    audio.setVolume(volume);
    const socket = new WebSocket("ws://127.0.0.1:8765/ws/stream");
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        handleStreamText(event.data, setLatency, setPhase, setStatus);
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        audio.pushPcm16(event.data);
      }
    };
    socket.onopen = () => {
      socket.send(JSON.stringify({ ...spec(), op: "start" }));
    };
    socket.onerror = () => {
      setPhase("error");
      setStatus("Socket failed");
    };
    socket.onclose = () => {
      if (socketRef.current === socket) {
        setPhase("ready");
      }
    };
  }, [spec, volume]);

  const loadAndPlay = useCallback(async () => {
    setPhase("loading");
    setStatus("Loading the model onto the GPU");
    try {
      const response = await fetch(`${ENGINE}/load`, { method: "POST" });
      if (!response.ok) {
        throw new Error(`load failed (${response.status})`);
      }
      const body = (await response.json()) as EngineHealth;
      setHealth(body);
      await startStream();
    } catch (error) {
      setPhase("error");
      setStatus(error instanceof Error ? error.message : "Load failed");
    }
  }, [startStream]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const note = noteFromKey(event.key);
      if (note === null || heldRef.current.includes(note)) {
        return;
      }
      setHeld([...heldRef.current, note]);
    };
    const up = (event: KeyboardEvent) => {
      const note = noteFromKey(event.key);
      if (note === null) {
        return;
      }
      setHeld(heldRef.current.filter((item) => item !== note));
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(
    () => () => {
      socketRef.current?.close();
      audioRef.current?.close();
    },
    []
  );

  const addPrompt = () => {
    const text = draft.trim();
    if (!text || prompts.length >= 8) {
      return;
    }
    const color = CHIP_COLORS[prompts.length % CHIP_COLORS.length] ?? "#ffffff";
    setPrompts((current) => [
      ...current,
      { color, id: `${Date.now()}`, text, weight: 50 },
    ]);
    setDraft("");
  };

  const holdNote = (note: number) => {
    setHeld((current) =>
      current.includes(note) ? current : [...current, note]
    );
  };
  const releaseNote = (note: number) => {
    setHeld((current) => current.filter((item) => item !== note));
  };

  const loadDisabled = phase === "loading" || phase === "offline";

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-neutral-950 text-white">
      <header className="flex items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-3">
          {phase === "live" ? (
            <button
              className="rounded-full bg-white px-4 py-1.5 font-medium text-black text-sm"
              onClick={stopStream}
              type="button"
            >
              Stop
            </button>
          ) : (
            <button
              className="rounded-full bg-orange-500 px-4 py-1.5 font-medium text-black text-sm disabled:opacity-40"
              disabled={loadDisabled}
              onClick={() => {
                loadAndPlay().catch(() => undefined);
              }}
              type="button"
            >
              {phase === "loading" ? "Loading" : "Load model"}
            </button>
          )}
          <span className="max-w-80 truncate text-sm text-white/60">
            {status}
          </span>
        </div>
        <div className="text-sm text-white/70 tabular-nums">
          {latency === null ? "" : `${latency.toFixed(1)} ms`}
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-8 px-6 pb-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        <PromptStack
          draft={draft}
          onAdd={addPrompt}
          onDraft={setDraft}
          onRemove={(id) =>
            setPrompts((current) =>
              current.filter((prompt) => prompt.id !== id)
            )
          }
          onText={(id, text) =>
            setPrompts((current) =>
              current.map((prompt) =>
                prompt.id === id ? { ...prompt, text } : prompt
              )
            )
          }
          onWeight={(id, weight) =>
            setPrompts((current) =>
              current.map((prompt) =>
                prompt.id === id ? { ...prompt, weight } : prompt
              )
            )
          }
          prompts={prompts}
        />
        <PlayColumn
          drumGuide={drumGuide}
          drums={drums}
          gate={gate}
          held={held}
          instGuide={instGuide}
          onDown={holdNote}
          onDrumGuide={setDrumGuide}
          onDrums={setDrums}
          onGate={setGate}
          onInstGuide={setInstGuide}
          onTemperature={setTemperature}
          onTextGuide={setTextGuide}
          onTopK={setTopK}
          onUp={releaseNote}
          onVolume={setVolume}
          temperature={temperature}
          textGuide={textGuide}
          topK={topK}
          volume={volume}
        />
      </div>
    </div>
  );
}
