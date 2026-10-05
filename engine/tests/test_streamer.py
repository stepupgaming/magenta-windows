from __future__ import annotations

import math

import pytest
import torch
from torch.nn import functional as F

from model_code import layers
from model_code.cudagraph import CudaGraphStreamer
from model_code.depthformer import _COMMON, DepthformerConfig, MultivariateDecoder, SpecDims

ENCODER = 24


def tiny_decoder(seed: int = 0, temporal_layers: int = 2) -> MultivariateDecoder:
    config = DepthformerConfig(
        encoder_model_dims=ENCODER,
        temporal=SpecDims(temporal_layers, 32, 64, 2, 16),
        depth=SpecDims(2, 16, 32, 2, 8),
        temporal_max_past=5,
        **_COMMON,
    )
    torch.manual_seed(seed)
    decoder = MultivariateDecoder(config)
    with torch.no_grad():
        for name, param in decoder.named_parameters():
            if name.endswith("scale") and "per_dim" not in name:
                param.copy_(1 + 0.1 * torch.randn_like(param))
            elif name == "embedding":
                param.normal_(0, 1.0)
            else:
                param.normal_(0, 0.3 if "per_dim" in name else 0.1)
    return decoder.eval()


def source(seed: int) -> torch.Tensor:
    return torch.randn(1, 1, ENCODER, generator=torch.Generator().manual_seed(seed))


def streamer(decoder: MultivariateDecoder, top_k: int = 32, seed: int = 0) -> CudaGraphStreamer:
    return CudaGraphStreamer(decoder, source(1), torch.float32, top_k=top_k, seed=seed, warmup=8, capture=False)


def play(stream: CudaGraphStreamer, frames: int = 6) -> list[list[int]]:
    return [stream.step()[0, 0].tolist() for _ in range(frames)]


@pytest.mark.parametrize("dtype", [torch.float32, torch.bfloat16])
def test_norms_follow_the_reference_math(dtype: torch.dtype) -> None:
    x = (torch.randn(3, 1, 64) * 3).to(dtype)
    rms, layer = layers.RMSNorm(64), layers.LayerNorm(64)
    with torch.no_grad():
        rms.scale.normal_(1, 0.2)
        layer.scale.normal_(1, 0.2)
        layer.bias.normal_(0, 0.1)
        v = x.float()
        rms_expected = (v * torch.rsqrt(v.pow(2).mean(-1, keepdim=True) + 1e-6)).to(dtype) * rms.scale.to(dtype)
        mean = v.mean(-1, keepdim=True)
        normed = (v - mean) * torch.rsqrt((v - mean).pow(2).mean(-1, keepdim=True) + 1e-6)
        layer_expected = normed.to(dtype) * layer.scale.to(dtype) + layer.bias.to(dtype)
        tolerance = {"atol": 1e-5, "rtol": 1e-5} if dtype == torch.float32 else {"atol": 0.0, "rtol": 2**-7}
        torch.testing.assert_close(rms(x), rms_expected, **tolerance)
        torch.testing.assert_close(layer(x), layer_expected, **tolerance)
        assert rms(x).dtype == dtype


def test_query_scale_cache_follows_the_weights() -> None:
    projection = layers.AttnProjection(32, 2, 16)
    with torch.no_grad():
        projection.per_dim_scale.normal_(0, 0.3)
        first = projection.query_scale(torch.float32)
        torch.testing.assert_close(first, layers._query_scale_vector(projection.per_dim_scale, 16, torch.float32))
        assert projection.query_scale(torch.float32) is first
        projection.per_dim_scale.add_(0.5)
        updated = projection.query_scale(torch.float32)
    expected = 1.442695041 / math.sqrt(16) * F.softplus(projection.per_dim_scale.detach())
    torch.testing.assert_close(updated, expected)


def test_precomputed_source_kv_matches_projecting_every_frame() -> None:
    decoder = tiny_decoder()
    with torch.no_grad():
        frame = torch.randint(6, 1000, (1, 1, 12))
        kv = [(torch.randn(1, 4, 2, 16), torch.randn(1, 4, 2, 16)) for _ in range(2)]
        src = source(2)
        projected = decoder.temporal_step_fn(frame, kv, kv, src)
        cached = decoder.temporal_step_fn(frame, kv, kv, src, decoder.source_kv(src))
    torch.testing.assert_close(cached[0], projected[0], atol=0, rtol=0)
    for (k1, v1), (k2, v2) in zip(cached[2], projected[2], strict=True):
        torch.testing.assert_close(k1, k2, atol=0, rtol=0)
        torch.testing.assert_close(v1, v2, atol=0, rtol=0)


def test_codebook_head_matches_the_whole_vocab_head() -> None:
    decoder = tiny_decoder()
    empty = torch.zeros(1, 0, 2, 8)
    depth_kv = [(empty, empty), (empty, empty)]
    h = torch.randn(1, 1, 32)
    with torch.no_grad():
        for _ in range(2):
            whole, _ = decoder.depth_step_fn(h, depth_kv)
            for q in range(12):
                lo = 6 + q * 1024
                one, _ = decoder.depth_step_fn(h, depth_kv, codebook=q)
                torch.testing.assert_close(one, whole[..., lo : lo + 1024], atol=1e-5, rtol=1e-5)
            # The cache must notice new weights.
            decoder.to_logits.kernel.mul_(-1)


def test_restore_replays_the_same_music() -> None:
    stream = streamer(tiny_decoder())
    memory = stream.snapshot()
    stream.set_seed(11)
    first = play(stream)
    stream.restore(memory)
    stream.set_seed(11)
    assert play(stream) == first


def test_top_k_changes_live() -> None:
    narrow = streamer(tiny_decoder(), top_k=3)
    wide = streamer(tiny_decoder(), top_k=200)
    wide.set_top_k(3)
    wide.restore(narrow.snapshot())
    # On the CPU both streamers share one generator, so seed right before each.
    wide.set_seed(5)
    live = play(wide)
    narrow.set_seed(5)
    assert live == play(narrow)


def test_top_k_of_one_ignores_the_seed() -> None:
    stream = streamer(tiny_decoder())
    stream.set_top_k(1)
    memory = stream.snapshot()
    runs = []
    for seed in (1, 2):
        stream.restore(memory)
        stream.set_seed(seed)
        runs.append(play(stream))
    assert runs[0] == runs[1]
    stream.set_top_k(10_000)
    assert stream.top_k == 256
    assert stream.kth.item() == 255


def test_flush_fills_every_cross_attention_slot() -> None:
    stream = streamer(tiny_decoder())
    new = source(9)
    with torch.no_grad():
        stream.set_source(new, flush=True)
        expected = stream.dec.source_kv(new)
    for index, (key, value) in enumerate(expected):
        assert torch.equal(stream.CK[index], key.expand_as(stream.CK[index]))
        assert torch.equal(stream.CV[index], value.expand_as(stream.CV[index]))


def test_restore_rejects_another_models_memory() -> None:
    stream = streamer(tiny_decoder())
    before = stream.snapshot()
    other = streamer(tiny_decoder(temporal_layers=3)).snapshot()
    with pytest.raises(ValueError):
        stream.restore(other)
    for (key, value), (saved_key, saved_value) in zip(stream.snapshot()["self"], before["self"], strict=True):
        assert torch.equal(key, saved_key)
        assert torch.equal(value, saved_value)


def test_a_closed_streamer_refuses_to_step() -> None:
    stream = streamer(tiny_decoder())
    stream.close()
    with pytest.raises(RuntimeError):
        stream.step()


def test_streamer_attends_the_trained_window() -> None:
    """Greedy streaming must match the eager path, which trims to the window the
    model was trained with, well past the point where the window fills."""
    decoder = tiny_decoder()
    warmup, frames = 13, 12
    stream = CudaGraphStreamer(decoder, source(1), torch.float32, top_k=1, warmup=warmup, capture=False)
    streamed = [stream.step()[0, 0].tolist() for _ in range(frames)]

    def greedy(logits: torch.Tensor, _q: int, lo: int, hi: int) -> torch.Tensor:
        return logits[..., lo:hi].argmax(-1) + lo

    with torch.no_grad():
        state = decoder.init_streaming(1, torch.device("cpu"))
        eager = [decoder.step(state, source(1), sampler=greedy)[0][0, 0].tolist() for _ in range(warmup + frames)]
    assert streamed == eager[warmup:]


def unique_frames(count: int, seed: int) -> torch.Tensor:
    """Random frames as unique codes: codebook q's code c is 6 + q * 1024 + c."""
    codes = torch.randint(0, 1024, (1, count, 12), generator=torch.Generator().manual_seed(seed))
    return codes + 6 + torch.arange(12) * 1024


def test_context_kv_matches_stepping_through_the_frames() -> None:
    decoder = tiny_decoder()
    frames = unique_frames(20, seed=4)
    keep = decoder.cfg.temporal_max_past
    with torch.no_grad():
        batched_self, batched_cross = decoder.context_kv(frames, source(2), keep)
        state = decoder.init_streaming_f(1, torch.device("cpu"))
        for t in range(frames.shape[1]):
            _, new_self, new_cross = decoder.temporal_step_fn(state["prev"], state["self"], state["cross"], source(2))
            state["self"] = [(k[:, -keep:], v[:, -keep:]) for k, v in new_self]
            state["cross"] = [(k[:, -keep:], v[:, -keep:]) for k, v in new_cross]
            state["prev"] = frames[:, t : t + 1]
    for batched, stepped in ((batched_self, state["self"]), (batched_cross, state["cross"])):
        for (k1, v1), (k2, v2) in zip(batched, stepped, strict=True):
            torch.testing.assert_close(k1, k2, atol=1e-5, rtol=1e-5)
            torch.testing.assert_close(v1, v2, atol=1e-5, rtol=1e-5)


def test_load_context_continues_like_the_eager_path() -> None:
    """After hearing the same frames, the streamer and the eager path pick the
    same greedy continuation."""
    decoder = tiny_decoder()
    frames = unique_frames(24, seed=5)
    stream = CudaGraphStreamer(decoder, source(1), torch.float32, top_k=1, warmup=8, capture=False)
    with torch.no_grad():
        stream.load_context(frames, source(1))
    continued = [stream.step()[0, 0].tolist() for _ in range(10)]

    def greedy(logits: torch.Tensor, _q: int, lo: int, hi: int) -> torch.Tensor:
        return logits[..., lo:hi].argmax(-1) + lo

    with torch.no_grad():
        state = decoder.init_streaming(1, torch.device("cpu"))
        for t in range(frames.shape[1]):
            decoder.step(state, source(1), forced_frame=frames[:, t : t + 1])
        eager = [decoder.step(state, source(1), sampler=greedy)[0][0, 0].tolist() for _ in range(10)]
    assert continued == eager


def test_load_context_needs_more_than_the_window() -> None:
    stream = streamer(tiny_decoder())
    with pytest.raises(ValueError):
        stream.load_context(unique_frames(stream.KEEP, seed=1), source(1))
