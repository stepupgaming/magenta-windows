# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Single-dispatch CUDA-graph streaming for the Depthformer decoder.

`CudaGraphStreamer` captures the whole per-frame step (temporal + N-codebook depth
+ in-graph sampler + optional CFG) as one `torch.cuda.graph` replay over fixed-size
static KV buffers — the PyTorch analog of the native MLX `.mlxfn` (one dispatch per
frame, ~4-5x real-time). It is **decoder-coupled and transformers-free** so both the
`transformers` modeling class and the lighter system class can use it without pulling
in the model wrapper.
"""

import warnings

import torch

# Classifier-free guidance scales above this can run away / collapse the output
# to silence under *sustained constant* conditioning over long runs (the native
# UI uses a 0-5 slider, default 2.4). We don't clamp — values pass through to
# match the native range — but we warn once so the caller knows the risk.
GUIDANCE_CFG_WARN = 3.5

# The most candidates `set_top_k` can choose between without a re-capture.
MAX_TOP_K = 256


def _warn_high_cfg(*scales):
    hi = [round(float(s), 2) for s in scales if float(s) > GUIDANCE_CFG_WARN]
    if hi:
        warnings.warn(
            f"CFG guidance scale(s) {hi} exceed ~{GUIDANCE_CFG_WARN}; sustained high "
            "guidance on constant conditioning can make the output run away / collapse "
            "to silence over long runs. (Changing notes/style during play avoids this.)",
            stacklevel=3)
        return True
    return False


class CudaGraphStreamer:
    """Single-dispatch CUDA-graph frame stepper over fixed-size static KV buffers.

    Warms `KEEP` frames eagerly to fill the temporal/cross KV to steady state,
    snapshots them into static buffers, then captures one frame (temporal + depth +
    sampler) with `torch.cuda.graph`. `.step()` replays it (one GPU dispatch) and
    returns the new frame tokens. Live steering writes into static input buffers
    (`source`, `cfg`, `temperature`, top-k) — the captured graph reads them, no
    re-capture. Conditioning changes ramp in via the windowed cross-KV (optional
    hard flush). `snapshot()`/`restore()` save and reload the model's memory.

    capture=False skips the graph and runs each frame eagerly. That is slow, but
    it runs anywhere, including the CPU, which is how the tests exercise it."""

    def __init__(self, decoder, source, decode_dtype, num_neg=0, cfg_scales=None,
                 temperature=1.1, top_k=50, seed=0, warmup=None, max_top_k=MAX_TOP_K,
                 capture=True):
        """decoder: a MultivariateDecoder (`model.depthformer.decoder` for the
        modeling class, `model.model.decoder` for the system class). `source` is the
        pre-encoded conditioning [B, Tc, enc] (B = 1 + num_neg); `decode_dtype` the
        compute dtype. Class-agnostic so both model wrappers can build it.
        max_top_k bounds what `set_top_k` accepts later."""
        dec = decoder
        c = dec.cfg
        self.dec = dec
        self.Q, self.CB, self.NR = c.num_codebooks, c.codebook_size, c.num_reserved_tokens
        # Past frames cached per layer. A step appends the current frame, so
        # attention sees temporal_max_past + 1 frames: the window the model
        # was trained with (sequence_layers' max_past_horizon excludes the
        # current step).
        self.KEEP = c.temporal_max_past
        self.num_neg = num_neg
        self.kmax = max(1, min(int(max_top_k), self.CB))
        dev, dt = source.device, decode_dtype
        B = source.shape[0]; self.B = B
        # live-steering static inputs
        self.source = source.clone()
        # Cross-attention K/V of the source, computed when the source changes
        # instead of on every frame.
        self.source_kv = [(k.clone(), v.clone()) for k, v in dec.source_kv(self.source)]
        self.cfg = (torch.zeros(0, device=dev, dtype=torch.float32) if not num_neg
                    else torch.tensor([float(s) for s in cfg_scales], device=dev, dtype=torch.float32))
        self.temp = torch.tensor(float(temperature), device=dev, dtype=torch.float32)
        # Index of the k-th largest logit among the top `kmax`, so top-k is live.
        self.kth = torch.zeros(1, 1, 1, device=dev, dtype=torch.long)
        self.set_top_k(top_k)
        torch.manual_seed(seed)
        # 1) prime to steady state (KV == KEEP on every layer)
        st = dec.init_streaming_f(B, dev, dt)
        K = self.KEEP
        for _ in range(K + 8 if warmup is None else warmup):
            to, ns, nc = dec.temporal_step_fn(st["prev"], st["self"], st["cross"], self.source,
                                              self.source_kv)
            st["self"] = [(k[:, -K:], v[:, -K:]) for k, v in ns]
            st["cross"] = [(k[:, -K:], v[:, -K:]) for k, v in nc]
            frame = self._depth_sample(to)
            st["prev"] = frame.expand(B, -1, -1)
        # 2) static KV + state buffers
        L = len(st["self"]); self.L = L
        self.SK = [st["self"][i][0].clone() for i in range(L)]; self.SV = [st["self"][i][1].clone() for i in range(L)]
        self.CK = [st["cross"][i][0].clone() for i in range(L)]; self.CV = [st["cross"][i][1].clone() for i in range(L)]
        self.prev = st["prev"].clone()
        self.out = torch.zeros(1, 1, self.Q, dtype=torch.long, device=dev)
        self.eager = not capture
        self.graph = None
        if self.eager:
            return
        # 3) capture (side-stream warmup is required before graph capture)
        s = torch.cuda.Stream(); s.wait_stream(torch.cuda.current_stream())
        with torch.cuda.stream(s):
            for _ in range(3):
                self._frame_static()
        torch.cuda.current_stream().wait_stream(s)
        self.graph = torch.cuda.CUDAGraph()
        with torch.cuda.graph(self.graph):
            self._frame_static()

    def _depth_sample(self, to):
        dec = self.dec; B = self.B; Q, CB, NR = self.Q, self.CB, self.NR
        dd = dec.cfg.depth
        z = torch.zeros(B, 0, dd.num_heads, dd.dim_per_head, device=to.device, dtype=to.dtype)
        dk = [(z, z) for _ in range(dd.num_layers)]
        di = to; toks = []
        for q in range(Q):
            ls, dk = dec.depth_step_fn(di, dk, codebook=q)    # [B,1,CB], codebook q only
            lo = NR + q * CB
            cond = ls[0:1]; comb = cond
            for i in range(self.num_neg):                     # classifier-free guidance combine
                comb = comb + self.cfg[i] * (cond - ls[i + 1:i + 2])
            ranked = torch.topk(comb, self.kmax, dim=-1).values   # descending
            kth = ranked.gather(-1, self.kth)                     # the k-th largest
            comb = torch.where(comb >= kth, comb, torch.full_like(comb, -1e9))
            u = torch.rand(1, 1, CB, device=to.device, dtype=torch.float32)   # graph-safe RNG
            g = -torch.log(-torch.log(u.clamp(1e-10, 1 - 1e-7)))
            tok = (comb + g * self.temp).argmax(-1) + lo
            toks.append(tok)
            di = dec.embed(tok.expand(B, -1))
        return torch.stack(toks, dim=-1)                       # [1,1,Q]

    def _frame_static(self):
        dec = self.dec; K = self.KEEP; L = self.L
        to, ns, nc = dec.temporal_step_fn(
            self.prev, [(self.SK[i], self.SV[i]) for i in range(L)],
            [(self.CK[i], self.CV[i]) for i in range(L)], self.source, self.source_kv)
        for i in range(L):
            self.SK[i].copy_(ns[i][0][:, -K:]); self.SV[i].copy_(ns[i][1][:, -K:])
            self.CK[i].copy_(nc[i][0][:, -K:]); self.CV[i].copy_(nc[i][1][:, -K:])
        frame = self._depth_sample(to)
        self.out.copy_(frame)
        self.prev.copy_(frame.expand(self.B, -1, -1))

    # ---- live steering (no re-capture) ----
    def set_cfg(self, scales):
        if self.num_neg:
            if not getattr(self, "_cfg_warned", False):
                self._cfg_warned = _warn_high_cfg(*scales)
            self.cfg.copy_(torch.tensor([float(s) for s in scales],
                                        device=self.cfg.device, dtype=torch.float32))

    def set_temperature(self, t):
        self.temp.fill_(float(t))

    def set_top_k(self, k):
        """Sample from the k most likely tokens, 1 <= k <= max_top_k."""
        self.top_k = max(1, min(int(k), self.kmax))
        self.kth.fill_(self.top_k - 1)

    def set_seed(self, seed):
        """Restart the sampler's random stream from `seed`. A graph replay reads
        the generator's current seed and offset, so this needs no re-capture."""
        if self.source.is_cuda:
            torch.cuda.manual_seed(int(seed))
        else:
            torch.manual_seed(int(seed))

    def set_source(self, source, flush=False):
        """Update conditioning. Ramps in via the windowed cross-KV; flush=True
        overwrites all cross-KV slots for an immediate change."""
        self.source.copy_(source if source.shape[0] == self.B else source.expand(self.B, -1, -1))
        for (k, v), (nk, nv) in zip(self.source_kv, self.dec.source_kv(self.source)):
            k.copy_(nk); v.copy_(nv)
        if flush:
            for i in range(self.L):
                sk, sv = self.source_kv[i]
                self.CK[i].copy_(sk[:, -self.KEEP:]); self.CV[i].copy_(sv[:, -self.KEEP:])

    # ---- memory ----
    def load_context(self, frames, source):
        """Continue from heard music. `frames` [1,N,Q] are unique codes, for
        example a clip run through the SpectroStream encoder. Fills the caches
        the graph reads with what the model would hold after hearing them,
        conditioned on `source` [1,1,enc], and makes frames[:, -1] the next
        frame it embeds. One batched pass, no re-capture. The live source is
        unchanged; `set_source` steers the continuation. N must exceed KEEP."""
        if self.num_neg:
            raise NotImplementedError("load_context does not support guidance batches")
        n = frames.shape[1]
        if n <= self.KEEP:
            raise ValueError(f"a context needs more than {self.KEEP} frames, got {n}")
        frames = frames.to(device=self.prev.device, dtype=torch.long)
        self_kv, cross_kv = self.dec.context_kv(frames, source.to(self.source.dtype), self.KEEP)
        for i in range(self.L):
            self.SK[i].copy_(self_kv[i][0]); self.SV[i].copy_(self_kv[i][1])
            self.CK[i].copy_(cross_kv[i][0]); self.CV[i].copy_(cross_kv[i][1])
        self.prev.copy_(frames[:, -1:])

    def snapshot(self):
        """Copy the model's memory: temporal self/cross KV and the last frame.
        About 13 MB for the base model."""
        return {
            "self": [(k.clone(), v.clone()) for k, v in zip(self.SK, self.SV)],
            "cross": [(k.clone(), v.clone()) for k, v in zip(self.CK, self.CV)],
            "prev": self.prev.clone(),
        }

    def restore(self, memory):
        """Load a `snapshot()` back into the buffers the graph reads. The next
        frame continues from that moment. Raises ValueError if it came from a
        streamer of a different shape, before changing anything."""
        pairs = [(self.SK, self.SV, memory["self"]), (self.CK, self.CV, memory["cross"])]
        for keys, values, saved in pairs:
            if len(saved) != self.L:
                raise ValueError("memory snapshot has a different number of layers")
            for key, value, (saved_key, saved_value) in zip(keys, values, saved):
                if saved_key.shape != key.shape or saved_value.shape != value.shape:
                    raise ValueError("memory snapshot does not match this streamer")
        if memory["prev"].shape != self.prev.shape:
            raise ValueError("memory snapshot does not match this streamer")
        for keys, values, saved in pairs:
            for key, value, (saved_key, saved_value) in zip(keys, values, saved):
                key.copy_(saved_key); value.copy_(saved_value)
        self.prev.copy_(memory["prev"])

    def step(self):
        """Advance one frame (single CUDA-graph dispatch). Returns tokens [1,1,Q]."""
        if self.eager:
            self._frame_static()
        elif self.graph is None:
            raise RuntimeError("the streamer is closed")
        else:
            self.graph.replay()
        return self.out.clone()

    def close(self):
        """Free the captured CUDA graph + its private memory pool. Idempotent;
        call at session end (the WS worker should). Safe during interpreter
        shutdown — swallows teardown-ordering errors."""
        self.eager = False
        g = getattr(self, "graph", None)
        if g is not None:
            try:
                g.reset()
            except Exception:
                pass
            self.graph = None

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass


__all__ = ["CudaGraphStreamer", "GUIDANCE_CFG_WARN", "MAX_TOP_K"]
