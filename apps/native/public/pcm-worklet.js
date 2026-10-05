// Two audio-thread processors for the Magenta stage.
//
// pcm-processor plays the engine's PCM. The GPU finishes each chunk a little
// after the speaker clock (about 0.94x). A fixed queue eventually runs dry,
// and the dry splice is the click. This keeps a cushion queued (one second by
// default) and overlap-adds a slightly longer grain so the queue stays full.
// Pitch stays put. Tempo sits a little under native.
//
// tap-processor passes the master bus through untouched. It meters every
// sample, keeps the last minute for retro capture, and streams a recording.

const WIN = 2048;
const HOP = 1024;
const SEARCH = 48;
const CAPACITY = 48_000 * 8;
const OUT_CAP = 8192;
const FADE = 256;
const STATS_EVERY = 4800;
const MIN_TARGET = 0.25;
const MAX_TARGET = 3;

function riseWindow(length) {
  const window = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((Math.PI * index) / length));
  }
  return window;
}

function targetFrames(seconds) {
  const clamped = Math.min(MAX_TARGET, Math.max(MIN_TARGET, seconds));
  return Math.round(sampleRate * clamped);
}

class PcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const asked = options?.processorOptions?.production;
    const target = options?.processorOptions?.target;
    this.production =
      typeof asked === "number" && asked > 0.5 && asked < 1.2 ? asked : 0.94;
    this.target = targetFrames(typeof target === "number" ? target : 1);
    this.ratio = 1 / this.production;
    this.left = new Float32Array(CAPACITY);
    this.right = new Float32Array(CAPACITY);
    this.rise = riseWindow(HOP);
    this.tailL = new Float32Array(HOP);
    this.tailR = new Float32Array(HOP);
    this.outL = new Float32Array(OUT_CAP);
    this.outR = new Float32Array(OUT_CAP);
    this.underruns = 0;
    this.sinceStats = 0;
    this.clear();
    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) {
        return;
      }
      if (data.kind === "pcm") {
        this.pushInput(data.samples);
      } else if (data.kind === "target") {
        this.target = targetFrames(data.seconds);
      } else if (data.kind === "reset") {
        this.clear();
      }
    };
  }

  clear() {
    this.write = 0;
    this.read = 0;
    this.available = 0;
    this.started = false;
    this.duck = 0;
    this.hasTail = false;
    this.outW = 0;
    this.outRpos = 0;
    this.outCount = 0;
  }

  pushInput(incoming) {
    const frames = incoming.length / 2;
    for (let index = 0; index < frames; index += 1) {
      if (this.available >= CAPACITY - WIN) {
        this.read = (this.read + HOP) % CAPACITY;
        this.available -= HOP;
        this.hasTail = false;
      }
      this.left[this.write] = incoming[index * 2];
      this.right[this.write] = incoming[index * 2 + 1];
      this.write = (this.write + 1) % CAPACITY;
      this.available += 1;
    }
  }

  at(channel, logical) {
    const index = (((this.read + logical) % CAPACITY) + CAPACITY) % CAPACITY;
    return channel === 0 ? this.left[index] : this.right[index];
  }

  smoothRatio() {
    const error = (this.available - this.target) / this.target;
    const center = 1 / this.production;
    let desired = center - error * 0.2;
    if (desired < 1) {
      desired = 1;
    }
    if (desired > 1.4) {
      desired = 1.4;
    }
    this.ratio += (desired - this.ratio) * 0.15;
  }

  bestDelta() {
    let best = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let delta = -SEARCH; delta <= SEARCH; delta += 1) {
      let score = 0;
      for (let index = 0; index < HOP; index += 2) {
        const left = this.at(0, delta + index) - this.tailL[index];
        const right = this.at(1, delta + index) - this.tailR[index];
        score += left * left + right * right;
      }
      if (score < bestScore) {
        bestScore = score;
        best = delta;
      }
    }
    return best;
  }

  pushOut(left, right) {
    this.outL[this.outW] = left;
    this.outR[this.outW] = right;
    this.outW = (this.outW + 1) % OUT_CAP;
    this.outCount += 1;
  }

  makeGrain() {
    if (this.available < WIN + SEARCH || this.outCount > OUT_CAP - HOP - 4) {
      return false;
    }
    const analysis = Math.max(64, Math.round(HOP / this.ratio));
    const delta = this.hasTail ? this.bestDelta() : 0;
    for (let index = 0; index < HOP; index += 1) {
      const weight = this.rise[index];
      const left = this.at(0, delta + index);
      const right = this.at(1, delta + index);
      if (this.hasTail) {
        this.pushOut(
          left * weight + this.tailL[index] * (1 - weight),
          right * weight + this.tailR[index] * (1 - weight)
        );
      } else {
        this.pushOut(left * weight, right * weight);
      }
    }
    for (let index = 0; index < HOP; index += 1) {
      this.tailL[index] = this.at(0, delta + HOP + index);
      this.tailR[index] = this.at(1, delta + HOP + index);
    }
    this.hasTail = true;
    this.read = (this.read + analysis) % CAPACITY;
    this.available -= analysis;
    this.smoothRatio();
    return true;
  }

  report(count) {
    this.sinceStats += count;
    if (this.sinceStats < STATS_EVERY) {
      return;
    }
    this.sinceStats = 0;
    this.port.postMessage({
      kind: "stats",
      playing: this.started,
      queued: (this.available + this.outCount) / sampleRate,
      ratio: this.ratio,
      underruns: this.underruns,
    });
  }

  process(_inputs, outputs) {
    const channel = outputs[0];
    const left = channel[0];
    const right = channel[1];
    if (!(left && right)) {
      return true;
    }
    const count = left.length;
    this.report(count);
    if (!this.started) {
      if (this.available < this.target) {
        left.fill(0);
        right.fill(0);
        return true;
      }
      this.started = true;
    }
    while (this.outCount < count + 512) {
      if (!this.makeGrain()) {
        break;
      }
    }
    const dying = this.outCount < 512;
    for (let index = 0; index < count; index += 1) {
      let sampleL = 0;
      let sampleR = 0;
      if (this.outCount > 0) {
        sampleL = this.outL[this.outRpos];
        sampleR = this.outR[this.outRpos];
        this.outRpos = (this.outRpos + 1) % OUT_CAP;
        this.outCount -= 1;
      }
      if (dying) {
        this.duck = Math.max(0, this.duck - 1 / FADE);
      } else {
        this.duck = Math.min(1, this.duck + 1 / FADE);
      }
      left[index] = sampleL * this.duck;
      right[index] = sampleR * this.duck;
    }
    if (dying && this.outCount === 0 && this.duck === 0) {
      // The queue ran dry. Wait for a full cushion again instead of
      // stuttering on scraps.
      this.underruns += 1;
      this.started = false;
      this.hasTail = false;
    }
    return true;
  }
}

const RETRO_SECONDS = 60;
const RECORD_CHUNK = 12_000;
const METER_EVERY = 1600;

class TapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate * RETRO_SECONDS);
    this.ringL = new Float32Array(this.size);
    this.ringR = new Float32Array(this.size);
    this.head = 0;
    this.filled = 0;
    this.recording = false;
    this.chunkL = new Float32Array(RECORD_CHUNK);
    this.chunkR = new Float32Array(RECORD_CHUNK);
    this.chunkFill = 0;
    this.meterCount = 0;
    this.peakL = 0;
    this.peakR = 0;
    this.sumL = 0;
    this.sumR = 0;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) {
        return;
      }
      if (data.kind === "capture") {
        this.capture(data.id, data.seconds);
      } else if (data.kind === "record") {
        if (data.on) {
          this.chunkFill = 0;
          this.recording = true;
        } else {
          this.flushChunk();
          this.recording = false;
          this.port.postMessage({ kind: "record-end" });
        }
      }
    };
  }

  capture(id, seconds) {
    const frames = Math.min(this.filled, Math.round(sampleRate * seconds));
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    const start = (this.head - frames + this.size) % this.size;
    for (let index = 0; index < frames; index += 1) {
      const at = (start + index) % this.size;
      left[index] = this.ringL[at];
      right[index] = this.ringR[at];
    }
    this.port.postMessage({ id, kind: "capture", left, right }, [
      left.buffer,
      right.buffer,
    ]);
  }

  flushChunk() {
    if (this.chunkFill === 0) {
      return;
    }
    const left = this.chunkL.slice(0, this.chunkFill);
    const right = this.chunkR.slice(0, this.chunkFill);
    this.chunkFill = 0;
    this.port.postMessage({ kind: "chunk", left, right }, [
      left.buffer,
      right.buffer,
    ]);
  }

  meter(sampleL, sampleR) {
    const absL = Math.abs(sampleL);
    const absR = Math.abs(sampleR);
    if (absL > this.peakL) {
      this.peakL = absL;
    }
    if (absR > this.peakR) {
      this.peakR = absR;
    }
    this.sumL += sampleL * sampleL;
    this.sumR += sampleR * sampleR;
    this.meterCount += 1;
    if (this.meterCount < METER_EVERY) {
      return;
    }
    this.port.postMessage({
      kind: "meter",
      peakL: this.peakL,
      peakR: this.peakR,
      rmsL: Math.sqrt(this.sumL / this.meterCount),
      rmsR: Math.sqrt(this.sumR / this.meterCount),
    });
    this.meterCount = 0;
    this.peakL = 0;
    this.peakR = 0;
    this.sumL = 0;
    this.sumR = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const outL = output[0];
    const outR = output[1] ?? output[0];
    if (!outL) {
      return true;
    }
    const inL = input?.[0];
    const inR = input?.[1] ?? inL;
    const count = outL.length;
    for (let index = 0; index < count; index += 1) {
      const sampleL = inL ? inL[index] : 0;
      const sampleR = inR ? inR[index] : 0;
      outL[index] = sampleL;
      if (outR !== outL) {
        outR[index] = sampleR;
      }
      this.ringL[this.head] = sampleL;
      this.ringR[this.head] = sampleR;
      this.head = (this.head + 1) % this.size;
      if (this.filled < this.size) {
        this.filled += 1;
      }
      if (this.recording) {
        this.chunkL[this.chunkFill] = sampleL;
        this.chunkR[this.chunkFill] = sampleR;
        this.chunkFill += 1;
        if (this.chunkFill === RECORD_CHUNK) {
          this.flushChunk();
        }
      }
      this.meter(sampleL, sampleR);
    }
    return true;
  }
}

registerProcessor("pcm-processor", PcmProcessor);
registerProcessor("tap-processor", TapProcessor);
