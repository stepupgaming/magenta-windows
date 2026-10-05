from __future__ import annotations

import hashlib
import importlib
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest
import torch

pytest.importorskip("transformers")
pytest.importorskip("fastapi")
server = importlib.import_module("server")

from model_code.cudagraph import CudaGraphStreamer  # noqa: E402
from model_code.depthformer import _COMMON, Depthformer, DepthformerConfig, SpecDims  # noqa: E402
from model_code.modeling_magenta_rt2 import MagentaRT2ForConditionalGeneration  # noqa: E402


class FakeProcessor:
    """Text to a fixed random embedding, and an embedding to 12 tokens."""

    def embed(self, text: str) -> torch.Tensor:
        seed = int(hashlib.sha1(text.encode()).hexdigest()[:8], 16)
        return torch.from_numpy(np.random.default_rng(seed).standard_normal(768).astype(np.float32))

    def tokenize(self, embedding: torch.Tensor) -> list[int]:
        return [int(abs(float(value)) * 997) % 1024 for value in embedding[:12]]


class TinyModel:
    """What a Session uses of the real model, over a tiny random Depthformer."""

    num_musiccoca = 12
    num_notes = 128
    num_drums = 1
    num_reserved_tokens = 6
    codebook_size = 1024
    _conditioning = MagentaRT2ForConditionalGeneration._conditioning
    _resolve_conditioning = MagentaRT2ForConditionalGeneration._resolve_conditioning

    def __init__(self) -> None:
        self.config = SimpleNamespace(cfg_musiccoca=2.4, cfg_notes=0.8, cfg_drums=1.0)
        self._dev = torch.device("cpu")
        self._dt = torch.float32
        self.processor = FakeProcessor()
        torch.manual_seed(0)
        self.depthformer = Depthformer(
            DepthformerConfig(
                encoder_model_dims=24,
                temporal=SpecDims(2, 32, 64, 2, 16),
                depth=SpecDims(2, 16, 32, 2, 8),
                temporal_max_past=5,
                **_COMMON,
            )
        )
        with torch.no_grad():
            for name, param in self.depthformer.named_parameters():
                if name.endswith("scale") and "per_dim" not in name:
                    param.copy_(1 + 0.1 * torch.randn_like(param))
                else:
                    param.normal_(0, 1.0 if "embedding" in name or "dequantizer" in name else 0.1)
        self.depthformer.eval()

    def make_cudagraph_streamer(self, **kwargs: Any) -> CudaGraphStreamer:
        cond = self._resolve_conditioning(
            kwargs["style"],
            kwargs["notes"],
            kwargs["drums"],
            kwargs["cfg_musiccoca"],
            kwargs["cfg_notes"],
            kwargs["cfg_drums"],
        )
        return CudaGraphStreamer(
            self.depthformer.decoder,
            self.depthformer.encode(cond),
            self._dt,
            temperature=kwargs["temperature"],
            top_k=kwargs["top_k"],
            seed=kwargs["seed"],
            warmup=8,
            capture=False,
        )

    def init_decode_state(self) -> dict[str, Any]:
        return {}

    def decode_stream(self, frames: torch.Tensor, state: dict[str, Any]) -> torch.Tensor:
        """Stand-in codec with the real one's shape: one frame of latency and
        1920 samples per frame, each sample holding its frame's first code."""
        state.setdefault("decoded", []).append(frames.clone())
        pending = state.get("pending")
        frames = frames if pending is None else torch.cat([pending, frames], dim=1)
        state["pending"] = frames[:, -1:]
        ready = frames[:, :-1, 0].float()
        return ready.repeat_interleave(1920, dim=1)[..., None].repeat(1, 1, 2)


class FakeClipEncoder:
    """Stands in for SpectroStream: frame f encodes to codes (f * 12 + level) % 1024."""

    def __init__(self) -> None:
        self.inputs: list[torch.Tensor] = []

    def __call__(self, wav: torch.Tensor) -> torch.Tensor:
        self.inputs.append(wav)
        frames = wav.shape[1] // 1920
        return (torch.arange(frames * 12).reshape(1, frames, 12) % 1024).long()


@pytest.fixture
def session(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(server.torch.cuda, "synchronize", lambda: None)
    live = server.Session(TinyModel())
    with torch.no_grad():
        live.start(spec())
    yield live
    live.close()


def spec(**changes: Any) -> dict[str, Any]:
    raw = {"prompts": [{"text": "dusty boom bap", "weight": 1.0}], "top_k": 40, "seed": 3}
    raw.update(changes)
    return server.clean_spec(raw)


def play(session: Any, values: dict[str, Any], chunks: int = 2) -> list[float]:
    with torch.no_grad():
        return [float(x) for _ in range(chunks) for x in session.step(values, 4)[0][:, 0]]


def test_style_detail_masks_the_finer_tokens(session: Any) -> None:
    full = session._style_tokens(spec(style_levels=12))
    assert -1 not in full
    assert session._style_tokens(spec(style_levels=4)) == full[:4] + [-1] * 8
    assert session._style_tokens(spec()) == full[:6] + [-1] * 6


def test_choices_and_seed_change_without_a_restart(session: Any) -> None:
    streamer = session.streamer
    play(session, spec(top_k=5, seed=9))
    assert session.streamer is streamer
    assert streamer.top_k == 5
    assert session.top_k == 5
    assert session.seed == 9


def test_recalling_a_groove_plays_it_the_same_way(session: Any) -> None:
    play(session, spec())
    groove = session.remember()
    with torch.no_grad():
        session.recall(groove, spec())
    first = play(session, spec())
    with torch.no_grad():
        session.recall(groove, spec())
    # The codec's one frame of latency plays the frame before the recall first.
    assert play(session, spec())[1920:] == first[1920:]


def test_revive_returns_to_the_primed_memory(session: Any) -> None:
    primed = session._factory
    play(session, spec(), chunks=3)
    with torch.no_grad():
        session.revive(spec())
    for key, (saved, _) in zip(session.streamer.SK, primed["self"], strict=True):
        assert torch.equal(key, saved)
    assert torch.equal(session.streamer.prev, primed["prev"])


def test_clean_spec_reads_style_detail() -> None:
    assert server.clean_spec({})["style_levels"] == 6
    assert server.clean_spec({"style_levels": 40})["style_levels"] == 12
    assert server.clean_spec({"style_levels": 0})["style_levels"] == 1


def test_memory_ops_keep_the_spec() -> None:
    current = server.clean_spec({"top_k": 12})
    for op in ("remember", "forget"):
        kept, parsed = server.apply_client_message({"op": op, "slot": "scene-1", "top_k": 99}, current)
        assert parsed == op
        assert kept is current
    assert server.clean_slot("  scene-2 ") == "scene-2"
    assert server.clean_slot("") is None
    assert server.clean_slot(3) is None


def clip(seconds: float) -> np.ndarray:
    return np.random.default_rng(1).uniform(-0.5, 0.5, (int(seconds * 48_000), 2)).astype(np.float32)


def heard_code(frame: int) -> float:
    """The first unique code the stand-in encoder gives a kept clip frame."""
    return float((frame * 12) % 1024 + 6)


def test_continue_from_a_clip(session: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    encoder = FakeClipEncoder()
    monkeypatch.setattr(server, "_clip_encoder", encoder)
    play(session, spec())
    with torch.no_grad():
        lead, pickup = session.continue_from(clip(30.5), spec(), lead=1.0)
    # The encoder hears the clip's last 28 s, in whole frames.
    assert tuple(encoder.inputs[0].shape) == (1, 700 * 1920, 2)
    assert pickup == pytest.approx(26 * 0.04)
    # The model's next input is the last frame kept after trimming 25 from each end.
    last_kept = 700 - 25 - 1
    expected = (torch.arange(12) + last_kept * 12) % 1024 + torch.arange(12) * 1024 + 6
    assert session.streamer.prev[0, 0].tolist() == expected.tolist()
    # The lead-in is the 25 frames before the last kept one, as the codec decodes them.
    assert lead.shape == (25 * 1920, 2)
    frame_values = lead[::1920, 0].tolist()
    assert frame_values == [heard_code(frame) for frame in range(last_kept - 25, last_kept)]
    # The next audio starts with the last kept frame, then the continuation.
    with torch.no_grad():
        audio, _ = session.step(spec(), 4)
    assert audio[0, 0] == heard_code(last_kept)
    assert audio.shape[0] == 4 * 1920


def test_continue_without_a_lead_still_warms_the_codec(session: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(server, "_clip_encoder", FakeClipEncoder())
    with torch.no_grad():
        lead, _ = session.continue_from(clip(10), spec())
    assert lead.shape == (0, 2)
    assert session.decode_state["decoded"][0].shape[1] == 32


def test_continue_needs_the_encoder(session: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(server, "_clip_encoder", None)
    monkeypatch.setattr(server, "_clip_encoder_detail", "downloads are off")
    with pytest.raises(RuntimeError, match="downloads are off"):
        session.continue_from(clip(10), spec())


def test_continue_needs_a_long_enough_clip(session: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(server, "_clip_encoder", FakeClipEncoder())
    with pytest.raises(ValueError, match="too short"):
        session.continue_from(clip(2.1), spec())


def test_clean_lead_bounds_the_lead_in() -> None:
    assert server.clean_lead(None) == 2.0
    assert server.clean_lead("junk") == 2.0
    assert server.clean_lead(float("nan")) == 2.0
    assert server.clean_lead(-3) == 0.0
    assert server.clean_lead(30) == 8.0
    assert server.clean_lead(1.5) == 1.5


def test_clip_store_checks_what_it_keeps() -> None:
    good = clip(5)
    clip_id, seconds = server.store_clip(good.tobytes())
    assert seconds == pytest.approx(5.0)
    np.testing.assert_array_equal(server.stored_clip(clip_id), good)
    for bad in (b"123", clip(1).tobytes(), np.full((48_000 * 5, 2), np.nan, np.float32).tobytes()):
        with pytest.raises(ValueError):
            server.store_clip(bad)


def test_health_reports_engine_memory_once_cuda_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    cuda = server.torch.cuda
    monkeypatch.setattr(cuda, "is_available", lambda: True)
    monkeypatch.setattr(cuda, "is_initialized", lambda: False)
    # An idle engine must not start CUDA just to answer /health.
    monkeypatch.setattr(cuda, "memory_allocated", lambda: pytest.fail("started CUDA"))
    assert server.cuda_memory() is None
    monkeypatch.setattr(cuda, "is_initialized", lambda: True)
    monkeypatch.setattr(cuda, "memory_allocated", lambda: 5 * 2**30)
    monkeypatch.setattr(cuda, "memory_reserved", lambda: 6 * 2**30)
    assert server.cuda_memory() == {"allocated_mb": 5120, "reserved_mb": 6144}


def test_generate_continues_a_clip_with_autograd_off(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """magenta generate renders outside the GPU lane. The real codec has
    parameters, so with autograd on its audio required grad and continuing a
    clip failed on .numpy()."""
    pytest.importorskip("soundfile")
    model = TinyModel()
    codec_scale = torch.nn.Parameter(torch.ones(()))
    decode = model.decode_stream

    def codec_with_weights(frames: torch.Tensor, state: dict[str, Any]) -> torch.Tensor:
        return decode(frames, state) * codec_scale

    model.decode_stream = codec_with_weights  # type: ignore[method-assign]
    monkeypatch.setattr(server, "load_model", lambda: model)
    monkeypatch.setattr(server, "_clip_encoder", FakeClipEncoder())
    monkeypatch.setattr(server.torch.cuda, "synchronize", lambda: None)
    out = tmp_path / "continued.wav"
    server.render(spec(), 0.5, out, continue_clip=clip(10), lead_in=1.0)
    assert out.is_file()
    assert torch.is_grad_enabled()
