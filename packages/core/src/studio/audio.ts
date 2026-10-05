// The stage's audio graph. One context lives for the whole session:
//
//   pcm worklet ─┬─ model analyser (chroma)
//                └─ gate → EQ (low, mid, high) → DJ filter (low-pass, high-pass)
//                     ├─ dry ───────────────────────────┐
//                     ├─ echo send → ping-pong delay ───┤
//                     └─ reverb send → convolver ───────┤
//                                                       sum → volume → limiter → tap → master analyser → speakers
//
// The tap worklet meters every sample, keeps the last minute for retro
// capture, and streams recordings.

import type { FxState } from "./types.ts";
import { SAMPLE_RATE } from "./types.ts";

const WORKLET_URL = "/pcm-worklet.js?v=5";
const SMOOTH = 0.03;
const LOW_PASS_FLOOR = 70;
const HIGH_PASS_CEILING = 9000;
const MAX_DELAY = 2.5;

export interface MeterReading {
  peakL: number;
  peakR: number;
  rmsL: number;
  rmsR: number;
}

export interface PlaybackStats {
  playing: boolean;
  queued: number;
  ratio: number;
  underruns: number;
}

export interface StereoClip {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

function pcm16ToStereo(bytes: ArrayBuffer): Float32Array {
  const view = new Int16Array(bytes);
  const frames = Math.floor(view.length / 2);
  const stereo = new Float32Array(frames * 2);
  for (let index = 0; index < frames * 2; index += 1) {
    stereo[index] = (view[index] ?? 0) / 32_768;
  }
  return stereo;
}

/** A dark, diffuse stereo impulse: decaying noise that loses its top end. */
export function makeImpulse(
  context: BaseAudioContext,
  size: number
): AudioBuffer {
  const seconds = 0.6 + size * 5.4;
  const length = Math.round(context.sampleRate * seconds);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  const predelay = Math.round(context.sampleRate * (0.008 + size * 0.03));
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let smooth = 0;
    for (let index = predelay; index < length; index += 1) {
      const noise = (Math.random() * 2 - 1) * 0.9;
      const age = (index - predelay) / length;
      const darken = 0.08 + age * 0.85;
      smooth += (noise - smooth) * (1 - darken);
      data[index] = smooth * (1 - age) ** (2.2 + (1 - size) * 2);
    }
  }
  return buffer;
}

function setSmooth(param: AudioParam, value: number, context: AudioContext) {
  param.setTargetAtTime(value, context.currentTime, SMOOTH);
}

export class LiveAudio {
  readonly context: AudioContext;
  readonly modelAnalyser: AnalyserNode;
  readonly masterAnalyser: AnalyserNode;
  private readonly pcm: AudioWorkletNode;
  private readonly tap: AudioWorkletNode;
  private readonly gate: GainNode;
  private readonly eqLow: BiquadFilterNode;
  private readonly eqMid: BiquadFilterNode;
  private readonly eqHigh: BiquadFilterNode;
  private readonly lowPass: BiquadFilterNode;
  private readonly highPass: BiquadFilterNode;
  private readonly delaySend: GainNode;
  private readonly delayLeft: DelayNode;
  private readonly delayRight: DelayNode;
  private readonly delayFeedback: GainNode;
  private readonly reverbSend: GainNode;
  private readonly reverb: ConvolverNode;
  private readonly volume: GainNode;
  private reverbSize = -1;
  private phase = 0;
  private tailLeft = 0;
  private tailRight = 0;
  private closed = false;
  private captureId = 0;
  private readonly captures = new Map<number, (clip: StereoClip) => void>();
  private recordChunks: StereoClip[] = [];
  private recordDone: ((clip: StereoClip) => void) | null = null;
  onMeter: ((reading: MeterReading) => void) | null = null;
  onStats: ((stats: PlaybackStats) => void) | null = null;

  private constructor(context: AudioContext, target: number) {
    this.context = context;
    this.pcm = new AudioWorkletNode(context, "pcm-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { production: 0.94, target },
    });
    this.tap = new AudioWorkletNode(context, "tap-processor", {
      channelCount: 2,
      channelCountMode: "explicit",
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    this.modelAnalyser = context.createAnalyser();
    this.modelAnalyser.fftSize = 8192;
    this.modelAnalyser.smoothingTimeConstant = 0.6;
    this.masterAnalyser = context.createAnalyser();
    this.masterAnalyser.fftSize = 4096;
    this.masterAnalyser.smoothingTimeConstant = 0.2;

    this.gate = context.createGain();
    this.eqLow = context.createBiquadFilter();
    this.eqLow.type = "lowshelf";
    this.eqLow.frequency.value = 220;
    this.eqMid = context.createBiquadFilter();
    this.eqMid.type = "peaking";
    this.eqMid.frequency.value = 1100;
    this.eqMid.Q.value = 0.7;
    this.eqHigh = context.createBiquadFilter();
    this.eqHigh.type = "highshelf";
    this.eqHigh.frequency.value = 4200;
    this.lowPass = context.createBiquadFilter();
    this.lowPass.type = "lowpass";
    this.lowPass.frequency.value = 20_000;
    this.highPass = context.createBiquadFilter();
    this.highPass.type = "highpass";
    this.highPass.frequency.value = 10;

    const sum = context.createGain();
    this.volume = context.createGain();
    this.volume.gain.value = 0.8;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;

    // Ping-pong echo: mono in, left tap feeds right, right feeds back left
    // through a darkening filter.
    this.delaySend = context.createGain();
    this.delaySend.gain.value = 0;
    const mono = context.createGain();
    mono.channelCount = 1;
    mono.channelCountMode = "explicit";
    this.delayLeft = context.createDelay(MAX_DELAY);
    this.delayRight = context.createDelay(MAX_DELAY);
    this.delayFeedback = context.createGain();
    this.delayFeedback.gain.value = 0.38;
    const tone = context.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3200;
    const merge = context.createChannelMerger(2);
    this.delaySend.connect(mono);
    mono.connect(this.delayLeft);
    this.delayLeft.connect(this.delayRight);
    this.delayRight.connect(this.delayFeedback);
    this.delayFeedback.connect(tone);
    tone.connect(this.delayLeft);
    this.delayLeft.connect(merge, 0, 0);
    this.delayRight.connect(merge, 0, 1);
    merge.connect(sum);

    this.reverbSend = context.createGain();
    this.reverbSend.gain.value = 0;
    this.reverb = context.createConvolver();
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(sum);

    this.pcm.connect(this.modelAnalyser);
    this.pcm.connect(this.gate);
    this.gate.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.lowPass);
    this.lowPass.connect(this.highPass);
    this.highPass.connect(sum);
    this.highPass.connect(this.delaySend);
    this.highPass.connect(this.reverbSend);
    sum.connect(this.volume);
    this.volume.connect(limiter);
    limiter.connect(this.tap);
    this.tap.connect(this.masterAnalyser);
    this.masterAnalyser.connect(context.destination);

    this.pcm.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { kind?: string } & PlaybackStats;
      if (data?.kind === "stats") {
        this.onStats?.(data);
      }
    };
    this.tap.port.onmessage = (event: MessageEvent) => this.fromTap(event.data);
    this.setReverbSize(0.5);
  }

  /** Must run from a user gesture so the browser lets the context start. */
  static async create(target: number): Promise<LiveAudio> {
    let context: AudioContext;
    try {
      context = new AudioContext({
        latencyHint: "interactive",
        sampleRate: SAMPLE_RATE,
      });
    } catch {
      context = new AudioContext();
    }
    await context.audioWorklet.addModule(WORKLET_URL);
    const audio = new LiveAudio(context, target);
    if (context.state !== "running") {
      await context.resume();
    }
    return audio;
  }

  get sampleRate(): number {
    return this.context.sampleRate;
  }

  /** Extra seconds the speakers add after the worklet. */
  get outputLatency(): number {
    return (this.context.outputLatency || 0) + (this.context.baseLatency || 0);
  }

  async resume(): Promise<void> {
    if (this.context.state !== "running") {
      await this.context.resume();
    }
  }

  pushPcm16(bytes: ArrayBuffer): void {
    const raw = pcm16ToStereo(bytes);
    const frames = raw.length / 2;
    if (frames === 0 || this.closed) {
      return;
    }
    const samples = this.matchRate(raw, frames);
    this.pcm.port.postMessage({ kind: "pcm", samples }, [samples.buffer]);
  }

  reset(): void {
    this.phase = 0;
    this.pcm.port.postMessage({ kind: "reset" });
  }

  setTarget(seconds: number): void {
    this.pcm.port.postMessage({ kind: "target", seconds });
  }

  setVolume(value: number): void {
    setSmooth(this.volume.gain, value, this.context);
  }

  /** Open instantly; close after `after` seconds with a soft release. */
  setGate(open: boolean, after = 0): void {
    const param = this.gate.gain;
    const now = this.context.currentTime;
    param.cancelScheduledValues(now);
    if (open) {
      param.setTargetAtTime(1, now, 0.005);
      return;
    }
    param.setValueAtTime(param.value, now);
    param.setTargetAtTime(0, now + Math.max(0, after), 0.35);
  }

  setFx(fx: FxState, bpm: number): void {
    const context = this.context;
    setSmooth(this.eqLow.gain, fx.eqLow, context);
    setSmooth(this.eqMid.gain, fx.eqMid, context);
    setSmooth(this.eqHigh.gain, fx.eqHigh, context);
    const amount = Math.min(1, Math.max(-1, fx.filter));
    const lowCut =
      amount < 0 ? 20_000 * (LOW_PASS_FLOOR / 20_000) ** -amount : 20_000;
    const highCut = amount > 0 ? 10 * (HIGH_PASS_CEILING / 10) ** amount : 10;
    const resonance = 0.7 + fx.filterResonance * 11;
    setSmooth(this.lowPass.frequency, lowCut, context);
    setSmooth(this.highPass.frequency, highCut, context);
    setSmooth(this.lowPass.Q, amount < 0 ? resonance : 0.7, context);
    setSmooth(this.highPass.Q, amount > 0 ? resonance : 0.7, context);
    const beat = 60 / Math.max(30, bpm);
    const delay = Math.min(MAX_DELAY, beat * fx.delayDivision);
    setSmooth(this.delayLeft.delayTime, delay, context);
    setSmooth(this.delayRight.delayTime, delay, context);
    setSmooth(
      this.delayFeedback.gain,
      Math.min(0.92, fx.delayFeedback),
      context
    );
    setSmooth(this.delaySend.gain, fx.delayMix, context);
    setSmooth(this.reverbSend.gain, fx.reverbMix * 1.4, context);
    this.setReverbSize(fx.reverbSize);
  }

  /** Copy the last `seconds` of the master bus. */
  capture(seconds: number): Promise<StereoClip> {
    this.captureId += 1;
    const id = this.captureId;
    return new Promise((resolve) => {
      this.captures.set(id, resolve);
      this.tap.port.postMessage({ id, kind: "capture", seconds });
    });
  }

  startRecording(): void {
    this.recordChunks = [];
    this.tap.port.postMessage({ kind: "record", on: true });
  }

  stopRecording(): Promise<StereoClip> {
    return new Promise((resolve) => {
      this.recordDone = resolve;
      this.tap.port.postMessage({ kind: "record", on: false });
    });
  }

  close(): void {
    this.closed = true;
    this.pcm.disconnect();
    this.tap.disconnect();
    this.context.close().catch(() => undefined);
  }

  private setReverbSize(size: number): void {
    const rounded = Math.round(size * 20) / 20;
    if (rounded === this.reverbSize) {
      return;
    }
    this.reverbSize = rounded;
    this.reverb.buffer = makeImpulse(this.context, rounded);
  }

  private fromTap(
    data: {
      id?: number;
      kind?: string;
      left?: Float32Array;
      right?: Float32Array;
    } & Partial<MeterReading>
  ): void {
    if (data.kind === "meter") {
      this.onMeter?.(data as MeterReading);
      return;
    }
    if (data.kind === "capture" && data.left && data.right) {
      const resolve = this.captures.get(data.id ?? -1);
      this.captures.delete(data.id ?? -1);
      resolve?.({
        left: data.left,
        right: data.right,
        sampleRate: this.sampleRate,
      });
      return;
    }
    if (data.kind === "chunk" && data.left && data.right) {
      this.recordChunks.push({
        left: data.left,
        right: data.right,
        sampleRate: this.sampleRate,
      });
      return;
    }
    if (data.kind === "record-end") {
      const clip = joinClips(this.recordChunks, this.sampleRate);
      this.recordChunks = [];
      this.recordDone?.(clip);
      this.recordDone = null;
    }
  }

  private matchRate(stereo: Float32Array, inFrames: number): Float32Array {
    const rate = this.context.sampleRate;
    if (Math.abs(rate - SAMPLE_RATE) < 1) {
      return stereo;
    }
    const step = SAMPLE_RATE / rate;
    const outFrames = Math.max(0, Math.floor((inFrames - this.phase) / step));
    const out = new Float32Array(outFrames * 2);
    for (let index = 0; index < outFrames; index += 1) {
      const position = this.phase + index * step;
      const base = Math.floor(position);
      const mix = position - base;
      const next = Math.min(inFrames - 1, Math.max(0, base + 1));
      const leftBase = base < 0 ? this.tailLeft : (stereo[base * 2] ?? 0);
      const rightBase = base < 0 ? this.tailRight : (stereo[base * 2 + 1] ?? 0);
      const leftNext = stereo[next * 2] ?? leftBase;
      const rightNext = stereo[next * 2 + 1] ?? rightBase;
      out[index * 2] = leftBase + (leftNext - leftBase) * mix;
      out[index * 2 + 1] = rightBase + (rightNext - rightBase) * mix;
    }
    this.phase = this.phase + outFrames * step - inFrames;
    this.tailLeft = stereo[(inFrames - 1) * 2] ?? 0;
    this.tailRight = stereo[(inFrames - 1) * 2 + 1] ?? 0;
    return out;
  }
}

export function joinClips(clips: StereoClip[], sampleRate: number): StereoClip {
  const frames = clips.reduce((sum, clip) => sum + clip.left.length, 0);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  let offset = 0;
  for (const clip of clips) {
    left.set(clip.left, offset);
    right.set(clip.right, offset);
    offset += clip.left.length;
  }
  return { left, right, sampleRate };
}
