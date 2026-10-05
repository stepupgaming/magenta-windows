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

"""PyTorch port of the sequence_layers primitives used by Magenta RealTime 2.

Layouts mirror the JAX/Linen checkpoint exactly so weight loading is a direct
copy (no transposes for kernels stored as [in, ...]). Reductions for norms and
softmax run in fp32 to match the reference.
"""
import math
from typing import Optional

import torch
import torch.nn as nn
import torch.nn.functional as F

_R_SOFTPLUS_0 = 1.442695041  # 1 / softplus(0); from sequence_layers attention.


def gelu_approx(x: torch.Tensor) -> torch.Tensor:
    """tanh-approximation GELU, matching mlx.nn.gelu_approx / jax gelu(approximate=True)."""
    return F.gelu(x, approximate="tanh")


class JaxLinear(nn.Module):
    """Linen Dense: y = x @ kernel + bias, kernel stored as [in, out]."""

    def __init__(self, in_features, out_features, use_bias=True, activation=None):
        super().__init__()
        self.kernel = nn.Parameter(torch.zeros(in_features, out_features))
        self.bias = nn.Parameter(torch.zeros(out_features)) if use_bias else None
        self.activation = activation

    def forward(self, x):
        y = torch.matmul(x, self.kernel.to(x.dtype))
        if self.bias is not None:
            y = y + self.bias.to(x.dtype)
        if self.activation is not None:
            y = self.activation(y)
        return y


class RMSNorm(nn.Module):
    """RMS norm with learned scale; reduction in fp32 (eps 1e-6).

    `F.rms_norm` upcasts reduced-precision input to fp32, normalizes, and rounds
    back to the input dtype in one fused kernel on CUDA, the same steps the
    reference spells out as separate ops. The scale stays a separate multiply in
    the input dtype, so rounding happens where the reference rounds."""

    def __init__(self, dim, eps=1e-6, use_scale=True):
        super().__init__()
        self.eps = eps
        self.normalized_shape = (dim,)
        self.scale = nn.Parameter(torch.ones(dim)) if use_scale else None

    def forward(self, x):
        v = F.rms_norm(x, self.normalized_shape, eps=self.eps)
        if self.scale is not None:
            v = v * self.scale.to(x.dtype)
        return v


class LayerNorm(nn.Module):
    """LayerNorm with scale+bias; reduction in fp32 (eps 1e-6). Fused like RMSNorm."""

    def __init__(self, dim, eps=1e-6):
        super().__init__()
        self.eps = eps
        self.normalized_shape = (dim,)
        self.scale = nn.Parameter(torch.ones(dim))
        self.bias = nn.Parameter(torch.zeros(dim))

    def forward(self, x):
        v = F.layer_norm(x, self.normalized_shape, eps=self.eps)
        return v * self.scale.to(x.dtype) + self.bias.to(x.dtype)


def _query_scale_vector(per_dim_scale, units_per_head, dtype):
    qscale = 1.0 / math.sqrt(units_per_head)
    if per_dim_scale is not None:
        scale = _R_SOFTPLUS_0 * qscale
        softplus = F.softplus(per_dim_scale.to(dtype))
        return scale * softplus
    return torch.tensor(qscale, dtype=dtype, device=per_dim_scale.device if per_dim_scale is not None else None)


class _QueryScale:
    """Caches the per-dim query scale, a fixed function of `per_dim_scale`.

    Recomputing softplus on every attention call costs kernels per layer per
    frame for a value that only changes when the weights do. The cache key holds
    the parameter's version counter and storage, so loading or moving weights
    recomputes it."""

    _query_scale_cache = None

    def query_scale(self, dtype):
        p = self.per_dim_scale
        if p is None or torch.compiler.is_compiling():  # export and compile trace the plain math
            return _query_scale_vector(p, self.units_per_head, dtype)
        key = (dtype, p.dtype, p.device, p.data_ptr(), p._version)
        cached = self._query_scale_cache
        if cached is None or cached[0] != key:
            with torch.no_grad():
                cached = (key, _query_scale_vector(p, self.units_per_head, dtype))
            self._query_scale_cache = cached
        return cached[1]


def dot_product_attention(q, k, v, per_dim_scale, sink_k, sink_v, mask, query_scale=None):
    """q,k,v: [b, t, nh, uph]; mask: [b, 1, tq, tkv] bool (True=attend) or None.

    sink_k/sink_v: [num_sink, nh, uph] or None. Sink logits use *unscaled* queries.
    query_scale: the precomputed `_query_scale_vector`, when the caller caches it.
    Returns context [b, tq, nh, uph].
    """
    qh = q.transpose(1, 2)  # [b, nh, tq, uph]
    kh = k.transpose(1, 2)
    vh = v.transpose(1, 2)

    scale_vec = query_scale  # [uph]
    if scale_vec is None:
        scale_vec = _query_scale_vector(per_dim_scale, q.shape[-1], qh.dtype)

    if sink_k is not None:
        # [b, nh, tq, num_sink] using unscaled queries.
        sink_logits = torch.einsum("bhqd,shd->bhqs", qh, sink_k.to(qh.dtype))

    qs = qh * scale_vec
    logits = torch.matmul(qs, kh.transpose(-1, -2))  # [b, nh, tq, tkv]

    if sink_k is not None:
        logits = torch.cat([sink_logits, logits], dim=-1)

    if mask is not None:
        # Export-clean: scalar masked_fill (no -1e9 constant tensor). Sink
        # columns (first ns) are always valid, so mask only the kv columns
        # (avoids building a constant `ones` sink mask).
        ns = sink_k.shape[0] if sink_k is not None else 0
        if ns:
            kv = logits[..., ns:].masked_fill(~mask, -1e9)
            logits = torch.cat([logits[..., :ns], kv], dim=-1)
        else:
            logits = logits.masked_fill(~mask, -1e9)

    weights = torch.softmax(logits.float(), dim=-1).to(vh.dtype)

    if sink_v is not None:
        b = vh.shape[0]
        sink_vb = sink_v.to(vh.dtype).permute(1, 0, 2).unsqueeze(0).expand(b, -1, -1, -1)  # [b,nh,num_sink,uph]
        vh = torch.cat([sink_vb, vh], dim=2)

    ctx = torch.matmul(weights, vh)  # [b, nh, tq, uph]
    return ctx.transpose(1, 2)  # [b, tq, nh, uph]


class AttnProjection(_QueryScale, nn.Module):
    """q/k/v/out projections stored as [in, nh, uph] (Linen attention kernels)."""

    def __init__(self, in_dim, num_heads, units_per_head, has_sinks=False, has_per_dim_scale=True):
        super().__init__()
        nh, uph = num_heads, units_per_head
        self.num_heads, self.units_per_head = nh, uph
        self.query_projection_kernel = nn.Parameter(torch.zeros(in_dim, nh, uph))
        self.key_projection_kernel = nn.Parameter(torch.zeros(in_dim, nh, uph))
        self.value_projection_kernel = nn.Parameter(torch.zeros(in_dim, nh, uph))
        self.per_dim_scale = nn.Parameter(torch.zeros(uph)) if has_per_dim_scale else None
        if has_sinks:
            self.sink_key_embeddings = nn.Parameter(torch.zeros(1, nh, uph))
            self.sink_value_embeddings = nn.Parameter(torch.zeros(1, nh, uph))
        else:
            self.sink_key_embeddings = None
            self.sink_value_embeddings = None

    def project(self, x, kernel):
        return torch.einsum("btd,dnh->btnh", x, kernel.to(x.dtype))


def banded_causal_mask(tq, tkv, past, future, device):
    """[1,1,tq,tkv] bool. Query i (global pos offset+i) attends key j with
    j in [i-past, i+future]. Here tq aligns to the last tq positions of tkv."""
    offset = tkv - tq
    row = torch.arange(tq, device=device)[:, None] + offset
    col = torch.arange(tkv, device=device)[None, :]
    m = (col <= row + future) & (col >= row - past)
    return m.view(1, 1, tq, tkv)


class SelfAttention(nn.Module):
    def __init__(self, model_dim, num_heads, units_per_head, max_past_horizon,
                 num_sinks=0, eps=1e-6):
        super().__init__()
        self.pre_norm = RMSNorm(model_dim, eps)
        self.post_norm = RMSNorm(model_dim, eps)
        self.attention = AttnProjection(model_dim, num_heads, units_per_head,
                                        has_sinks=num_sinks > 0)
        self.output_projection_kernel = nn.Parameter(torch.zeros(model_dim, num_heads, units_per_head))
        self.max_past_horizon = max_past_horizon
        self.num_heads = num_heads
        self.units_per_head = units_per_head

    def _branch(self, x):
        h = self.pre_norm(x)
        a = self.attention
        q = a.project(h, a.query_projection_kernel)
        k = a.project(h, a.key_projection_kernel)
        v = a.project(h, a.value_projection_kernel)
        t = x.shape[1]
        mask = banded_causal_mask(t, t, self.max_past_horizon, 0, x.device)
        ctx = dot_product_attention(q, k, v, a.per_dim_scale,
                                    a.sink_key_embeddings, a.sink_value_embeddings, mask,
                                    query_scale=a.query_scale(q.dtype))
        out = torch.einsum("btnh,dnh->btd", ctx, self.output_projection_kernel.to(ctx.dtype))
        return self.post_norm(out)

    def forward(self, x):
        return x + self._branch(x)

    # ---- streaming step with KV cache ----
    def init_state(self, batch, device, dtype):
        return {"k": None, "v": None}  # lazily grown buffers [b, t, nh, uph]

    def step(self, x, state):
        # x: [b, 1, d]
        h = self.pre_norm(x)
        a = self.attention
        q = a.project(h, a.query_projection_kernel)
        k = a.project(h, a.key_projection_kernel)
        v = a.project(h, a.value_projection_kernel)
        if state["k"] is None:
            kk, vv = k, v
        else:
            kk = torch.cat([state["k"], k], dim=1)
            vv = torch.cat([state["v"], v], dim=1)
        # keep only the window we can attend to (past horizon + current).
        keep = self.max_past_horizon + 1
        if kk.shape[1] > keep:
            kk = kk[:, -keep:]
            vv = vv[:, -keep:]
        state["k"], state["v"] = kk, vv
        # The cache holds only the last `keep` keys, all valid past keys within
        # the window for the single newest query -> no mask needed.
        ctx = dot_product_attention(q, kk, vv, a.per_dim_scale,
                                    a.sink_key_embeddings, a.sink_value_embeddings, None,
                                    query_scale=a.query_scale(q.dtype))
        out = torch.einsum("btnh,dnh->btd", ctx, self.output_projection_kernel.to(ctx.dtype))
        return x + self.post_norm(out)

    def step_fn(self, x, k_prev, v_prev):
        """Functional, export-clean single-frame step. k_prev/v_prev: [b,T,nh,uph]
        (T may be 0). Returns (out[b,1,d], new_k, new_v) — full, untrimmed KV."""
        h = self.pre_norm(x)
        a = self.attention
        q = a.project(h, a.query_projection_kernel)
        k = torch.cat([k_prev, a.project(h, a.key_projection_kernel)], dim=1)
        v = torch.cat([v_prev, a.project(h, a.value_projection_kernel)], dim=1)
        ctx = dot_product_attention(q, k, v, a.per_dim_scale,
                                    a.sink_key_embeddings, a.sink_value_embeddings, None,
                                    query_scale=a.query_scale(q.dtype))
        out = torch.einsum("btnh,dnh->btd", ctx, self.output_projection_kernel.to(ctx.dtype))
        return x + self.post_norm(out), k, v


class CrossAttention(nn.Module):
    """Streaming cross-attention to an encoded source sequence."""

    def __init__(self, model_dim, source_dim, num_heads, units_per_head,
                 max_past_horizon, num_sinks=0, eps=1e-6):
        super().__init__()
        self.pre_norm = RMSNorm(model_dim, eps)
        self.post_norm = RMSNorm(model_dim, eps)
        # query from decoder (model_dim), key/value from source (source_dim).
        self.attention = _CrossProj(model_dim, source_dim, num_heads, units_per_head,
                                    has_sinks=num_sinks > 0)
        self.output_projection_kernel = nn.Parameter(torch.zeros(model_dim, num_heads, units_per_head))
        self.max_past_horizon = max_past_horizon
        self.num_heads = num_heads
        self.units_per_head = units_per_head

    def _kv(self, source):
        a = self.attention
        k = torch.einsum("btd,dnh->btnh", source, a.key_projection_kernel.to(source.dtype))
        v = torch.einsum("btd,dnh->btnh", source, a.value_projection_kernel.to(source.dtype))
        return k, v

    def _branch(self, x, source):
        h = self.pre_norm(x)
        a = self.attention
        q = torch.einsum("btd,dnh->btnh", h, a.query_projection_kernel.to(h.dtype))
        k, v = self._kv(source)
        tq, tkv = x.shape[1], source.shape[1]
        # query at decoder time i attends source positions within past horizon, causal.
        mask = banded_causal_mask(tq, tkv, self.max_past_horizon, 0, x.device)
        ctx = dot_product_attention(q, k, v, a.per_dim_scale,
                                    a.sink_key_embeddings, a.sink_value_embeddings, mask,
                                    query_scale=a.query_scale(q.dtype))
        out = torch.einsum("btnh,dnh->btd", ctx, self.output_projection_kernel.to(ctx.dtype))
        return self.post_norm(out)

    def forward(self, x, source):
        return x + self._branch(x, source)

    def attend_fn(self, x, k, v):
        """Functional cross-attention given precomputed source KV [b,T,nh,uph]."""
        h = self.pre_norm(x)
        a = self.attention
        q = torch.einsum("btd,dnh->btnh", h, a.query_projection_kernel.to(h.dtype))
        ctx = dot_product_attention(q, k, v, a.per_dim_scale,
                                    a.sink_key_embeddings, a.sink_value_embeddings, None,
                                    query_scale=a.query_scale(q.dtype))
        out = torch.einsum("btnh,dnh->btd", ctx, self.output_projection_kernel.to(ctx.dtype))
        return x + self.post_norm(out)

    def step(self, x, source_kv):
        # x: [b,1,d]; source_kv: (k,v) accumulated [b, tkv, nh, uph]
        h = self.pre_norm(x)
        a = self.attention
        q = torch.einsum("btd,dnh->btnh", h, a.query_projection_kernel.to(h.dtype))
        k, v = source_kv
        tkv = k.shape[1]
        keep = self.max_past_horizon + 1
        if tkv > keep:
            k = k[:, -keep:]
            v = v[:, -keep:]
        ctx = dot_product_attention(q, k, v, a.per_dim_scale,
                                    a.sink_key_embeddings, a.sink_value_embeddings, None,
                                    query_scale=a.query_scale(q.dtype))
        out = torch.einsum("btnh,dnh->btd", ctx, self.output_projection_kernel.to(ctx.dtype))
        return x + self.post_norm(out)


class _CrossProj(_QueryScale, nn.Module):
    def __init__(self, q_dim, kv_dim, num_heads, units_per_head, has_sinks=False):
        super().__init__()
        nh, uph = num_heads, units_per_head
        self.units_per_head = uph
        self.query_projection_kernel = nn.Parameter(torch.zeros(q_dim, nh, uph))
        self.key_projection_kernel = nn.Parameter(torch.zeros(kv_dim, nh, uph))
        self.value_projection_kernel = nn.Parameter(torch.zeros(kv_dim, nh, uph))
        self.per_dim_scale = nn.Parameter(torch.zeros(uph))
        if has_sinks:
            self.sink_key_embeddings = nn.Parameter(torch.zeros(1, nh, uph))
            self.sink_value_embeddings = nn.Parameter(torch.zeros(1, nh, uph))
        else:
            self.sink_key_embeddings = None
            self.sink_value_embeddings = None


class FFN(nn.Module):
    def __init__(self, model_dim, hidden_dim, eps=1e-6):
        super().__init__()
        self.pre_norm = RMSNorm(model_dim, eps)
        self.post_norm = RMSNorm(model_dim, eps)
        self.ffn_layer1 = JaxLinear(model_dim, hidden_dim, use_bias=True, activation=gelu_approx)
        self.ffn_layer2 = JaxLinear(hidden_dim, model_dim, use_bias=True)

    def _branch(self, x):
        h = self.pre_norm(x)
        h = self.ffn_layer1(h)
        h = self.ffn_layer2(h)
        return self.post_norm(h)

    def forward(self, x):
        return x + self._branch(x)
