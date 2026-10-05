// One connection to the local CUDA engine for the life of the window.
// The stage reads everything it shows from the live store this writes.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { LiveAudio, type StereoClip } from "./audio.ts";
import {
  CONTINUE_MAX,
  CONTINUE_MIN,
  interleaveTail,
  loadClip,
  toEngineRate,
} from "./clips.ts";
import type { WireSpec } from "./spec.ts";
import { useLive, useStudio } from "./store.ts";
import {
  ENGINE,
  ENGINE_SOCKET,
  type EngineHealth,
  SAMPLE_RATE,
} from "./types.ts";

const HEALTH_EVERY = 2000;
const CONTINUE_TIMEOUT = 30_000;

interface StreamMessage {
  clip?: string;
  lead?: number;
  message?: string;
  msPerFrame?: number;
  pickup?: number;
  slot?: string;
  type?: string;
}

/** Where a continuation joins its clip, in seconds before the clip's end. */
export interface ContinueResult {
  /** The clip's own sound played ahead of the new music. */
  lead: number;
  /** Where the new music starts. */
  pickup: number;
}

interface PendingContinue {
  clip: string;
  reject: (error: Error) => void;
  resolve: (result: ContinueResult) => void;
  timer: number;
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
  try {
    const response = await fetch(`${ENGINE}/health`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as EngineHealth;
  } catch {
    return null;
  }
}

function set(values: Partial<ReturnType<typeof useLive.getState>>): void {
  useLive.setState(values);
}

class EngineClient {
  audio: LiveAudio | null = null;
  private socket: WebSocket | null = null;
  private readonly uploaded = new Map<string, string>();
  private readonly uploading = new Map<string, Promise<string | null>>();
  private lastSent = "";
  private continuing: PendingContinue | null = null;
  private timer: number | null = null;
  private watchers = 0;
  private wasUp = false;

  get uploads(): ReadonlyMap<string, string> {
    return this.uploaded;
  }

  watch(): () => void {
    this.watchers += 1;
    if (this.timer === null) {
      this.poll().catch(() => undefined);
      this.timer = window.setInterval(() => {
        this.poll().catch(() => undefined);
      }, HEALTH_EVERY);
    }
    return () => {
      this.watchers -= 1;
      if (this.watchers <= 0 && this.timer !== null) {
        window.clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  async ensureAudio(): Promise<LiveAudio> {
    if (this.audio) {
      await this.audio.resume();
      return this.audio;
    }
    const audio = await LiveAudio.create(useStudio.getState().bufferSeconds);
    audio.onStats = (stats) => {
      const current = useLive.getState().stats;
      set({
        stats: {
          ...current,
          queued: stats.queued,
          ratio: stats.ratio,
          underruns: stats.underruns,
        },
      });
    };
    this.audio = audio;
    return audio;
  }

  /** Load the checkpoint if needed and start streaming. */
  async play(spec: () => WireSpec): Promise<void> {
    const phase = useLive.getState().phase;
    if (phase === "live" || phase === "loading" || phase === "starting") {
      return;
    }
    let audio: LiveAudio;
    try {
      audio = await this.ensureAudio();
    } catch (error) {
      this.fail(
        error instanceof Error ? error.message : "Audio failed to start"
      );
      return;
    }
    audio.reset();
    const health = useLive.getState().health;
    if (!health?.model_loaded) {
      set({ phase: "loading", status: "Loading the model onto the GPU" });
      try {
        const response = await fetch(`${ENGINE}/load`, { method: "POST" });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(detail || `Load failed (${response.status})`);
        }
        set({ health: (await response.json()) as EngineHealth });
      } catch (error) {
        this.fail(error instanceof Error ? error.message : "Load failed");
        return;
      }
    }
    set({ phase: "starting", status: "Opening the stream" });
    await this.uploadAll();
    this.open(spec());
  }

  stop(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ op: "stop" }));
      socket.close();
    } else {
      socket?.close();
    }
    this.audio?.reset();
    this.lastSent = "";
    this.dropContinue(new Error("The stream stopped."));
    const health = useLive.getState().health;
    set({
      grooves: [],
      phase: health ? "ready" : "offline",
      status: health?.gpu ?? "Stopped",
    });
  }

  /**
   * Send the spec when it differs from the last one sent. A groove jumps the
   * model back to a moment it remembered for that slot.
   */
  steer(spec: WireSpec, cut = false, groove: string | null = null): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const body = JSON.stringify(spec);
    if (body === this.lastSent && !cut && !groove) {
      return;
    }
    this.lastSent = body;
    socket.send(
      JSON.stringify({
        ...spec,
        cut,
        op: "steer",
        ...(groove ? { groove } : {}),
      })
    );
  }

  /** Ask the engine to remember the music right now under this slot. */
  remember(slot: string): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify({ op: "remember", slot }));
  }

  forget(slot: string): void {
    this.dropGroove(slot);
    const socket = this.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ op: "forget", slot }));
    }
  }

  /** Store a clip on the engine to continue from. Returns its id. */
  async uploadContinueClip(clip: StereoClip): Promise<string> {
    const at48 = await toEngineRate(clip);
    const seconds = Math.min(at48.left.length / SAMPLE_RATE, CONTINUE_MAX);
    if (seconds < CONTINUE_MIN) {
      throw new Error(
        `Pick at least ${CONTINUE_MIN} seconds for the model to continue from.`
      );
    }
    const samples = interleaveTail(at48, CONTINUE_MAX);
    const response = await fetch(`${ENGINE}/clip`, {
      body: samples,
      headers: { "Content-Type": "application/octet-stream" },
      method: "POST",
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        detail || `The engine refused the clip (${response.status})`
      );
    }
    return ((await response.json()) as { id: string }).id;
  }

  /**
   * Have the model continue a stored clip, steered by `spec`. Resolves when
   * the engine switches over: from then on the stream is the clip's last
   * `lead` seconds, then the new music.
   */
  continueWith(
    spec: WireSpec,
    clip: string,
    lead: number
  ): Promise<ContinueResult> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("The stream is not playing."));
    }
    this.dropContinue(new Error("A newer continue replaced this one."));
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.dropContinue(new Error("The engine did not answer in time."));
      }, CONTINUE_TIMEOUT);
      this.continuing = { clip, reject, resolve, timer };
      this.lastSent = JSON.stringify(spec);
      socket.send(
        JSON.stringify({ ...spec, continue: clip, lead, op: "steer" })
      );
    });
  }

  /** Fresh model memory. Brief gap while the engine primes it again. */
  restart(spec: WireSpec): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.lastSent = JSON.stringify(spec);
    set({ phase: "restarting", status: "Restarting the model" });
    socket.send(JSON.stringify({ ...spec, op: "restart" }));
  }

  /** Upload one audio prompt. Same bytes give the same id, so repeats are free. */
  uploadClip(key: string): Promise<string | null> {
    const known = this.uploaded.get(key);
    if (known) {
      return Promise.resolve(known);
    }
    const pending = this.uploading.get(key);
    if (pending) {
      return pending;
    }
    const job = (async () => {
      const samples = await loadClip(key);
      if (!samples) {
        return null;
      }
      const body = new Uint8Array(
        samples.buffer,
        samples.byteOffset,
        samples.byteLength
      );
      const response = await fetch(`${ENGINE}/audio-prompt`, {
        body: body.slice(),
        headers: { "Content-Type": "application/octet-stream" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = (await response.json()) as { id: string };
      this.uploaded.set(key, payload.id);
      return payload.id;
    })().finally(() => {
      this.uploading.delete(key);
    });
    this.uploading.set(key, job);
    return job;
  }

  async uploadAll(): Promise<void> {
    const prompts = useStudio.getState().prompts;
    await Promise.all(
      prompts
        .filter((prompt) => prompt.kind === "audio" && prompt.clipKey)
        .map((prompt) =>
          this.uploadClip(prompt.clipKey ?? "").catch(() => null)
        )
    );
  }

  private open(first: WireSpec): void {
    const socket = new WebSocket(ENGINE_SOCKET);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    // Grooves live in one stream on the engine.
    set({ grooves: [] });
    socket.onopen = () => {
      this.lastSent = JSON.stringify(first);
      socket.send(JSON.stringify({ ...first, op: "start" }));
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) {
        return;
      }
      if (typeof event.data === "string") {
        this.onText(event.data);
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        this.audio?.pushPcm16(event.data);
      }
    };
    socket.onerror = () => {
      if (this.socket === socket) {
        this.fail("The stream connection failed");
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.dropContinue(new Error("The stream closed."));
      const phase = useLive.getState().phase;
      if (phase !== "error") {
        set({ grooves: [], phase: "ready", status: "The stream closed" });
      }
    };
  }

  private onText(raw: string): void {
    let message: StreamMessage;
    try {
      message = JSON.parse(raw) as StreamMessage;
    } catch {
      return;
    }
    switch (message.type) {
      case "status":
        if (message.message) {
          set({ status: message.message });
        }
        return;
      case "started":
        set({ phase: "live", status: "Live" });
        return;
      case "stats":
        this.onStats(message);
        return;
      case "remembered":
        this.addGroove(message.slot);
        return;
      case "forgotten":
        this.dropGroove(message.slot);
        return;
      case "continued":
        this.onContinued(message);
        return;
      case "continue-failed":
        this.onContinueFailed(message);
        return;
      case "revived":
        toast("The model went quiet, so the engine woke it up", {
          description:
            "Held on one style for a long time, the model can fall silent. Changing the style also helps.",
        });
        return;
      case "error":
        this.fail(message.message ?? "The stream failed");
        return;
      default:
        return;
    }
  }

  private onStats(message: StreamMessage): void {
    if (typeof message.msPerFrame !== "number") {
      return;
    }
    const current = useLive.getState().stats;
    set({ stats: { ...current, msPerFrame: message.msPerFrame } });
  }

  private onContinued(message: StreamMessage): void {
    // Everything after this message is the clip's lead-in, then the new
    // music, so drop what is queued from before.
    this.audio?.reset();
    const pending = this.continuing;
    if (!pending || pending.clip !== message.clip) {
      return;
    }
    this.continuing = null;
    window.clearTimeout(pending.timer);
    pending.resolve({ lead: message.lead ?? 0, pickup: message.pickup ?? 0 });
  }

  private onContinueFailed(message: StreamMessage): void {
    if (this.continuing?.clip !== message.clip) {
      return;
    }
    this.dropContinue(
      new Error(message.message ?? "The engine could not continue the clip.")
    );
  }

  private addGroove(slot: string | undefined): void {
    const grooves = useLive.getState().grooves;
    if (slot && !grooves.includes(slot)) {
      set({ grooves: [...grooves, slot] });
    }
  }

  private dropContinue(error: Error): void {
    const pending = this.continuing;
    if (!pending) {
      return;
    }
    this.continuing = null;
    window.clearTimeout(pending.timer);
    pending.reject(error);
  }

  private dropGroove(slot: string | undefined): void {
    const grooves = useLive.getState().grooves;
    if (slot && grooves.includes(slot)) {
      set({ grooves: grooves.filter((item) => item !== slot) });
    }
  }

  private fail(message: string): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.dropContinue(new Error(message));
    set({ grooves: [], phase: "error", status: message });
  }

  private async poll(): Promise<void> {
    const body = await fetchHealth();
    const live = useLive.getState();
    if (!body) {
      if (this.wasUp) {
        // A new engine process has none of our audio clips.
        this.uploaded.clear();
      }
      this.wasUp = false;
      const text = await bootstrapText();
      if (live.phase === "live" || live.phase === "loading") {
        set({ bootstrap: text, health: null });
        return;
      }
      set({
        bootstrap: text,
        health: null,
        phase: "offline",
        status: text || "Engine offline",
      });
      return;
    }
    this.wasUp = true;
    const ready = live.phase === "offline" || live.phase === "ready";
    set({
      bootstrap: "",
      health: body,
      ...(ready
        ? { phase: "ready" as const, status: body.gpu ?? "Engine ready" }
        : {}),
    });
  }
}

export const engine = new EngineClient();
