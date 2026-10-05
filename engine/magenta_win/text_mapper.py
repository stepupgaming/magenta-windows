"""PyTorch port of Magenta's MusicCoCa text mapper.

Upstream Magenta RealTime 2 passes each text prompt's MusicCoCa embedding
through mapper.tflite (magenta_rt/musiccoca.py, ``use_mapper=True``, and
``apply_mapper`` in core/src/mlx_engine.cpp) before prompts are blended. The
mapper moves text embeddings toward the audio embeddings the model was
trained on. Audio prompts are already there and skip it.

The TFLite graph is a one-step sampler around a small transformer:

    noise -> Linear(768, 3072) -> 12 tokens of 256
    8 layers, each conditioned on concat(prefix, prefix, text) (1024 wide):
        RMSNorm -> (1 + scale) * x + shift -> attention -> residual
            attention: 8 heads of 64, RoPE, a learned sink key and value,
            logits soft-capped at 30, the sink logit uses the unscaled query
        RMSNorm -> (1 + scale) * x + shift -> Linear -> tanh GELU -> Linear -> residual
    Linear(3072, 768) -> x0 prediction
    noise + (x0 - noise), L2-normalized

The noise is numpy's RandomState(0).randn(768), which is what upstream feeds
it, so the mapping is deterministic. Weights are read straight from the
TFLite file, and the graph is checked against this architecture on load.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from torch import nn

from magenta_win.tflite_reader import Subgraph, TFLiteModel

EMBEDDING = 768
TOKENS = 12
WIDTH = 256
HEADS = 8
HEAD_DIM = 64
HIDDEN = 1024
CONDITION = 1024
PREFIX = 128
LAYERS = 8
SOFT_CAP = 30.0
NORM_EPS = 1e-6
NOISE_SEED = 0

# TFLite builtin operator codes this port checks for.
_ADD = 0
_CONCATENATION = 2
_FULLY_CONNECTED = 9
_MUL = 18
_RESHAPE = 22
_SUB = 41
_WHILE = 119
_LESS = 58
_MAIN_OPS = (
    _RESHAPE,
    _CONCATENATION,
    _FULLY_CONNECTED,
    _RESHAPE,
    _WHILE,
    _RESHAPE,
    _FULLY_CONNECTED,
    _SUB,
    _MUL,
    _ADD,
    _RESHAPE,
)

# Stacked per-layer weights in the loop body, by their jax2tf argument number.
_LAYER_ARGS = {
    2: ("attn_mod_bias", (LAYERS, 2, WIDTH)),
    3: ("attn_mod_weight", (LAYERS, CONDITION, 2, WIDTH)),
    4: ("attn_norm", (LAYERS, WIDTH)),
    5: ("qkv", (LAYERS, WIDTH, 3, HEADS, HEAD_DIM)),
    6: ("sink_key", (LAYERS, 1, HEADS, HEAD_DIM)),
    7: ("sink_value", (LAYERS, 1, HEADS, HEAD_DIM)),
    8: ("attn_out", (LAYERS, WIDTH, HEADS, HEAD_DIM)),
    9: ("ffn_mod_bias", (LAYERS, 2, WIDTH)),
    10: ("ffn_mod_weight", (LAYERS, CONDITION, 2, WIDTH)),
    11: ("ffn_up_bias", (LAYERS, HIDDEN)),
    12: ("ffn_up", (LAYERS, WIDTH, HIDDEN)),
    13: ("ffn_down_bias", (LAYERS, WIDTH)),
    14: ("ffn_down", (LAYERS, HIDDEN, WIDTH)),
    15: ("ffn_norm", (LAYERS, WIDTH)),
}
_ARG_NAME = re.compile(r"^jax2tf_arg_(\d+)/")


class MapperFormatError(ValueError):
    """The TFLite file is not the mapper this port reproduces."""


@dataclass(frozen=True)
class MapperWeights:
    """Every constant the mapper needs, as float32 numpy arrays."""

    prefix: np.ndarray
    input_weight: np.ndarray
    input_bias: np.ndarray
    output_weight: np.ndarray
    output_bias: np.ndarray
    rope_frequencies: np.ndarray
    layers: dict[str, np.ndarray]


def mapper_noise() -> np.ndarray:
    """The fixed Gaussian input upstream uses: RandomState(0).randn(768)."""
    return np.random.RandomState(NOISE_SEED).randn(EMBEDDING).astype(np.float32)


def _expect(condition: bool, message: str) -> None:
    if not condition:
        raise MapperFormatError(message)


def _constant(model: TFLiteModel, graph: Subgraph, index: int, shape: Sequence[int]) -> np.ndarray:
    value = model.constant(graph.tensors[index])
    _expect(value is not None, f"tensor {graph.tensors[index].name!r} should be a constant")
    assert value is not None
    _expect(tuple(value.shape) == tuple(shape), f"tensor {graph.tensors[index].name!r} has shape {value.shape}, expected {tuple(shape)}")
    _expect(value.dtype == np.float32, f"tensor {graph.tensors[index].name!r} should be float32")
    return value


def read_mapper_weights(path: Path) -> MapperWeights:
    """Pull the mapper's weights out of mapper.tflite, checking its structure."""
    model = TFLiteModel.read(path)
    main = model.subgraphs[0]
    codes = tuple(operator.code for operator in main.operators)
    _expect(codes == _MAIN_OPS, f"unexpected main graph operators {codes}")
    _expect(len(main.inputs) == 2 and len(main.outputs) == 1, "the mapper takes (embedding, noise) and returns one tensor")
    embedding_input, noise_input = main.inputs
    concat, project_in, loop, project_out = (main.operators[index] for index in (1, 2, 4, 6))

    _expect(concat.inputs[0] == concat.inputs[1], "the conditioning prefix should repeat")
    prefix = _constant(model, main, concat.inputs[0], (1, 1, PREFIX))
    _expect(project_in.inputs[0] == noise_input, "the input projection should read the noise")
    input_weight = _constant(model, main, project_in.inputs[1], (TOKENS * WIDTH, EMBEDDING))
    input_bias = _constant(model, main, project_in.inputs[2], (TOKENS * WIDTH,))
    output_weight = _constant(model, main, project_out.inputs[1], (EMBEDDING, TOKENS * WIDTH))
    output_bias = _constant(model, main, project_out.inputs[2], (EMBEDDING,))
    _expect(main.operators[0].inputs[0] == embedding_input, "the embedding should become the condition")

    _expect(loop.options is not None, "the layer loop has no options")
    assert loop.options is not None
    cond_index = int(loop.options.scalar(0, "<i"))
    body_index = int(loop.options.scalar(1, "<i"))
    _expect(0 < body_index < len(model.subgraphs), "the layer loop points at a missing body")
    _expect(0 < cond_index < len(model.subgraphs), "the layer loop points at a missing condition")
    condition = model.subgraphs[cond_index]
    _expect([operator.code for operator in condition.operators] == [_LESS], "the loop condition should be a single LESS")
    limit = model.constant(condition.tensors[condition.operators[0].inputs[1]])
    _expect(limit is not None and int(limit) == LAYERS, f"the loop should run {LAYERS} layers")

    body = model.subgraphs[body_index]
    layers: dict[str, np.ndarray] = {}
    frequencies: np.ndarray | None = None
    for tensor in body.tensors:
        match = _ARG_NAME.match(tensor.name)
        if match and int(match.group(1)) in _LAYER_ARGS:
            name, shape = _LAYER_ARGS[int(match.group(1))]
            _expect(name not in layers, f"{name} appears twice in the loop body")
            layers[name] = _constant(model, body, tensor.index, shape)
        elif tensor.shape == (1, 1, 1, HEAD_DIM // 2) and tensor.dtype == np.float32:
            frequencies = _constant(model, body, tensor.index, tensor.shape).reshape(-1)
    missing = sorted({name for name, _ in _LAYER_ARGS.values()} - layers.keys())
    _expect(not missing, f"the loop body is missing {missing}")
    _expect(frequencies is not None, "the loop body has no rotary frequencies")
    assert frequencies is not None
    return MapperWeights(
        prefix=prefix.reshape(PREFIX),
        input_weight=input_weight,
        input_bias=input_bias,
        output_weight=output_weight,
        output_bias=output_bias,
        rope_frequencies=frequencies,
        layers=layers,
    )


def _soft_cap(logits: torch.Tensor) -> torch.Tensor:
    return torch.tanh(logits * (1.0 / SOFT_CAP)) * SOFT_CAP


def _rms_norm(x: torch.Tensor, weight: torch.Tensor) -> torch.Tensor:
    mean_square = (x * x).sum(-1, keepdim=True) * (1.0 / WIDTH) + NORM_EPS
    return x * torch.rsqrt(mean_square) * weight


def _rotate(x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
    half = HEAD_DIM // 2
    first, second = x[..., :half], x[..., half:]
    return torch.cat((first * cos - second * sin, second * cos + first * sin), dim=-1)


class TextMapper(nn.Module):
    """Maps MusicCoCa text embeddings toward the audio embedding space."""

    def __init__(self, weights: MapperWeights) -> None:
        super().__init__()
        self.register_buffer("noise", torch.from_numpy(mapper_noise()))
        self.register_buffer("prefix", torch.from_numpy(weights.prefix))
        self.register_buffer("input_weight", torch.from_numpy(weights.input_weight))
        self.register_buffer("input_bias", torch.from_numpy(weights.input_bias))
        self.register_buffer("output_weight", torch.from_numpy(weights.output_weight))
        self.register_buffer("output_bias", torch.from_numpy(weights.output_bias))
        angles = torch.arange(TOKENS, dtype=torch.float32)[:, None] * torch.from_numpy(weights.rope_frequencies)[None, :]
        self.register_buffer("rope_cos", torch.cos(angles)[None, :, None, :])
        self.register_buffer("rope_sin", torch.sin(angles)[None, :, None, :])
        for name, value in weights.layers.items():
            self.register_buffer(name, torch.from_numpy(value))

    @classmethod
    def from_file(cls, path: Path) -> TextMapper:
        return cls(read_mapper_weights(path)).eval()

    def _modulation(self, condition: torch.Tensor, weight: torch.Tensor, bias: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        batch = condition.shape[0]
        mod = (condition @ weight.reshape(CONDITION, 2 * WIDTH)).reshape(batch, 1, 2, WIDTH) + bias
        return mod[:, :, 0] + 1.0, mod[:, :, 1]

    def _attention(self, x: torch.Tensor, condition: torch.Tensor, layer: int) -> torch.Tensor:
        batch = x.shape[0]
        scale, shift = self._modulation(condition, self.attn_mod_weight[layer], self.attn_mod_bias[layer])
        h = _rms_norm(x, self.attn_norm[layer]) * scale + shift
        qkv = (h @ self.qkv[layer].reshape(WIDTH, 3 * HEADS * HEAD_DIM)).reshape(batch, TOKENS, 3, HEADS, HEAD_DIM)
        query = _rotate(qkv[:, :, 0], self.rope_cos, self.rope_sin)
        key = _rotate(qkv[:, :, 1], self.rope_cos, self.rope_sin)
        value = qkv[:, :, 2]
        # The learned sink competes with every token. Upstream scores it
        # against the query before the 1/sqrt(d) scale, so this does too.
        sink = torch.einsum("hd,bthd->bht", self.sink_key[layer, 0], query)[..., None]
        scores = (query * HEAD_DIM**-0.5).transpose(1, 2) @ key.permute(0, 2, 3, 1)
        weights = torch.softmax(torch.cat((_soft_cap(sink), _soft_cap(scores)), dim=-1), dim=-1)
        values = torch.cat((self.sink_value[layer][None].expand(batch, -1, -1, -1), value), dim=1)
        mixed = (weights @ values.transpose(1, 2)).transpose(1, 2).reshape(batch, TOKENS, HEADS * HEAD_DIM)
        return x + mixed @ self.attn_out[layer].reshape(WIDTH, HEADS * HEAD_DIM).T

    def _feed_forward(self, x: torch.Tensor, condition: torch.Tensor, layer: int) -> torch.Tensor:
        scale, shift = self._modulation(condition, self.ffn_mod_weight[layer], self.ffn_mod_bias[layer])
        h = _rms_norm(x, self.ffn_norm[layer]) * scale + shift
        h = nn.functional.gelu(h @ self.ffn_up[layer] + self.ffn_up_bias[layer], approximate="tanh")
        return x + (h @ self.ffn_down[layer] + self.ffn_down_bias[layer])

    @torch.no_grad()
    def forward(self, embedding: torch.Tensor) -> torch.Tensor:
        """Map one [768] or a batch [n, 768] of text embeddings. Outputs are unit length."""
        single = embedding.dim() == 1
        text = embedding.reshape(-1, EMBEDDING).to(self.noise.device, torch.float32)
        batch = text.shape[0]
        prefix = self.prefix.expand(batch, PREFIX)
        condition = torch.cat((prefix, prefix, text), dim=-1)[:, None, :]
        x = (self.noise @ self.input_weight.T + self.input_bias).expand(batch, -1).reshape(batch, TOKENS, WIDTH)
        for layer in range(LAYERS):
            x = self._attention(x, condition, layer)
            x = self._feed_forward(x, condition, layer)
        predicted = x.reshape(batch, TOKENS * WIDTH) @ self.output_weight.T + self.output_bias
        # One sampler step from the noise to the prediction, written the way
        # the graph computes it.
        mapped = self.noise + (self.noise - predicted) * -1.0
        mapped = mapped / torch.linalg.vector_norm(mapped, dim=-1, keepdim=True)
        return mapped[0] if single else mapped
