#!/usr/bin/env node
/** biome-ignore-all lint/suspicious/noBitwiseOperators: WebSocket frames are bit fields. */
// A stand-in for engine/server.py so the stage can be built and tested
// without an NVIDIA GPU. Same HTTP routes, same websocket protocol. It plays
// a simple synth that follows the held notes, the drum mode, and a timbre
// picked from the prompt text, brighter with more style detail. Remembered
// grooves restore the synth's clock. Continuing from a clip replays the clip's
// last seconds before the pickup, then the synth carries on. It is not the model.
//
//   node scripts/mock-engine.mjs            listens on 127.0.0.1:8765
//   MAGENTA_PORT=9000 node scripts/mock-engine.mjs

import { createHash } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.MAGENTA_PORT ?? 8765);
const RATE = 48_000;
const FRAME = 1920;
const FRAMES_PER_STEP = 4;
const SPEED = 0.96;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const clips = new Map();
// Clips to continue from: interleaved stereo float32 at 48 kHz.
const continueClips = new Map();
// The engine trims 25 frames from a clip's end, and the codec has one more.
const PICKUP_SECONDS = 1.04;
const CLIP_MIN_SECONDS = 4;
let loaded = false;

function health() {
  return {
    backend: "mock",
    error: null,
    gpu: "Mock engine (no GPU)",
    model_loaded: loaded,
    ok: true,
    sample_rate: RATE,
    text_mapper: "off",
    text_mapper_detail: "The mock engine has no model to refine prompts for.",
    clip_encoder: "on",
    clip_encoder_detail:
      "The mock engine replays the clip's last seconds, then its own synth.",
  };
}

function send(response, status, body) {
  response.writeHead(status, {
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "*",
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve) => {
    const parts = [];
    request.on("data", (part) => parts.push(part));
    request.on("end", () => resolve(Buffer.concat(parts)));
  });
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    send(response, 204, {});
    return;
  }
  if (request.url === "/health") {
    send(response, 200, health());
    return;
  }
  if (request.url === "/load" && request.method === "POST") {
    if (!loaded) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      loaded = true;
    }
    send(response, 200, health());
    return;
  }
  if (request.url === "/audio-prompt" && request.method === "POST") {
    const body = await readBody(request);
    if (body.length % 4 !== 0 || body.length < 4 * 8000) {
      send(response, 400, {
        detail: "audio prompt must be float32 at 16 kHz, half a second or more",
      });
      return;
    }
    const id = createHash("sha1").update(body).digest("hex").slice(0, 16);
    clips.set(id, body.length / 4 / 16_000);
    send(response, 200, { id, seconds: body.length / 4 / 16_000 });
    return;
  }
  if (request.url === "/clip" && request.method === "POST") {
    const body = await readBody(request);
    const seconds = body.length / 8 / RATE;
    if (body.length % 8 !== 0 || seconds < CLIP_MIN_SECONDS || seconds > 60) {
      send(response, 400, {
        detail: `a clip must be 48 kHz stereo float32, ${CLIP_MIN_SECONDS} to 60 seconds`,
      });
      return;
    }
    const id = createHash("sha1").update(body).digest("hex").slice(0, 16);
    continueClips.set(id, body);
    send(response, 200, { id, seconds });
    return;
  }
  if (request.url === "/shutdown" && request.method === "POST") {
    send(response, 200, { ok: true, stopping: true });
    setTimeout(() => process.exit(0), 200);
    return;
  }
  send(response, 404, { detail: "not found" });
});

// ---- WebSocket framing -----------------------------------------------------

function frame(opcode, payload) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

function parseFrames(buffer, onMessage) {
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const opcode = buffer[offset] & 0x0f;
    const masked = (buffer[offset + 1] & 0x80) !== 0;
    let length = buffer[offset + 1] & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.length < cursor + 2) {
        break;
      }
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length < cursor + 8) {
        break;
      }
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    const maskLength = masked ? 4 : 0;
    if (buffer.length < cursor + maskLength + length) {
      break;
    }
    const mask = buffer.subarray(cursor, cursor + maskLength);
    cursor += maskLength;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (masked) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }
    onMessage(opcode, payload);
    offset = cursor + length;
  }
  return buffer.subarray(offset);
}

// ---- A small synth that follows the spec -----------------------------------

function hash(text) {
  let value = 2_166_136_261;
  for (const char of text) {
    value = Math.imul(value ^ char.charCodeAt(0), 16_777_619) >>> 0;
  }
  return value;
}

const FALLBACK_CHORDS = [
  [57, 60, 64, 69],
  [53, 57, 60, 65],
  [48, 52, 55, 60],
  [55, 59, 62, 67],
];

class Voice {
  constructor() {
    this.time = 0;
    this.phases = new Map();
    this.kick = 0;
    this.hat = 0;
    this.lastBeat = -1;
    this.lastSixteenth = -1;
  }

  pitches(spec) {
    const notes = Array.isArray(spec.notes) ? spec.notes : null;
    if (!notes) {
      const chord = Math.floor(this.time / 2.4) % FALLBACK_CHORDS.length;
      return FALLBACK_CHORDS[chord];
    }
    return notes
      .map((value, pitch) => (value >= 1 ? pitch : -1))
      .filter((pitch) => pitch >= 0);
  }

  tone(pitches, harmonics, brightness, wobble) {
    let sample = 0;
    for (const pitch of pitches) {
      const hz =
        440 *
        2 ** ((pitch - 69) / 12) *
        (1 + Math.sin(this.time * 5.1) * wobble);
      const phase = ((this.phases.get(pitch) ?? 0) + hz / RATE) % 1;
      this.phases.set(pitch, phase);
      for (let harmonic = 1; harmonic <= harmonics; harmonic += 1) {
        sample +=
          (Math.sin(2 * Math.PI * phase * harmonic) *
            brightness ** (harmonic - 1)) /
          (harmonic * 2.2);
      }
    }
    return (sample * 0.3) / Math.max(1, Math.sqrt(pitches.length));
  }

  drums(bpm) {
    const t = this.time;
    const beat = Math.floor((t * bpm) / 60);
    const sixteenth = Math.floor((t * bpm) / 15);
    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      this.kick = 1;
    }
    if (sixteenth !== this.lastSixteenth) {
      this.lastSixteenth = sixteenth;
      this.hat = sixteenth % 2 === 1 ? 0.5 : 0.2;
    }
    const sample =
      Math.sin(2 * Math.PI * (45 + this.kick * 90) * t) * this.kick * 0.55 +
      (Math.random() * 2 - 1) * this.hat * 0.12;
    this.kick *= 0.9993;
    this.hat *= 0.996;
    return sample;
  }

  render(spec, frames) {
    const out = Buffer.alloc(frames * 4);
    const prompts = Array.isArray(spec.prompts) ? spec.prompts : [];
    const style = prompts
      .map((item) => `${item.text ?? item.audio}:${item.weight}`)
      .join("|");
    const seed = hash(style || "free");
    const harmonics = 1 + (seed % 5);
    const detail = Math.min(12, Math.max(1, spec.style_levels ?? 12)) / 12;
    const brightness = (0.25 + ((seed >> 8) % 60) / 100) * (0.5 + detail);
    const wobble = Math.max(0, (spec.temperature ?? 1) - 0.8) * 0.004;
    const pitches = this.pitches(spec);
    const withDrums = spec.drums !== "off";
    const bpm = 92 + (seed % 36);
    for (let index = 0; index < frames; index += 1) {
      let sample = this.tone(pitches, harmonics, brightness, wobble);
      if (withDrums) {
        sample += this.drums(bpm);
      }
      const sway = Math.sin(this.time * 0.7) * 0.1;
      const left = Math.max(-1, Math.min(1, sample * (1 + sway)));
      const right = Math.max(-1, Math.min(1, sample * (1 - sway)));
      out.writeInt16LE(Math.round(left * 32_767), index * 4);
      out.writeInt16LE(Math.round(right * 32_767), index * 4 + 2);
      this.time += 1 / RATE;
    }
    return out;
  }
}

function stream(socket) {
  let spec = {};
  let running = false;
  let timer = null;
  const grooves = new Map();
  let sent = 0;
  let wall = 0;
  let lastStats = 0;
  let voice = new Voice();
  let pending = Buffer.alloc(0);

  const text = (body) =>
    socket.write(frame(0x1, Buffer.from(JSON.stringify(body))));

  const tick = () => {
    if (!running) {
      return;
    }
    const ahead = sent / RATE - (performance.now() - wall) / 1000;
    if (ahead < 1.2) {
      const frames = FRAME * FRAMES_PER_STEP;
      socket.write(frame(0x2, voice.render(spec, frames)));
      sent += frames;
    }
    const now = performance.now();
    if (now - lastStats > 400) {
      lastStats = now;
      text({
        msPerFrame: 40 / SPEED,
        temperature: spec.temperature,
        topK: spec.top_k,
        type: "stats",
      });
    }
    timer = setTimeout(
      tick,
      ((FRAME * FRAMES_PER_STEP) / RATE / SPEED) * 1000 * 0.98
    );
  };

  const begin = () => {
    text({ message: "Loading model", type: "status" });
    setTimeout(() => {
      text({ message: "Capturing CUDA graph", type: "status" });
      setTimeout(() => {
        voice = new Voice();
        text({
          channels: 2,
          sampleRate: RATE,
          seed: spec.seed ?? 0,
          topK: spec.top_k ?? 48,
          type: "started",
        });
        sent = 0;
        wall = performance.now();
        running = true;
        clearTimeout(timer);
        tick();
      }, 400);
    }, 250);
  };

  const copyVoice = (from) =>
    Object.assign(new Voice(), from, { phases: new Map(from.phases) });

  const remember = (slot) => {
    if (running) {
      grooves.set(slot, copyVoice(voice));
      text({ slot, type: "remembered" });
    }
  };

  const continueFrom = (id, lead) => {
    const clip = continueClips.get(id);
    if (!clip) {
      text({
        clip: id,
        message: "The clip expired on the engine. Send it again.",
        type: "continue-failed",
      });
      return;
    }
    const leadSeconds = Number.isFinite(lead)
      ? Math.min(8, Math.max(0, lead))
      : 2;
    const end = Math.max(
      0,
      clip.length / 8 - Math.round(PICKUP_SECONDS * RATE)
    );
    const start = Math.max(0, end - Math.round(leadSeconds * RATE));
    const out = Buffer.alloc((end - start) * 4);
    for (let index = 0; index < end - start; index += 1) {
      const at = (start + index) * 8;
      const left = Math.max(-1, Math.min(1, clip.readFloatLE(at)));
      const right = Math.max(-1, Math.min(1, clip.readFloatLE(at + 4)));
      out.writeInt16LE(Math.round(left * 32_767), index * 4);
      out.writeInt16LE(Math.round(right * 32_767), index * 4 + 2);
    }
    text({
      clip: id,
      lead: (end - start) / RATE,
      pickup: PICKUP_SECONDS,
      type: "continued",
    });
    if (out.length > 0) {
      socket.write(frame(0x2, out));
    }
    sent = end - start;
    wall = performance.now();
  };

  const recall = (slot) => {
    const saved = grooves.get(slot);
    if (saved) {
      voice = copyVoice(saved);
    } else {
      text({ slot, type: "forgotten" });
    }
  };

  const handle = (message) => {
    const slot = typeof message.slot === "string" ? message.slot : null;
    switch (message.op) {
      case "stop":
        running = false;
        clearTimeout(timer);
        text({ type: "stopped" });
        return;
      case "start":
      case "restart":
        spec = message;
        running = false;
        clearTimeout(timer);
        begin();
        return;
      case "remember":
        if (slot) {
          remember(slot);
        }
        return;
      case "forget":
        if (slot) {
          grooves.delete(slot);
        }
        return;
      case "steer":
        spec = message;
        if (typeof message.groove === "string") {
          recall(message.groove);
        }
        if (typeof message.continue === "string") {
          continueFrom(message.continue, message.lead);
        }
        return;
      default:
        return;
    }
  };

  const onMessage = (opcode, payload) => {
    if (opcode === 0x8) {
      running = false;
      clearTimeout(timer);
      socket.end(frame(0x8, Buffer.alloc(0)));
      return;
    }
    if (opcode === 0x9) {
      socket.write(frame(0xa, payload));
      return;
    }
    if (opcode !== 0x1) {
      return;
    }
    let message;
    try {
      message = JSON.parse(payload.toString("utf8"));
    } catch {
      return;
    }
    handle(message);
  };

  socket.on("data", (chunk) => {
    pending = parseFrames(Buffer.concat([pending, chunk]), onMessage);
  });
  socket.on("close", () => {
    running = false;
    clearTimeout(timer);
  });
  socket.on("error", () => {
    running = false;
    clearTimeout(timer);
  });
}

server.on("upgrade", (request, socket) => {
  if (request.url !== "/ws/stream") {
    socket.destroy();
    return;
  }
  const key = request.headers["sec-websocket-key"];
  const accept = createHash("sha1").update(`${key}${GUID}`).digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setNoDelay(true);
  stream(socket);
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(
    `[mock] Magenta mock engine on http://127.0.0.1:${PORT} (no model, test tones only)\n`
  );
});
