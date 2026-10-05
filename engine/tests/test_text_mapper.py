from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pytest
import torch
from tflite_builder import OperatorSpec, SubgraphSpec, TensorSpec, build_model

from magenta_win import text_mapper as tm
from magenta_win.cache_path import weight_cache
from magenta_win.text_mapper_file import find_mapper, is_genuine

# Google's mapper.tflite (via ai-edge-litert) maps these unit vectors to
# outputs that start with these values and project onto PROBE as shown.
GOLDEN = {
    3: ([0.0247532, 0.0082092, 0.0193007, -0.0520536, -0.0137576, 0.0135072], 2.002845),
    5: ([0.0249566, 0.0074678, 0.0187493, -0.0526023, -0.0132531, 0.0139928], 1.999511),
}
PROBE_SEED = 11


def unit(seed: int) -> np.ndarray:
    vector = np.random.RandomState(seed).randn(tm.EMBEDDING).astype(np.float32)
    return vector / np.linalg.norm(vector)


def random_weights(seed: int = 0) -> tm.MapperWeights:
    rng = np.random.default_rng(seed)

    def normal(*shape: int, scale: float = 0.05) -> np.ndarray:
        return (rng.standard_normal(shape) * scale).astype(np.float32)

    layers = {name: normal(*shape) for name, shape in tm._LAYER_ARGS.values()}
    layers["attn_norm"] += 1.0
    layers["ffn_norm"] += 1.0
    return tm.MapperWeights(
        prefix=normal(tm.PREFIX, scale=1.0),
        input_weight=normal(tm.TOKENS * tm.WIDTH, tm.EMBEDDING),
        input_bias=normal(tm.TOKENS * tm.WIDTH),
        output_weight=normal(tm.EMBEDDING, tm.TOKENS * tm.WIDTH),
        output_bias=normal(tm.EMBEDDING),
        rope_frequencies=(10_000.0 ** (-np.arange(32) / 32)).astype(np.float32),
        layers=layers,
    )


def literal_mapper(weights: tm.MapperWeights, text: np.ndarray) -> np.ndarray:
    """mapper.tflite transcribed op by op in numpy, batch of one, no reuse of the port."""
    f32 = np.float32
    noise = tm.mapper_noise()[None]
    prefix = weights.prefix.reshape(1, 1, 128)
    condition = np.concatenate([prefix, prefix, text.reshape(1, 1, 768)], axis=2)
    x = (noise @ weights.input_weight.T + weights.input_bias).reshape(1, 12, 256)
    positions = np.maximum(np.cumsum(np.ones((1, 12), np.int32), axis=1) - 1, 0).astype(f32)
    angles = positions.reshape(1, 12, 1, 1) * weights.rope_frequencies.reshape(1, 1, 1, 32)
    sin, cos = np.sin(angles), np.cos(angles)

    def rope(t: np.ndarray) -> np.ndarray:
        first, second = t[..., :32], t[..., 32:]
        return np.concatenate([first * cos - second * sin, second * cos + first * sin], axis=3)

    def norm(t: np.ndarray, scale: np.ndarray) -> np.ndarray:
        inverse = 1.0 / np.sqrt((t * t).sum(axis=2) * f32(1 / 256) + f32(1e-6))
        return t * inverse.reshape(1, 12, 1) * scale

    def modulate(t: np.ndarray, weight: np.ndarray, bias: np.ndarray) -> np.ndarray:
        mod = (condition @ weight.reshape(1024, 512)).reshape(1, 1, 2, 256) + bias.reshape(1, 2, 256)
        return t * (mod[:, :, 0] + f32(1.0)) + mod[:, :, 1]

    def cap(t: np.ndarray) -> np.ndarray:
        return np.tanh(t * f32(1 / 30)) * f32(30)

    for index in range(8):
        layer = {name: value[index] for name, value in weights.layers.items()}
        h = modulate(norm(x, layer["attn_norm"]), layer["attn_mod_weight"], layer["attn_mod_bias"])
        qkv = (h @ layer["qkv"].reshape(256, 1536)).reshape(1, 12, 3, 8, 64)
        query, key, value = rope(qkv[:, :, 0]), rope(qkv[:, :, 1]), qkv[:, :, 2]
        sink = layer["sink_key"].reshape(8, 1, 64) @ query.transpose(2, 3, 0, 1).reshape(8, 64, 12)
        sink = cap(sink).reshape(1, 8, 12, 1)
        scores = cap((query * f32(0.125)).transpose(0, 2, 1, 3) @ key.transpose(0, 2, 3, 1))
        logits = np.concatenate([sink, scores], axis=3)
        probs = np.exp(logits - logits.max(axis=3, keepdims=True))
        probs /= probs.sum(axis=3, keepdims=True)
        values = np.concatenate([layer["sink_value"].reshape(1, 1, 8, 64), value], axis=1).transpose(0, 2, 3, 1)
        mixed = (values @ probs.transpose(0, 1, 3, 2)).transpose(0, 3, 1, 2).reshape(1, 12, 512)
        x = mixed @ layer["attn_out"].reshape(256, 512).T + x
        h = modulate(norm(x, layer["ffn_norm"]), layer["ffn_mod_weight"], layer["ffn_mod_bias"])
        up = h @ layer["ffn_up"] + layer["ffn_up_bias"]
        up = f32(0.5) * up * (1 + np.tanh(f32(np.sqrt(2 / np.pi)) * (up + f32(0.044715) * up**3)))
        x = up @ layer["ffn_down"] + layer["ffn_down_bias"] + x
    predicted = x.reshape(1, 1, 3072) @ weights.output_weight.T + weights.output_bias
    mapped = (noise + (noise - predicted) * f32(-1.0)).reshape(768)
    return mapped / np.linalg.norm(mapped)


def test_noise_matches_numpy_legacy_random_state() -> None:
    noise = tm.mapper_noise()
    assert noise.dtype == np.float32
    assert noise.shape == (768,)
    np.testing.assert_allclose(noise[:5], [1.7640524, 0.4001572, 0.978738, 2.2408931, 1.867558], rtol=1e-6)


def test_matches_a_literal_transcription_of_the_graph() -> None:
    weights = random_weights()
    mapper = tm.TextMapper(weights).eval()
    for seed in (1, 2, 3):
        text = unit(seed)
        expected = literal_mapper(weights, text)
        got = mapper(torch.from_numpy(text)).numpy()
        np.testing.assert_allclose(got, expected, atol=2e-6)


def test_maps_a_batch_like_single_prompts() -> None:
    mapper = tm.TextMapper(random_weights(1)).eval()
    batch = np.stack([unit(seed) for seed in (4, 5, 6)])
    together = mapper(torch.from_numpy(batch)).numpy()
    for row, text in zip(together, batch, strict=True):
        np.testing.assert_allclose(row, mapper(torch.from_numpy(text)).numpy(), atol=1e-6)


def test_outputs_are_unit_length_float32() -> None:
    mapper = tm.TextMapper(random_weights(2)).eval()
    out = mapper(torch.from_numpy(unit(7)).double())
    assert out.dtype == torch.float32
    assert out.shape == (768,)
    assert float(torch.linalg.vector_norm(out)) == pytest.approx(1.0, abs=1e-6)


def test_rejects_a_graph_that_is_not_the_mapper(tmp_path: Path) -> None:
    path = tmp_path / "other.tflite"
    path.write_bytes(
        build_model(
            [
                SubgraphSpec(
                    "main",
                    [TensorSpec("a", (1, 768)), TensorSpec("b", (1, 768)), TensorSpec("c", (1, 768))],
                    (0, 1),
                    (2,),
                    [OperatorSpec(0, (0, 1), (2,))],
                )
            ]
        )
    )
    with pytest.raises(tm.MapperFormatError):
        tm.read_mapper_weights(path)


def real_mapper() -> Path | None:
    configured = os.environ.get("MAGENTA_TEST_MAPPER")
    if configured:
        path = Path(configured)
        return path if is_genuine(path) else None
    return find_mapper(weight_cache())


@pytest.fixture(scope="module")
def google_mapper() -> tm.TextMapper:
    path = real_mapper()
    if path is None:
        pytest.skip("mapper.tflite is not available. Set MAGENTA_TEST_MAPPER to run these.")
    return tm.TextMapper.from_file(path)


def test_reads_the_real_mapper_weights(google_mapper: tm.TextMapper) -> None:
    assert google_mapper.qkv.shape == (8, 256, 3, 8, 64)
    assert google_mapper.prefix.shape == (128,)
    np.testing.assert_allclose(
        google_mapper.rope_cos[0, 1, 0].numpy(),
        np.cos(10_000.0 ** (-np.arange(32) / 32)),
        atol=1e-6,
    )


@pytest.mark.parametrize("seed", sorted(GOLDEN))
def test_matches_google_tflite_outputs(google_mapper: tm.TextMapper, seed: int) -> None:
    head, projection = GOLDEN[seed]
    out = google_mapper(torch.from_numpy(unit(seed))).numpy()
    np.testing.assert_allclose(out[:6], head, atol=2e-6)
    probe = np.random.RandomState(PROBE_SEED).randn(768).astype(np.float32)
    assert float(out @ probe) == pytest.approx(projection, abs=2e-5)
