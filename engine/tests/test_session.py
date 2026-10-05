from __future__ import annotations

import hashlib
import importlib
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
        # Stand-in audio that carries the tokens, so tests can compare music.
        state.setdefault("decoded", []).append(frames.clone())
        return frames.float().reshape(1, -1, 1).repeat(1, 1, 2)


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
    assert play(session, spec()) == first


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


def test_continue_from_a_clip(session: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    encoder = FakeClipEncoder()
    monkeypatch.setattr(server, "_clip_encoder", encoder)
    play(session, spec())
    with torch.no_grad():
        rewind = session.continue_from(clip(30.5), spec())
    # The encoder hears the clip's last 28 s, in whole frames.
    assert tuple(encoder.inputs[0].shape) == (1, 700 * 1920, 2)
    assert rewind == pytest.approx(26 * 0.04)
    # The model's next input is the last frame kept after trimming 25 from each end.
    last_kept = 700 - 25 - 1
    expected = (torch.arange(12) + last_kept * 12) % 1024 + torch.arange(12) * 1024 + 6
    assert session.streamer.prev[0, 0].tolist() == expected.tolist()
    # The codec is warmed on the last 32 heard frames, ending with that frame.
    warmed = session.decode_state["decoded"][0]
    assert warmed.shape[1] == 32
    assert warmed[0, -1].tolist() == expected.tolist()
    # Playing on works and keeps the warmed codec state.
    play(session, spec())
    assert len(session.decode_state["decoded"]) > 1


def test_continue_needs_the_encoder(session: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(server, "_clip_encoder", None)
    monkeypatch.setattr(server, "_clip_encoder_detail", "downloads are off")
    with pytest.raises(RuntimeError, match="downloads are off"):
        session.continue_from(clip(10), spec())


def test_continue_needs_a_long_enough_clip(session: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(server, "_clip_encoder", FakeClipEncoder())
    with pytest.raises(ValueError, match="too short"):
        session.continue_from(clip(2.1), spec())


def test_clip_store_checks_what_it_keeps() -> None:
    good = clip(5)
    clip_id, seconds = server.store_clip(good.tobytes())
    assert seconds == pytest.approx(5.0)
    np.testing.assert_array_equal(server.stored_clip(clip_id), good)
    for bad in (b"123", clip(1).tobytes(), np.full((48_000 * 5, 2), np.nan, np.float32).tobytes()):
        with pytest.raises(ValueError):
            server.store_clip(bad)
