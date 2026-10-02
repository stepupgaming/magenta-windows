const INPUT_RATE = 48_000;

function pcm16ToStereo(bytes: ArrayBuffer): Float32Array {
  const view = new Int16Array(bytes);
  const frames = Math.floor(view.length / 2);
  const stereo = new Float32Array(frames * 2);
  for (let index = 0; index < frames; index += 1) {
    stereo[index * 2] = (view[index * 2] ?? 0) / 32_768;
    stereo[index * 2 + 1] = (view[index * 2 + 1] ?? 0) / 32_768;
  }
  return stereo;
}

export class LiveAudio {
  readonly context: AudioContext;
  readonly analyser: AnalyserNode;
  private readonly gain: GainNode;
  private readonly highpass: BiquadFilterNode;
  private readonly lowpass: BiquadFilterNode;
  private readonly combDelay: DelayNode;
  private readonly combGain: GainNode;
  private readonly combWet: GainNode;
  private readonly reverbDelay: DelayNode;
  private readonly reverbGain: GainNode;
  private readonly reverbWet: GainNode;
  private readonly dry: GainNode;
  private readonly ready: Promise<void>;
  private node: AudioWorkletNode | null = null;
  private readonly early: Float32Array[] = [];
  private closed = false;
  private phase = 0;
  private tailLeft = 0;
  private tailRight = 0;

  constructor() {
    try {
      this.context = new AudioContext({ sampleRate: INPUT_RATE });
    } catch {
      this.context = new AudioContext();
    }
    this.gain = this.context.createGain();
    this.highpass = this.context.createBiquadFilter();
    this.lowpass = this.context.createBiquadFilter();
    this.highpass.type = "highpass";
    this.lowpass.type = "lowpass";
    this.highpass.frequency.value = 20;
    this.lowpass.frequency.value = 20_000;
    this.combDelay = this.context.createDelay(0.2);
    this.combDelay.delayTime.value = 0.018;
    this.combGain = this.context.createGain();
    this.combGain.gain.value = 0.42;
    this.combWet = this.context.createGain();
    this.combWet.gain.value = 0;
    this.reverbDelay = this.context.createDelay(0.4);
    this.reverbDelay.delayTime.value = 0.047;
    this.reverbGain = this.context.createGain();
    this.reverbGain.gain.value = 0.38;
    this.reverbWet = this.context.createGain();
    this.reverbWet.gain.value = 0;
    this.dry = this.context.createGain();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.highpass.connect(this.lowpass);
    this.lowpass.connect(this.dry);
    this.dry.connect(this.gain);
    this.lowpass.connect(this.combDelay);
    this.combDelay.connect(this.combGain);
    this.combGain.connect(this.combDelay);
    this.combDelay.connect(this.combWet);
    this.combWet.connect(this.gain);
    this.lowpass.connect(this.reverbDelay);
    this.reverbDelay.connect(this.reverbGain);
    this.reverbGain.connect(this.reverbDelay);
    this.reverbDelay.connect(this.reverbWet);
    this.reverbWet.connect(this.gain);
    this.gain.connect(this.analyser);
    this.analyser.connect(this.context.destination);
    this.gain.gain.value = 0.8;
    this.ready = this.mount();
  }

  pushPcm16(bytes: ArrayBuffer): void {
    const raw = pcm16ToStereo(bytes);
    const frames = raw.length / 2;
    if (frames === 0) {
      return;
    }
    this.post(this.matchRate(raw, frames));
  }

  setVolume(value: number): void {
    this.gain.gain.value = value;
  }

  setFilters(highpassHz: number, lowpassHz: number): void {
    this.highpass.frequency.value = highpassHz;
    this.lowpass.frequency.value = lowpassHz;
  }

  setComb(enabled: boolean): void {
    this.combWet.gain.value = enabled ? 0.35 : 0;
  }

  setReverb(enabled: boolean): void {
    this.reverbWet.gain.value = enabled ? 0.28 : 0;
  }

  async resume(): Promise<void> {
    await this.ready;
    if (this.context.state !== "running") {
      await this.context.resume();
    }
  }

  close(): void {
    this.closed = true;
    this.node?.disconnect();
    this.context.close().catch(() => undefined);
  }

  private async mount(): Promise<void> {
    await this.context.audioWorklet.addModule("/pcm-worklet.js?v=4");
    if (this.closed) {
      return;
    }
    const node = new AudioWorkletNode(this.context, "pcm-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { production: 0.94 },
    });
    node.connect(this.highpass);
    this.node = node;
    for (const samples of this.early.splice(0, this.early.length)) {
      this.post(samples);
    }
  }

  private post(samples: Float32Array): void {
    const node = this.node;
    if (!node) {
      this.early.push(samples);
      return;
    }
    const copy = samples.slice();
    node.port.postMessage({ kind: "pcm", samples: copy }, [copy.buffer]);
  }

  private matchRate(stereo: Float32Array, inFrames: number): Float32Array {
    const rate = this.context.sampleRate;
    if (Math.abs(rate - INPUT_RATE) < 1) {
      return stereo;
    }
    const step = INPUT_RATE / rate;
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
