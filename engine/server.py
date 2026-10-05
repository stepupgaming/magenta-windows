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

ENGINE_ROOT = Path(__file__).resolve().parent
MODEL_CODE = ENGINE_ROOT / "model_code"
WEIGHTS_REPO = "magenta-community/magenta-realtime-2"
MUSICCOCA_REPO = "magenta-torch/magenta-rt-musiccoca-torch"
SAMPLE_RATE = 48_000
FRAMES_PER_SECOND = 25
SAMPLES_PER_FRAME = SAMPLE_RATE // FRAMES_PER_SECOND
PORT = int(os.environ.get("MAGENTA_PORT", "8765"))
STYLE_TOKENS = 12
AUDIO_PROMPT_RATE = 16_000
AUDIO_PROMPT_MIN_SECONDS = 0.5
AUDIO_PROMPT_MAX_SECONDS = 60.0
AUDIO_PROMPT_KEEP = 24
DRUM_MODES = {"auto": None, "on": [1], "off": [0]}

_model: Any = None
_model_error: str | None = None
_model_lock = threading.Lock()

# Audio prompts arrive over HTTP as 16 kHz mono float32. They are embedded
# later on the GPU lane, the same thread that replays the CUDA graph.
_audio_clips: OrderedDict[str, np.ndarray] = OrderedDict()
_audio_lock = threading.Lock()


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
        _model = model
        _model_error = None
        return model


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
    }


def _spec_key(spec: dict[str, Any]) -> tuple[Any, ...]:
    notes = spec["notes"]
    return (
        tuple((item["text"], round(float(item["weight"]), 4)) for item in spec["prompts"]),
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
        self.top_k = 48

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
        embedding = _as_embedding(raw, self.model._dev)
        self.cache[key] = embedding
        return embedding

    def _style_tokens(self, spec: dict[str, Any]) -> list[int]:
        if not spec["prompts"]:
            return [-1] * STYLE_TOKENS
        embeddings = [self._embed(item) for item in spec["prompts"]]
        weights = [float(item["weight"]) for item in spec["prompts"]]
        return quantize(self.model, blend_embeddings(embeddings, weights))

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
        self.streamer = self.model.make_cudagraph_streamer(
            style=tokens,
            notes=notes,
            drums=drums,
            cfg_musiccoca=spec["cfg_musiccoca"],
            cfg_notes=spec["cfg_notes"],
            cfg_drums=spec["cfg_drums"],
            temperature=spec["temperature"],
            top_k=self.top_k,
            seed=int(spec["seed"]),
            guidance=False,
        )
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
        "sample_rate": SAMPLE_RATE,
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


def apply_client_message(payload: dict[str, Any], spec: dict[str, Any]) -> tuple[dict[str, Any], str]:
    op = str(payload.get("op") or "")
    if op == "stop":
        return spec, "stop"
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
        while True:
            restart = False
            flush = False
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
                restart = restart or op == "restart"
                flush = flush or bool(payload.get("cut", False))
            if restart:
                # A fresh session clears the model's memory and applies the
                # new seed and top_k, which the captured graph fixes.
                await asyncio.to_thread(lane.call, session.close)
                session = await start_session(websocket, lane, spec)
                sent = 0
                wall = time.perf_counter()
            current = spec
            samples, frame_ms = await asyncio.to_thread(lane.call, session.step, current, 4, flush)
            if samples.size:
                await websocket.send_bytes(pcm_bytes(samples))
                sent += int(samples.shape[0])
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


def render(spec: dict[str, Any], seconds: float, output: Path) -> None:
    import soundfile as sf

    spec = clean_spec(spec)
    model = load_model()
    session = Session(model)
    try:
        print("[magenta] capturing CUDA graph", flush=True)
        session.start(spec)
        target = int(seconds * SAMPLE_RATE)
        pieces: list[np.ndarray] = []
        got = 0
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
