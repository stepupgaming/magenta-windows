// The GPU finishes each chunk a little after the speaker clock (about 0.94x).
// A fixed queue eventually runs dry, and the dry splice is the click.
// This keeps about one second queued and overlap-adds a slightly longer grain
// so the queue stays full. Pitch stays put. Tempo sits a little under native.

const WIN = 2048;
const HOP = 1024;
const SEARCH = 48;
const CAPACITY = 48_000 * 8;
const OUT_CAP = 8192;
const FADE = 256;

function riseWindow(length) {
  const window = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((Math.PI * index) / length));
  }
  return window;
}

class PcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const asked = options?.processorOptions?.production;
    this.production =
      typeof asked === "number" && asked > 0.5 && asked < 1.2 ? asked : 0.94;
    this.target = Math.round(sampleRate);
    this.ratio = 1 / this.production;
    this.left = new Float32Array(CAPACITY);
    this.right = new Float32Array(CAPACITY);
    this.write = 0;
    this.read = 0;
    this.available = 0;
    this.started = false;
    this.dying = false;
    this.duck = 0;
    this.hasTail = false;
    this.tailL = new Float32Array(HOP);
    this.tailR = new Float32Array(HOP);
    this.rise = riseWindow(HOP);
    this.outL = new Float32Array(OUT_CAP);
    this.outR = new Float32Array(OUT_CAP);
    this.outW = 0;
    this.outRpos = 0;
    this.outCount = 0;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data || data.kind !== "pcm") {
        return;
      }
      this.pushInput(data.samples);
    };
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
    const index =
      (((this.read + logical) % CAPACITY) + CAPACITY) % CAPACITY;
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

  process(_inputs, outputs) {
    const channel = outputs[0];
    const left = channel[0];
    const right = channel[1];
    if (!left || !right) {
      return true;
    }
    const count = left.length;
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
    this.dying = this.outCount < 512;
    for (let index = 0; index < count; index += 1) {
      let sampleL = 0;
      let sampleR = 0;
      if (this.outCount > 0) {
        sampleL = this.outL[this.outRpos];
        sampleR = this.outR[this.outRpos];
        this.outRpos = (this.outRpos + 1) % OUT_CAP;
        this.outCount -= 1;
      }
      if (this.dying) {
        this.duck = Math.max(0, this.duck - 1 / FADE);
      } else {
        this.duck = Math.min(1, this.duck + 1 / FADE);
      }
      left[index] = sampleL * this.duck;
      right[index] = sampleR * this.duck;
    }
    return true;
  }
}

registerProcessor("pcm-processor", PcmProcessor);
