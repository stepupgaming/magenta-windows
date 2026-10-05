// Audio clips: WAV export, waveform peaks, file decoding, the 16 kHz mono
// resample the engine embeds, and IndexedDB storage for audio prompts.

import type { StereoClip } from "./audio.ts";

/** MusicCoCa hears 16 kHz mono in 10 second windows. */
export const PROMPT_RATE = 16_000;
export const PROMPT_WINDOW = 10;
export const PROMPT_MAX = 30;

export function encodeWav(clip: StereoClip): Blob {
  const frames = clip.left.length;
  const bytes = 44 + frames * 4;
  const buffer = new ArrayBuffer(bytes);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  text(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, clip.sampleRate, true);
  view.setUint32(28, clip.sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 4, true);
  let offset = 44;
  for (let index = 0; index < frames; index += 1) {
    const left = Math.max(-1, Math.min(1, clip.left[index] ?? 0));
    const right = Math.max(-1, Math.min(1, clip.right[index] ?? 0));
    view.setInt16(offset, left < 0 ? left * 32_768 : left * 32_767, true);
    view.setInt16(
      offset + 2,
      right < 0 ? right * 32_768 : right * 32_767,
      true
    );
    offset += 4;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Peak envelope in `count` buckets, normalized to the loudest bucket. */
export function peaks(channels: Float32Array[], count: number): number[] {
  const length = channels[0]?.length ?? 0;
  const out = Array.from({ length: count }, () => 0);
  if (length === 0) {
    return out;
  }
  const size = Math.max(1, Math.floor(length / count));
  let loudest = 0;
  for (let bucket = 0; bucket < count; bucket += 1) {
    let peak = 0;
    const start = bucket * size;
    const end = Math.min(length, start + size);
    for (const channel of channels) {
      for (let index = start; index < end; index += 4) {
        const value = Math.abs(channel[index] ?? 0);
        if (value > peak) {
          peak = value;
        }
      }
    }
    out[bucket] = peak;
    loudest = Math.max(loudest, peak);
  }
  return loudest > 0
    ? out.map((value) => Math.round((value / loudest) * 100) / 100)
    : out;
}

export function clipSeconds(clip: StereoClip): number {
  return clip.left.length / clip.sampleRate;
}

export async function decodeFile(file: Blob): Promise<StereoClip> {
  const data = await file.arrayBuffer();
  const context = new OfflineAudioContext(2, 1, 48_000);
  const buffer = await context.decodeAudioData(data);
  const left = buffer.getChannelData(0).slice();
  const right =
    buffer.numberOfChannels > 1
      ? buffer.getChannelData(1).slice()
      : left.slice();
  return { left, right, sampleRate: buffer.sampleRate };
}

/** Mix to mono and resample a slice of a clip to 16 kHz for MusicCoCa. */
export async function toPromptClip(
  clip: StereoClip,
  startSeconds: number,
  endSeconds: number
): Promise<Float32Array> {
  const start = Math.max(0, Math.floor(startSeconds * clip.sampleRate));
  const end = Math.min(
    clip.left.length,
    Math.ceil(endSeconds * clip.sampleRate)
  );
  const frames = Math.max(1, end - start);
  const source = new OfflineAudioContext(2, frames, clip.sampleRate);
  const buffer = source.createBuffer(2, frames, clip.sampleRate);
  buffer.copyToChannel(clip.left.slice(start, end), 0);
  buffer.copyToChannel(clip.right.slice(start, end), 1);
  const outFrames = Math.max(
    1,
    Math.round((frames / clip.sampleRate) * PROMPT_RATE)
  );
  const context = new OfflineAudioContext(1, outFrames, PROMPT_RATE);
  const player = context.createBufferSource();
  player.buffer = buffer;
  player.connect(context.destination);
  player.start();
  const rendered = await context.startRendering();
  return rendered.getChannelData(0).slice();
}

/** The loudest `seconds` window, a good default pick for a style clip. */
export function loudestWindow(clip: StereoClip, seconds: number): number {
  const total = clipSeconds(clip);
  if (total <= seconds) {
    return 0;
  }
  const step = Math.max(1, Math.floor(clip.sampleRate / 4));
  const energy: number[] = [];
  for (let start = 0; start < clip.left.length; start += step) {
    let sum = 0;
    const end = Math.min(clip.left.length, start + step);
    for (let index = start; index < end; index += 8) {
      const value = clip.left[index] ?? 0;
      sum += value * value;
    }
    energy.push(sum);
  }
  const span = Math.max(1, Math.round((seconds * clip.sampleRate) / step));
  let best = 0;
  let bestScore = -1;
  let running = energy.slice(0, span).reduce((sum, value) => sum + value, 0);
  for (let index = 0; index + span <= energy.length; index += 1) {
    if (index > 0) {
      running += (energy[index + span - 1] ?? 0) - (energy[index - 1] ?? 0);
    }
    if (running > bestScore) {
      bestScore = running;
      best = index;
    }
  }
  return Math.min(total - seconds, (best * step) / clip.sampleRate);
}

// ---- IndexedDB clip store ------------------------------------------------

const DB_NAME = "magenta-clips";
const STORE = "clips";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("IndexedDB failed"));
    });
  } finally {
    db.close();
  }
}

const memory = new Map<string, Float32Array>();

export async function saveClip(
  key: string,
  samples: Float32Array
): Promise<void> {
  memory.set(key, samples);
  try {
    await withStore("readwrite", (store) => store.put(samples, key));
  } catch {
    // Private windows can refuse IndexedDB. The clip still lives in memory.
  }
}

export async function loadClip(key: string): Promise<Float32Array | null> {
  const cached = memory.get(key);
  if (cached) {
    return cached;
  }
  try {
    const stored = await withStore<unknown>("readonly", (store) =>
      store.get(key)
    );
    if (stored instanceof Float32Array) {
      memory.set(key, stored);
      return stored;
    }
  } catch {
    return null;
  }
  return null;
}

export async function deleteClip(key: string): Promise<void> {
  memory.delete(key);
  try {
    await withStore("readwrite", (store) => store.delete(key));
  } catch {
    // Nothing to clean up.
  }
}

/** Drop stored clips no prompt or scene still points at. */
export async function pruneClips(keep: ReadonlySet<string>): Promise<void> {
  let keys: IDBValidKey[];
  try {
    keys = await withStore<IDBValidKey[]>("readonly", (store) =>
      store.getAllKeys()
    );
  } catch {
    return;
  }
  await Promise.all(
    keys
      .filter((key) => typeof key === "string" && !keep.has(key))
      .map((key) => deleteClip(String(key)))
  );
}
