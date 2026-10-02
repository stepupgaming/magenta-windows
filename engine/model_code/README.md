---
license: apache-2.0
library_name: transformers
pipeline_tag: text-to-audio
tags:
- music-generation
- real-time
- magenta
- audio
base_model: google/magenta-realtime-2
---

# Magenta RealTime 2 — PyTorch

A pure-**PyTorch**, `transformers`-compatible port of [`google/magenta-realtime-2`](https://huggingface.co/google/magenta-realtime-2),
a real-time streaming music generation model. Every component (Depthformer LLM,
SpectroStream neural codec, MusicCoCa style encoder) was reimplemented in torch
and validated **bit/token-exact** against the original JAX/TFLite reference.

Loads with `trust_remote_code=True` — no JAX, no TFLite. Runtime deps: `torch`,
`transformers`, `sentencepiece` (+ `soundfile` to save audio).

## Usage

```python
import torch, soundfile as sf
from transformers import AutoModel

model = AutoModel.from_pretrained(
    "magenta-community/magenta-realtime-2", trust_remote_code=True, dtype=torch.bfloat16
).to("cuda").eval()

# Text / audio prompts via the MusicCoCa processor:
model.load_processor()                       # magenta-community/magenta-rt-musiccoca-torch
model.compile_steps()                        # optional: torch.compile the per-frame step (faster generation)
audio, state = model.generate(style="lo-fi hip hop, mellow", frames=50, temperature=1.1)
sf.write("out.wav", audio, 48000)            # ~2 s, 48 kHz stereo

# Continuous / live steering — keep passing `state` back; change `style` to morph:
chunk, state = model.generate(style="drum and bass", frames=25, state=state)

# Or skip the processor and pass explicit style tokens (12 RVQ ids):
audio, _ = model.generate(style=[100] * 12, frames=50)

# --- Real-time streaming: stateful per-frame (40 ms) decode, low latency ---
# small chunks are cheap (no overlap-save re-decode); keep passing `state` back,
# change `style` any time to morph live:
state = None
for _ in range(40):                          # ~8 s, ~0.2 s latency per step
    chunk, state = model.generate(style="techno", frames=5, state=state)
    # send `chunk` (48 kHz stereo float32) straight to your audio output
```

`model.generate(...)` returns `(audio, state)`. Pass `state` back for seamless
continuation; only the newly-available audio is returned each call (use `flush=True`
on the final call to emit the tail).

## Architecture

| Component | What it is | Validation vs reference |
|---|---|---|
| **Depthformer** | decoder-only LLM, per-frame RVQ depth-autoregression | token-exact |
| **SpectroStream** | RVQ neural audio codec (encoder + decoder) | decode 2.7e-6 · encode codes 100% |
| **MusicCoCa** | text+audio style encoder (separate `MusicCoCaProcessor`) | tokens 100% exact |

Generation is **custom streaming**, not `GenerationMixin`: the per-frame multi-codebook
depth loop + streaming codec decode don't fit a single-token-stream `_sample`.

## Streaming

`generate` returns only the newly-available audio and a `state`; pass `state` back to
continue seamlessly, and change `style` between calls to steer the stream live:

```python
import sounddevice as sd, numpy as np
state = None
with sd.OutputStream(samplerate=48000, channels=2, dtype="float32") as out:
    for i in range(20):                       # ~20 s
        chunk, state = model.generate(style="techno", frames=25, state=state, flush=(i == 19))
        out.write(np.ascontiguousarray(chunk, dtype=np.float32))
```

A runnable version (live playback or wav-out) is in [`examples/streaming.py`](https://github.com/multimodalart/magenta-realtime/blob/pytorch-port/examples/streaming.py).

## Real-time / speed

`torch.compile` the per-frame step for faster-than-real-time generation (one-time warmup,
any CUDA GPU):

```python
model.compile_steps()                         # torch.compile (dynamic shapes); warms on first call
audio, state = model.generate(style="techno", frames=25)
```

To skip even that startup compile in real-time / production, export ahead-of-time
**AOTInductor** graphs once and reload them with no compile-time (graphs are
GPU-architecture-specific, so export on the GPU you run on):

```python
model.export_aoti("./aoti")                   # compile once on your target GPU
# later / elsewhere on the same GPU arch:
model.load_aoti("./aoti")                     # instant load, no torch.compile
```

## Live demos (ZeroGPU Spaces)

- 🎹 [**Jam**](https://huggingface.co/spaces/magenta-community/magenta-rt-jam) — real-time note / keyboard control
- 🌀 [**Collider**](https://huggingface.co/spaces/magenta-community/magenta-rt-collider) — explore prompt space
- 🎛️ [**Studio**](https://huggingface.co/spaces/magenta-community/magenta-rt-studio) — producer-style controls

## Sizes

- [`magenta-community/magenta-realtime-2`](https://huggingface.co/magenta-community/magenta-realtime-2) — **base** (canonical, higher quality)
- [`magenta-community/magenta-realtime-2-small`](https://huggingface.co/magenta-community/magenta-realtime-2-small) — **small** (real-time)

## Provenance

Weights are torch-native (re-keyed from google's checkpoint, numerically identical).
The JAX→torch conversion + parity harness lives in the dev repo
([fork](https://github.com/multimodalart/magenta-realtime-torch)). Apache-2.0,
after upstream [magenta-realtime](https://github.com/magenta/magenta-realtime).
