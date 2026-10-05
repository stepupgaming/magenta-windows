"""Windows CUDA server for Magenta RealTime 2.

This is the path that actually runs on an NVIDIA PC. The upstream app is
MLX on Apple Silicon. Here the PyTorch port stays loaded, a CUDA graph
steps one audio frame at a time, and a websocket sends stereo PCM to the
Catalyzer stage.

Weights stay in the local Hugging Face hub. Executable model code is the
copy in model_code/ next to this file.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import queue
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any

from magenta_win.cache_path import weight_cache

os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(weight_cache()))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from transformers import AutoConfig
from transformers.dynamic_module_utils import get_class_from_dynamic_module

from magenta_win.clip_encoder_file import locate_clip_encoder
from magenta_win.text_mapper import MapperFormatError, TextMapper
from magenta_win.text_mapper_file import locate_mapper
from magenta_win.watchdog import SilenceWatch, expects_silence

ENGINE_ROOT = Path(__file__).resolve().parent
MODEL_CODE = ENGINE_ROOT / "model_code"
WEIGHTS_REPO = "magenta-community/magenta-realtime-2"
MUSICCOCA_REPO = "magenta-torch/magenta-rt-musiccoca-torch"
SAMPLE_RATE = 48_000
FRAMES_PER_SECOND = 25
SAMPLES_PER_FRAME = SAMPLE_RATE // FRAMES_PER_SECOND
PORT = int(os.environ.get("MAGENTA_PORT", "8765"))
STYLE_TOKENS = 12
# Google's engine steers with only the 6 coarsest of the 12 style tokens and
# masks the finer ones. The model was trained with random masking of that tail,
# so fewer levels is an input it knows.
STYLE_LEVELS = 6
# Remembered grooves kept per stream: one per scene, plus room to spare.
GROOVES_KEPT = 16
AUDIO_PROMPT_RATE = 16_000
AUDIO_PROMPT_MIN_SECONDS = 0.5
AUDIO_PROMPT_MAX_SECONDS = 60.0
AUDIO_PROMPT_KEEP = 24
FRAME_SECONDS = 1 / FRAMES_PER_SECOND
# Continuing from a clip follows Google's engine: 48 kHz stereo, at most the 28 s
# its encoder takes, with 25 frames (1 s) trimmed from each end. The encoder's
# STFT is not warmed up at the start of a clip and is zero-padded at its end, so
# tokens there do not reflect the audio; Google found 25 the sweet spot.
CLIP_MAX_SECONDS = 28
CLIP_TRIM_FRAMES = 25
CLIP_MIN_SECONDS = 4.0
CLIP_UPLOAD_MAX_SECONDS = 60.0
CLIP_KEEP = 4
# Heard frames decoded into a fresh codec state, so the first continuation audio
# is the clip's own last heard frame and the join has no seam.
CODEC_WARMUP_FRAMES = 32
# Of those, frames whose audio is not sent: a fresh codec state needs context
# before its output matches a decode of the whole clip.
CODEC_SETTLE_FRAMES = 16
# The clip's own sound, as the codec hears it, played ahead of the continuation.
CLIP_LEAD_SECONDS = 2.0
CLIP_LEAD_MAX_SECONDS = 8.0
DRUM_MODES = {"auto": None, "on": [1], "off": [0]}

_model: Any = None
_model_error: str | None = None
_model_lock = threading.Lock()

# Upstream maps every text embedding toward audio space before blending.
# Without the mapper, text prompts still work, just less like the official apps.
_text_mapper: TextMapper | None = None
_text_mapper_state = "pending"
_text_mapper_detail = "loads with the model"

# Audio prompts arrive over HTTP as 16 kHz mono float32. They are embedded
# later on the GPU lane, the same thread that replays the CUDA graph.
_audio_clips: OrderedDict[str, np.ndarray] = OrderedDict()
_audio_lock = threading.Lock()
# Clips to continue from: 48 kHz stereo, [samples, 2].
_clips: OrderedDict[str, np.ndarray] = OrderedDict()

# Google's SpectroStream encoder, which turns a clip back into model tokens.
_clip_encoder: Any = None
_clip_encoder_state = "pending"
_clip_encoder_detail = "loads with the model"


def store_audio_clip(raw: bytes) -> tuple[str, float]:
    if len(raw) % 4 != 0:
        raise ValueError("audio prompt must be little-endian float32 samples")
    samples = np.frombuffer(raw, dtype="<f4").astype(np.float32)
    seconds = samples.shape[0] / AUDIO_PROMPT_RATE
    if seconds < AUDIO_PROMPT_MIN_SECONDS:
        raise ValueError("audio prompt is shorter than half a second")
    if seconds > AUDIO_PROMPT_MAX_SECONDS:
        raise ValueError("audio prompt is longer than 60 seconds")
    if not np.all(np.isfinite(samples)):
        raise ValueError("audio prompt has samples that are not finite")
    clip_id = hashlib.sha1(raw).hexdigest()[:16]
    with _audio_lock:
        _audio_clips[clip_id] = samples
        _audio_clips.move_to_end(clip_id)
        while len(_audio_clips) > AUDIO_PROMPT_KEEP:
            _audio_clips.popitem(last=False)
    return clip_id, seconds


def audio_clip(clip_id: str) -> np.ndarray | None:
    with _audio_lock:
        return _audio_clips.get(clip_id)


def store_clip(raw: bytes) -> tuple[str, float]:
    """Keep a 48 kHz stereo clip (interleaved little-endian float32) to continue from."""
    if len(raw) % 8 != 0:
        raise ValueError("a clip must be interleaved stereo little-endian float32 samples")
    samples = np.frombuffer(raw, dtype="<f4").astype(np.float32).reshape(-1, 2)
    seconds = samples.shape[0] / SAMPLE_RATE
    if seconds < CLIP_MIN_SECONDS:
        raise ValueError(f"a clip to continue from needs at least {CLIP_MIN_SECONDS:g} seconds")
    if seconds > CLIP_UPLOAD_MAX_SECONDS:
        raise ValueError(f"a clip is longer than {CLIP_UPLOAD_MAX_SECONDS:g} seconds")
    if not np.all(np.isfinite(samples)):
        raise ValueError("a clip has samples that are not finite")
    clip_id = hashlib.sha1(raw).hexdigest()[:16]
    with _audio_lock:
        _clips[clip_id] = samples
        _clips.move_to_end(clip_id)
        while len(_clips) > CLIP_KEEP:
            _clips.popitem(last=False)
    return clip_id, seconds


def stored_clip(clip_id: str) -> np.ndarray | None:
    with _audio_lock:
        return _clips.get(clip_id)


_audio_tower_fetched = False


def prefetch_audio_tower() -> None:
    """Download the audio tower files off the GPU lane, so the first audio
    prompt does not stall a live stream while it downloads."""
    global _audio_tower_fetched
    if _audio_tower_fetched or os.environ.get("HF_HUB_OFFLINE") == "1":
        return
    try:
        from huggingface_hub import hf_hub_download

        for name in ("music_encoder.pt", "mel_params.npz"):
            hf_hub_download(MUSICCOCA_REPO, name)
        _audio_tower_fetched = True
    except Exception as exc:
        print(f"[magenta] audio tower prefetch failed: {exc}", flush=True)


def hub_snapshot(repo_id: str) -> Path:
    cache = Path(os.environ["HUGGINGFACE_HUB_CACHE"])
    snapshots = cache / ("models--" + repo_id.replace("/", "--")) / "snapshots"
    if snapshots.is_dir():
        dirs = [path for path in snapshots.iterdir() if path.is_dir()]
        if dirs:
            return max(dirs, key=lambda path: path.stat().st_mtime)
    if os.environ.get("HF_HUB_OFFLINE") == "1":
        raise FileNotFoundError(
            f"No local snapshot for {repo_id} under {snapshots}"
        )
    from huggingface_hub import snapshot_download

    print(f"[magenta] downloading {repo_id}", flush=True)
    return Path(snapshot_download(repo_id, cache_dir=str(cache)))


def load_model() -> Any:
    global _model, _model_error
    with _model_lock:
        if _model is not None:
            return _model
        if not MODEL_CODE.exists():
            raise FileNotFoundError(f"Model code missing: {MODEL_CODE}")
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is not available to PyTorch")
        print(
            f"[magenta] torch {torch.__version__} cuda {torch.version.cuda} "
            f"gpu {torch.cuda.get_device_name(0)}",
            flush=True,
        )
        weights = hub_snapshot(WEIGHTS_REPO)
        processor = hub_snapshot(MUSICCOCA_REPO)
        print(f"[magenta] code {MODEL_CODE}", flush=True)
        print(f"[magenta] weights {weights}", flush=True)
        try:
            config = AutoConfig.from_pretrained(
                str(MODEL_CODE),
                trust_remote_code=True,
                local_files_only=True,
            )
            model_class = get_class_from_dynamic_module(
                config.auto_map["AutoModel"],
                str(MODEL_CODE),
                local_files_only=True,
            )
            model = model_class.from_pretrained(
                str(weights),
                config=config,
                local_files_only=True,
                dtype=torch.bfloat16,
            ).to("cuda").eval()
            model.load_processor(repo_id=str(processor), device="cuda")
        except Exception as exc:
            _model_error = str(exc)
            raise
        load_text_mapper()
        load_clip_encoder(model)
        _model = model
        _model_error = None
        return model


def load_text_mapper() -> None:
    """Load the text mapper. A missing or broken mapper never stops the model."""
    global _text_mapper, _text_mapper_state, _text_mapper_detail
    try:
        found = locate_mapper(
            Path(os.environ["HUGGINGFACE_HUB_CACHE"]),
            allow_download=os.environ.get("HF_HUB_OFFLINE") != "1",
            log=lambda message: print(f"[magenta] {message}", flush=True),
        )
        _text_mapper_state, _text_mapper_detail = found.state, found.detail
        if found.path is not None:
            _text_mapper = TextMapper.from_file(found.path)
    except (OSError, MapperFormatError) as exc:
        _text_mapper, _text_mapper_state, _text_mapper_detail = None, "unavailable", str(exc)
    except Exception as exc:  # noqa: BLE001 - the model must load even if the mapper cannot.
        _text_mapper, _text_mapper_state, _text_mapper_detail = None, "unavailable", f"unexpected error: {exc!r}"
    print(f"[magenta] text mapper {_text_mapper_state}: {_text_mapper_detail}", flush=True)


def load_clip_encoder(model: Any) -> None:
    """Load the SpectroStream encoder for continuing from a clip. Never stops the model."""
    global _clip_encoder, _clip_encoder_state, _clip_encoder_detail
    try:
        found = locate_clip_encoder(
            Path(os.environ["HUGGINGFACE_HUB_CACHE"]),
            allow_download=os.environ.get("HF_HUB_OFFLINE") != "1",
            log=lambda message: print(f"[magenta] {message}", flush=True),
        )
        _clip_encoder_state, _clip_encoder_detail = found.state, found.detail
        if found.encoder is not None and found.quantizer is not None:
            from model_code.spectrostream_encoder import load_clip_encoder as build_clip_encoder

            levels = int(model.config.num_codebooks)
            _clip_encoder = build_clip_encoder(found.encoder, found.quantizer, levels).to(model._dev)
    except (OSError, ValueError, RuntimeError) as exc:
        _clip_encoder, _clip_encoder_state, _clip_encoder_detail = None, "unavailable", str(exc)
    except Exception as exc:  # noqa: BLE001 - the model must load even if the encoder cannot.
        _clip_encoder, _clip_encoder_state, _clip_encoder_detail = None, "unavailable", f"unexpected error: {exc!r}"
    print(f"[magenta] clip encoder {_clip_encoder_state}: {_clip_encoder_detail}", flush=True)


def _as_embedding(value: Any, device: torch.device) -> torch.Tensor:
    if hasattr(value, "detach"):
        value = value.detach()
    if not isinstance(value, torch.Tensor):
        value = torch.as_tensor(value)
    return value.to(device)


def blend_embeddings(embeddings: list[torch.Tensor], weights: list[float]) -> torch.Tensor:
    total = float(sum(weights))
    if total <= 0:
        raise ValueError("prompt weights must sum above zero")
    mixed = None
    for embedding, weight in zip(embeddings, weights):
        part = embedding * float(weight / total)
        mixed = part if mixed is None else mixed + part
    if mixed is None:
        raise ValueError("no prompts to blend")
    return mixed


def quantize(model: Any, embedding: torch.Tensor) -> list[int]:
    tokens = model.processor.tokenize(embedding)
    if hasattr(tokens, "tolist"):
        tokens = tokens.tolist()
    return [int(token) for token in tokens]


def mask_style_levels(tokens: list[int], levels: int) -> list[int]:
    """Keep the `levels` coarsest style tokens and mask the rest (-1)."""
    return [token if index < levels else -1 for index, token in enumerate(tokens)]


def clean_notes(raw: Any) -> list[int] | None:
    """128 pitch slots: -1 masked, 0 off, 1 sustain, 2 onset, 3 on (model picks)."""
    if not isinstance(raw, list) or len(raw) == 0:
        return None
    notes = [int(np.clip(int(value), -1, 3)) for value in raw[:128]]
    if len(notes) < 128:
        notes.extend([-1] * (128 - len(notes)))
    if all(note < 0 for note in notes):
        return None
    return notes


def clean_drums(raw: Any) -> str:
    """auto masks the drum slot, on asks for drums, off asks for none.

    A bool is the older form: true meant the model picks, false meant none.
    """
    if isinstance(raw, str) and raw in DRUM_MODES:
        return raw
    return "auto" if bool(raw) else "off"


def clean_prompts(raw: Any, allow_empty: bool = False) -> list[dict[str, Any]]:
    prompts: list[dict[str, Any]] = []
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            weight = float(item.get("weight", 1.0))
            if not np.isfinite(weight) or weight < 0:
                weight = 0.0
            clip_id = item.get("audio")
            if isinstance(clip_id, str) and clip_id:
                if audio_clip(clip_id) is None:
                    continue
                prompts.append({"audio": clip_id, "text": f"audio:{clip_id}", "weight": weight})
                continue
            text = str(item.get("text", "")).strip()
            if not text:
                continue
            prompts.append({"text": text[:180], "weight": weight})
    prompts = [item for item in prompts if not allow_empty or item["weight"] > 0]
    if not prompts:
        if allow_empty:
            return []
        prompts = [{"text": "warm analog pads", "weight": 1.0}]
    if sum(item["weight"] for item in prompts) <= 0:
        prompts[0]["weight"] = 1.0
    return prompts[:8]


def clean_spec(raw: dict[str, Any] | None) -> dict[str, Any]:
    raw = raw or {}
    temperature = float(raw.get("temperature", 1.05))
    top_k = int(raw.get("top_k", 48))
    free_style = bool(raw.get("free_style", False))
    return {
        "prompts": clean_prompts(raw.get("prompts"), allow_empty=free_style),
        "temperature": float(np.clip(temperature, 0.2, 2.0)),
        "top_k": int(np.clip(top_k, 1, 256)),
        "cfg_musiccoca": float(np.clip(float(raw.get("cfg_musiccoca", 2.4)), 0.0, 7.0)),
        "cfg_notes": float(np.clip(float(raw.get("cfg_notes", 0.8)), 0.0, 7.0)),
        "cfg_drums": float(np.clip(float(raw.get("cfg_drums", 0.0)), 0.0, 4.0)),
        "notes": clean_notes(raw.get("notes")),
        "onsets": bool(raw.get("onsets", False)),
        "drums": clean_drums(raw.get("drums", False)),
        "seed": int(raw.get("seed", 0)),
        "style_levels": int(np.clip(int(raw.get("style_levels", STYLE_LEVELS)), 1, STYLE_TOKENS)),
    }


def clean_lead(raw: Any) -> float:
    """Seconds of a clip to play ahead of its continuation."""
    try:
        lead = float(raw)
    except (TypeError, ValueError):
        return CLIP_LEAD_SECONDS
    if not np.isfinite(lead):
        return CLIP_LEAD_SECONDS
    return float(np.clip(lead, 0.0, CLIP_LEAD_MAX_SECONDS))


def clean_slot(raw: Any) -> str | None:
    """A groove slot name from the window, such as "scene-3"."""
    if not isinstance(raw, str):
        return None
    slot = raw.strip()[:40]
    return slot or None


def _spec_key(spec: dict[str, Any]) -> tuple[Any, ...]:
    notes = spec["notes"]
    return (
        tuple((item["text"], round(float(item["weight"]), 4)) for item in spec["prompts"]),
        spec["style_levels"],
        None if notes is None else tuple(int(note) for note in notes),
        spec["drums"],
        round(float(spec["cfg_musiccoca"]), 3),
        round(float(spec["cfg_notes"]), 3),
        round(float(spec["cfg_drums"]), 3),
    )


def held_pitches(notes: list[int] | None) -> frozenset[int]:
    if notes is None:
        return frozenset()
    return frozenset(index for index, value in enumerate(notes) if value in (1, 2))


def with_onsets(notes: list[int], onsets: frozenset[int]) -> list[int]:
    """Mark fresh pitches as onsets (2) and every other held pitch as sustain (1)."""
    marked = list(notes)
    for index, value in enumerate(marked):
        if value == 2:
            marked[index] = 1
    for index in onsets:
        marked[index] = 2
    return marked


def ensure_audio_tower(model: Any) -> None:
    """Load the MusicCoCa audio tower, fetching it from the hub when the local
    snapshot only carries the text encoder."""
    musiccoca = model.processor._mc
    if musiccoca._me is not None:
        return
    try:
        musiccoca._ensure_audio()
        return
    except Exception as exc:
        if os.environ.get("HF_HUB_OFFLINE") == "1":
            raise RuntimeError(
                f"Audio prompts need music_encoder.pt and mel_params.npz from {MUSICCOCA_REPO}. "
                "Unset HF_HUB_OFFLINE once so they can download."
            ) from exc
    print(f"[magenta] downloading the audio tower from {MUSICCOCA_REPO}", flush=True)
    musiccoca._resource_dir = None
    musiccoca._repo_id = MUSICCOCA_REPO
    musiccoca._ensure_audio()


class Session:
    def __init__(self, model: Any) -> None:
        self.model = model
        self.cache: dict[str, torch.Tensor] = {}
        self.streamer: Any = None
        self.decode_state: dict[str, Any] | None = None
        self.signature: tuple[Any, ...] | None = None
        self._spec_key: tuple[Any, ...] | None = None
        self._held: frozenset[int] = frozenset()
        self._sustain_source: torch.Tensor | None = None
        # The memory right after priming, to revive the model from.
        self._factory: dict[str, Any] | None = None
        self.top_k = 48
        self.seed = 0

    def _embed(self, item: dict[str, Any]) -> torch.Tensor:
        key = item["text"]
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        clip_id = item.get("audio")
        if clip_id:
            samples = audio_clip(clip_id)
            if samples is None:
                raise RuntimeError("An audio prompt expired on the engine. Add it again.")
            ensure_audio_tower(self.model)
            raw = self.model.processor.embed((samples, AUDIO_PROMPT_RATE))
        else:
            raw = self.model.processor.embed(key)
            if _text_mapper is not None:
                raw = _text_mapper(_as_embedding(raw, torch.device("cpu")))
        embedding = _as_embedding(raw, self.model._dev)
        self.cache[key] = embedding
        return embedding

    def _style_tokens(self, spec: dict[str, Any]) -> list[int]:
        if not spec["prompts"]:
            return [-1] * STYLE_TOKENS
        embeddings = [self._embed(item) for item in spec["prompts"]]
        weights = [float(item["weight"]) for item in spec["prompts"]]
        tokens = quantize(self.model, blend_embeddings(embeddings, weights))
        return mask_style_levels(tokens, spec["style_levels"])

    def _encode(self, tokens: list[int], notes: list[int] | None, drums: list[int] | None, spec: dict[str, Any]) -> torch.Tensor:
        cond = self.model._resolve_conditioning(
            tokens,
            notes,
            drums,
            spec["cfg_musiccoca"],
            spec["cfg_notes"],
            spec["cfg_drums"],
        )
        return self.model.depthformer.encode(cond).to(self.model._dt)

    def _source(self, spec: dict[str, Any]) -> tuple[list[int], list[int] | None, list[int] | None, torch.Tensor]:
        tokens = self._style_tokens(spec)
        notes = spec["notes"]
        drums = DRUM_MODES[spec["drums"]]
        return tokens, notes, drums, self._encode(tokens, notes, drums, spec)

    def start(self, spec: dict[str, Any]) -> None:
        tokens, notes, drums, source = self._source(spec)
        self.top_k = int(spec["top_k"])
        self.seed = int(spec["seed"])
        self.streamer = self.model.make_cudagraph_streamer(
            style=tokens,
            notes=notes,
            drums=drums,
            cfg_musiccoca=spec["cfg_musiccoca"],
            cfg_notes=spec["cfg_notes"],
            cfg_drums=spec["cfg_drums"],
            temperature=spec["temperature"],
            top_k=self.top_k,
            seed=self.seed,
            guidance=False,
        )
        self.top_k = self.streamer.top_k
        self._factory = self.streamer.snapshot()
        self.decode_state = self.model.init_decode_state()
        self._held = held_pitches(notes) if spec["onsets"] else frozenset()
        if self._held and notes is not None:
            self._sustain_source = source
            source = self._encode(tokens, with_onsets(notes, self._held), drums, spec)
        self.streamer.set_source(source)
        self.streamer.set_temperature(spec["temperature"])
        self.signature = (
            tuple(tokens),
            tuple(notes) if notes is not None else None,
            tuple(drums) if drums is not None else None,
            round(spec["cfg_musiccoca"], 3),
            round(spec["cfg_notes"], 3),
            round(spec["cfg_drums"], 3),
        )
        self._spec_key = _spec_key(spec)

    def _apply(self, spec: dict[str, Any], flush: bool = False) -> None:
        if self.streamer is None:
            raise RuntimeError("session is not started")
        key = _spec_key(spec)
        if key != self._spec_key:
            tokens, notes, drums, source = self._source(spec)
            held = held_pitches(notes) if spec["onsets"] else frozenset()
            onsets = held - self._held
            self._held = held
            if onsets and notes is not None:
                # The first frame hears the fresh pitches as onsets. The
                # sustain source takes over after that frame.
                self._sustain_source = source
                source = self._encode(tokens, with_onsets(notes, onsets), drums, spec)
            else:
                self._sustain_source = None
            self.streamer.set_source(source, flush=flush)
            self._spec_key = key
            self.signature = key
        self.streamer.set_temperature(spec["temperature"])
        if int(spec["top_k"]) != self.top_k:
            self.streamer.set_top_k(int(spec["top_k"]))
            self.top_k = self.streamer.top_k
        if int(spec["seed"]) != self.seed:
            self.seed = int(spec["seed"])
            self.streamer.set_seed(self.seed)

    def remember(self) -> dict[str, Any]:
        """Copy the model's memory so `recall` can jump back to this moment."""
        if self.streamer is None:
            raise RuntimeError("session is not started")
        return self.streamer.snapshot()

    def recall(self, memory: dict[str, Any], spec: dict[str, Any]) -> None:
        """Continue from a remembered moment with this spec. The sampler restarts
        from the spec's seed, so recalling the same groove plays out the same way."""
        if self.streamer is None:
            raise RuntimeError("session is not started")
        self.streamer.restore(memory)
        self.seed = int(spec["seed"])
        self.streamer.set_seed(self.seed)
        self._spec_key = None
        self._apply(spec, flush=True)

    def continue_from(
        self, samples: np.ndarray, spec: dict[str, Any], lead: float = 0.0
    ) -> tuple[np.ndarray, float]:
        """Make the model continue a 48 kHz stereo clip, [samples, 2], from its end.

        Encodes the last 28 s, trims the encoder's unreliable edges, and fills
        the model's memory with what it would hold after playing those frames.
        Style and notes are masked while it hears them, as in Google's engine:
        the clip is the context, and the spec steers only what comes next.

        Returns the clip's last `lead` seconds before the pickup as the codec
        decodes them, to play ahead of the continuation with no seam, and how
        many seconds before the clip's end the new music starts."""
        if self.streamer is None:
            raise RuntimeError("session is not started")
        if _clip_encoder is None:
            raise RuntimeError(f"Continuing from audio is unavailable: {_clip_encoder_detail}")
        frames = min(samples.shape[0] // SAMPLES_PER_FRAME, CLIP_MAX_SECONDS * FRAMES_PER_SECOND)
        if frames - 2 * CLIP_TRIM_FRAMES <= self.streamer.KEEP:
            raise ValueError("the clip is too short to continue from")
        tail = np.ascontiguousarray(samples[samples.shape[0] - frames * SAMPLES_PER_FRAME :], dtype=np.float32)
        codes = _clip_encoder(torch.from_numpy(tail).to(self.model._dev)[None])
        codes = codes[:, CLIP_TRIM_FRAMES : frames - CLIP_TRIM_FRAMES]
        offsets = torch.arange(codes.shape[-1], device=codes.device) * self.model.codebook_size
        heard = codes + offsets + self.model.num_reserved_tokens
        drums = [0] if spec["drums"] == "off" else [-1]
        cond = self.model._conditioning([-1] * STYLE_TOKENS, [-1] * self.model.num_notes, drums, [-1, -1, -1])
        self.streamer.load_context(heard, self.model.depthformer.encode(cond).to(self.model._dt))
        # The codec has one frame of latency: decoding heard frames returns audio
        # up to the second to last, and the next decode starts with the last one.
        lead_frames = min(round(lead * FRAMES_PER_SECOND), heard.shape[1] - 1 - CODEC_SETTLE_FRAMES)
        context = max(CODEC_WARMUP_FRAMES, lead_frames + CODEC_SETTLE_FRAMES + 1)
        self.decode_state = self.model.init_decode_state()
        warm = self.model.decode_stream(heard[:, -context:], self.decode_state)
        keep = max(0, lead_frames) * SAMPLES_PER_FRAME
        lead_audio = warm[0, warm.shape[1] - keep :].float().cpu().numpy() if keep else np.zeros((0, 2), np.float32)
        self._spec_key = None
        self._sustain_source = None
        self._apply(spec)
        return lead_audio, (CLIP_TRIM_FRAMES + 1) * FRAME_SECONDS

    def revive(self, spec: dict[str, Any]) -> None:
        """Bring a model that fell silent back to the memory it had after priming."""
        if self.streamer is None or self._factory is None:
            raise RuntimeError("session is not started")
        self.streamer.restore(self._factory)
        self._spec_key = None
        self._apply(spec, flush=True)

    def _frame(self) -> torch.Tensor:
        piece = self.streamer.step()
        if self._sustain_source is not None:
            self.streamer.set_source(self._sustain_source)
            self._sustain_source = None
        return piece

    def step(self, spec: dict[str, Any], frames: int = 2, flush: bool = False) -> tuple[np.ndarray, float]:
        if self.streamer is None or self.decode_state is None:
            raise RuntimeError("session is not started")
        self._apply(spec, flush)
        started = time.perf_counter()
        pieces = [self._frame() for _ in range(frames)]
        torch.cuda.synchronize()
        elapsed_ms = (time.perf_counter() - started) * 1000.0 / frames
        audio = self.model.decode_stream(torch.cat(pieces, dim=1), self.decode_state)
        samples = audio[0].float().detach().cpu().numpy()
        return samples, elapsed_ms

    def close(self) -> None:
        streamer = self.streamer
        self.streamer = None
        if streamer is not None:
            streamer.close()


class GpuLane:
    """CUDA graph capture and replay have to stay on one thread."""

    def __init__(self) -> None:
        self._jobs: queue.Queue[tuple[Any, tuple[Any, ...], queue.Queue[Any]]] = queue.Queue()
        self._thread = threading.Thread(target=self._loop, name="magenta-gpu", daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        # Nothing on this thread trains. With autograd on, every steer's
        # encoder pass stays chained to the CUDA graph's static source
        # buffer, and VRAM grows until the stream stops. Grad mode is per
        # thread, so this covers every job the lane runs.
        torch.set_grad_enabled(False)
        while True:
            fn, args, done = self._jobs.get()
            try:
                done.put(("ok", fn(*args)))
            except Exception as exc:
                done.put(("err", exc))

    def call(self, fn: Any, *args: Any) -> Any:
        done: queue.Queue[tuple[str, Any]] = queue.Queue()
        self._jobs.put((fn, args, done))
        kind, payload = done.get()
        if kind == "err":
            raise payload
        return payload


def pcm_bytes(samples: np.ndarray) -> bytes:
    clipped = np.clip(samples, -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2").tobytes()


def cuda_memory() -> dict[str, int] | None:
    """This process's GPU memory in MB: what tensors hold, and what PyTorch keeps
    for them. Other programs on the GPU don't count. None until CUDA is in use,
    since asking earlier would start CUDA in an idle engine."""
    if not torch.cuda.is_available() or not torch.cuda.is_initialized():
        return None
    return {
        "allocated_mb": round(torch.cuda.memory_allocated() / 2**20),
        "reserved_mb": round(torch.cuda.memory_reserved() / 2**20),
    }


def health() -> dict[str, Any]:
    gpu = None
    if torch.cuda.is_available():
        gpu = torch.cuda.get_device_name(0)
    return {
        "ok": True,
        "backend": "torch-cuda",
        "model_loaded": _model is not None,
        "error": _model_error,
        "gpu": gpu,
        "cuda_memory": cuda_memory(),
        "sample_rate": SAMPLE_RATE,
        "text_mapper": _text_mapper_state,
        "text_mapper_detail": _text_mapper_detail,
        "clip_encoder": _clip_encoder_state,
        "clip_encoder_detail": _clip_encoder_detail,
    }


app = FastAPI(title="Magenta Windows")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def get_health() -> dict[str, Any]:
    return health()


@app.post("/load")
def post_load() -> dict[str, Any]:
    load_model()
    return health()


def _exit_soon() -> None:
    time.sleep(0.3)
    os._exit(0)


@app.post("/shutdown")
def post_shutdown() -> dict[str, bool]:
    threading.Thread(target=_exit_soon, daemon=True).start()
    return {"ok": True, "stopping": True}


@app.post("/audio-prompt")
async def post_audio_prompt(request: Request) -> dict[str, Any]:
    """Store a 16 kHz mono float32 clip. Prompts then name it by id."""
    raw = await request.body()
    try:
        clip_id, seconds = store_audio_clip(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await asyncio.to_thread(prefetch_audio_tower)
    return {"id": clip_id, "seconds": round(seconds, 3)}


@app.post("/clip")
async def post_clip(request: Request) -> dict[str, Any]:
    """Store a 48 kHz stereo float32 clip (interleaved) to continue from."""
    raw = await request.body()
    try:
        clip_id, seconds = store_clip(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": clip_id, "seconds": round(seconds, 3)}


def apply_client_message(payload: dict[str, Any], spec: dict[str, Any]) -> tuple[dict[str, Any], str]:
    op = str(payload.get("op") or "")
    if op in {"stop", "remember", "forget"}:
        return spec, op
    if op in {"start", "steer", "restart"}:
        return clean_spec(payload), op
    return spec, "ignore"


async def start_session(websocket: WebSocket, lane: GpuLane, spec: dict[str, Any]) -> Session:
    await websocket.send_json({"type": "status", "message": "Loading model"})
    model = await asyncio.to_thread(lane.call, load_model)
    await websocket.send_json({"type": "status", "message": "Capturing CUDA graph"})
    session = Session(model)
    await asyncio.to_thread(lane.call, session.start, spec)
    await websocket.send_json(
        {
            "type": "started",
            "sampleRate": SAMPLE_RATE,
            "channels": 2,
            "topK": session.top_k,
            "seed": int(spec["seed"]),
        }
    )
    return session


@app.websocket("/ws/stream")
async def stream_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    spec = clean_spec({})
    session: Session | None = None
    lane = GpuLane()
    incoming: asyncio.Queue[dict[str, Any] | Exception] = asyncio.Queue()

    async def reader() -> None:
        try:
            while True:
                await incoming.put(await websocket.receive())
        except Exception as exc:
            await incoming.put(exc)

    reader_task = asyncio.create_task(reader())

    async def take_message(timeout: float | None) -> dict[str, Any] | None:
        if timeout is None:
            item = await incoming.get()
        elif timeout == 0:
            try:
                item = incoming.get_nowait()
            except asyncio.QueueEmpty:
                raise asyncio.TimeoutError from None
        else:
            item = await asyncio.wait_for(incoming.get(), timeout)
        if isinstance(item, Exception):
            raise item
        if item.get("type") == "websocket.disconnect":
            raise WebSocketDisconnect
        text = item.get("text")
        if not text:
            return {}
        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            return {}
        return parsed

    try:
        while session is None:
            payload = await take_message(None)
            if not payload:
                continue
            spec, op = apply_client_message(payload, spec)
            if op == "stop":
                await websocket.send_json({"type": "stopped"})
                return
            if op not in {"start", "restart"}:
                continue
            session = await start_session(websocket, lane, spec)

        sent = 0
        wall = time.perf_counter()
        last_stats = 0.0
        # Remembered moments of this stream, by slot. They outlive a restart,
        # since every session of one model has the same memory shape.
        grooves: OrderedDict[str, Any] = OrderedDict()
        watch = SilenceWatch()
        while True:
            restart = False
            flush = False
            groove: str | None = None
            clip: str | None = None
            lead = CLIP_LEAD_SECONDS
            while True:
                try:
                    payload = await take_message(0)
                except asyncio.TimeoutError:
                    break
                if not payload:
                    continue
                spec, op = apply_client_message(payload, spec)
                if op == "stop":
                    await websocket.send_json({"type": "stopped"})
                    return
                slot = clean_slot(payload.get("slot"))
                if op == "remember" and slot:
                    grooves[slot] = await asyncio.to_thread(lane.call, session.remember)
                    grooves.move_to_end(slot)
                    while len(grooves) > GROOVES_KEPT:
                        grooves.popitem(last=False)
                    await websocket.send_json({"type": "remembered", "slot": slot})
                    continue
                if op == "forget" and slot:
                    grooves.pop(slot, None)
                    continue
                restart = restart or op == "restart"
                flush = flush or bool(payload.get("cut", False))
                groove = clean_slot(payload.get("groove")) or groove
                if clean_slot(payload.get("continue")):
                    clip = clean_slot(payload.get("continue"))
                    lead = clean_lead(payload.get("lead"))
            if restart:
                # A fresh session clears the model's memory.
                await asyncio.to_thread(lane.call, session.close)
                session = await start_session(websocket, lane, spec)
                sent = 0
                wall = time.perf_counter()
                watch.reset()
            current = spec
            if groove:
                memory = grooves.get(groove)
                if memory is None:
                    await websocket.send_json({"type": "forgotten", "slot": groove})
                else:
                    await asyncio.to_thread(lane.call, session.recall, memory, current)
                    watch.reset()
            if clip:
                samples = stored_clip(clip)
                failure = "The clip expired on the engine. Send it again." if samples is None else None
                if samples is not None:
                    try:
                        lead_audio, pickup = await asyncio.to_thread(
                            lane.call, session.continue_from, samples, current, lead
                        )
                    except (RuntimeError, ValueError) as exc:
                        failure = str(exc)
                    else:
                        # Every byte after this message is the clip's lead-in, then
                        # the continuation.
                        await websocket.send_json(
                            {
                                "type": "continued",
                                "clip": clip,
                                "lead": round(lead_audio.shape[0] / SAMPLE_RATE, 3),
                                "pickup": round(pickup, 3),
                            }
                        )
                        if lead_audio.size:
                            await websocket.send_bytes(pcm_bytes(lead_audio))
                        sent = int(lead_audio.shape[0])
                        wall = time.perf_counter()
                        watch.reset()
                if failure is not None:
                    await websocket.send_json({"type": "continue-failed", "clip": clip, "message": failure})
            samples, frame_ms = await asyncio.to_thread(lane.call, session.step, current, 4, flush)
            if samples.size:
                await websocket.send_bytes(pcm_bytes(samples))
                sent += int(samples.shape[0])
            if watch.observe(samples, SAMPLE_RATE, expects_silence(current["notes"])):
                await asyncio.to_thread(lane.call, session.revive, current)
                print("[magenta] the model fell silent, so it was revived", flush=True)
                await websocket.send_json({"type": "revived", "count": watch.revivals})
            now = time.perf_counter()
            if now - last_stats >= 0.4:
                last_stats = now
                await websocket.send_json(
                    {
                        "type": "stats",
                        "msPerFrame": round(frame_ms, 2),
                        "topK": session.top_k,
                        "temperature": current["temperature"],
                    }
                )
            ahead = sent / SAMPLE_RATE - (time.perf_counter() - wall)
            if ahead > 1.2:
                await asyncio.sleep(ahead - 0.8)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[magenta] stream failed: {exc}", flush=True)
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
    finally:
        reader_task.cancel()
        if session is not None:
            await asyncio.to_thread(lane.call, session.close)


@torch.no_grad()
def render(
    spec: dict[str, Any],
    seconds: float,
    output: Path,
    continue_clip: np.ndarray | None = None,
    lead_in: float = 0.0,
) -> None:
    """Write `seconds` of music to a wav. With `continue_clip` (48 kHz stereo),
    the music continues that clip, and the wav starts with up to `lead_in`
    seconds of the clip before the point where the model picks up, as the codec
    decodes them, so the join has no seam.

    magenta generate calls this outside the GPU lane, so autograd is turned off
    here too. Otherwise the codec's weights make its audio require grad."""
    import soundfile as sf

    spec = clean_spec(spec)
    model = load_model()
    session = Session(model)
    try:
        print("[magenta] capturing CUDA graph", flush=True)
        session.start(spec)
        target = int(seconds * SAMPLE_RATE)
        pieces: list[np.ndarray] = []
        if continue_clip is not None:
            lead_audio, pickup = session.continue_from(continue_clip, spec, lead_in)
            pieces.append(lead_audio)
            target += int(lead_audio.shape[0])
            print(f"[magenta] continuing {pickup:.2f}s before the end of the clip", flush=True)
        got = sum(int(piece.shape[0]) for piece in pieces)
        started = time.perf_counter()
        while got < target:
            samples, frame_ms = session.step(spec, 4)
            pieces.append(samples)
            got += int(samples.shape[0])
            print(
                f"[magenta] {got / SAMPLE_RATE:.2f}s frame={frame_ms:.1f}ms",
                flush=True,
            )
        audio = np.concatenate(pieces, axis=0)[:target]
        output.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(output), audio, SAMPLE_RATE)
        rms = float(np.sqrt(np.mean(np.square(audio))))
        peak = float(np.max(np.abs(audio)))
        elapsed = time.perf_counter() - started
        print(
            f"[magenta] wrote {output} rms={rms:.4f} peak={peak:.4f} "
            f"speed={seconds / max(elapsed, 1e-6):.2f}x",
            flush=True,
        )
        if rms < 0.001:
            raise SystemExit("generated audio is silent")
    finally:
        session.close()
        torch.cuda.empty_cache()


def run_smoke(seconds: float, output: Path) -> None:
    render(
        {
            "prompts": [
                {"text": "techno", "weight": 0.65},
                {"text": "soothing chords", "weight": 0.35},
            ],
            "temperature": 1.05,
            "top_k": 48,
            "cfg_musiccoca": 2.4,
            "cfg_notes": 0.8,
            "seed": 7,
        },
        seconds,
        output,
    )


def serve(port: int) -> None:
    print(f"[magenta] listening on 127.0.0.1:{port}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


def main() -> None:
    parser = argparse.ArgumentParser(description="Magenta Windows CUDA server")
    parser.add_argument("--smoke-seconds", type=float, default=0.0)
    parser.add_argument("--out", type=Path, default=ENGINE_ROOT / "outputs" / "smoke.wav")
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()
    if args.smoke_seconds > 0:
        run_smoke(args.smoke_seconds, args.out)
        return
    serve(args.port)


if __name__ == "__main__":
    main()
