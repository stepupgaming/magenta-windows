"""Check Magenta on this NVIDIA GPU, start to finish, with no clicking.

1. Speed: `magenta generate` renders 20 s of techno and reports its speed.
2. Continue: `magenta generate --continue` carries that file on.
3. Live: the engine the window uses streams for 10 minutes while this script
   moves three style faders four times a second, changes choices and seed,
   plays chords, saves and recalls a groove, continues from the stream, and
   restarts once. Every 10 seconds it reads the engine's own GPU memory from
   /health and the whole GPU's from nvidia-smi.

gpu-check.bat runs this with engine\\.venv. Everything lands in
engine/logs/gpu-check/<time>/, with report.txt as the summary and
3-timeline.txt listing every action and engine event of the live stream.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import wave
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path, PureWindowsPath
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "engine"
PORT = 8765
BASE_URL = f"http://127.0.0.1:{PORT}"
RATE = 48_000
REALTIME_FRAME_MS = 40.0  # one model frame is 40 ms of audio
OLD_SPEED = 0.94  # what the base model managed before the speed work
# A leak grows with every steer, about 2,400 of them here, so it shows as
# hundreds of MB. One-time buffers from a continue or a restart do not.
ENGINE_GROWTH_LIMIT_MB = 200
GPU_GROWTH_LIMIT_MB = 500
# The Windows desktop alone holds about 1 GB. More than this is other programs.
BUSY_MB = 3000
SETTLED_AFTER = 180  # the first continue, at 2:30, fills the clip encoder's buffers once
CAUSE_WINDOW = 15  # the watchdog waits 6 s, so look this far back for what came first
SILENT_RMS = 1e-4
KEEP_SECONDS = 30
CLIP_SECONDS = 12
STEERS_PER_SECOND = 4

FRAME_LINE = re.compile(r"^\[magenta\] ([\d.]+)s frame=([\d.]+)ms")
SPEED = re.compile(r"speed=([\d.]+)x")
FADERS = (("techno", 7.0, 0.0), ("dusty boom bap", 11.0, 2.1), ("ambient pads", 13.0, 4.2))
CHORD = (60, 64, 67)
CHOICES = (20, 48, 120)
OUT_OF_MEMORY = ("OutOfMemoryError", "CUDA out of memory")


def say(text: str = "") -> None:
    print(text, flush=True)


def clock(seconds: float) -> str:
    return f"{int(seconds // 60)}:{int(seconds % 60):02d}"


def child_env() -> dict[str, str]:
    env = dict(os.environ)
    env["PYTHONPATH"] = str(ENGINE)
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def port_open(port: int = PORT) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except OSError:
        return False


# --- GPU memory -------------------------------------------------------------


def find_nvidia_smi() -> str | None:
    found = shutil.which("nvidia-smi")
    if found:
        return found
    system = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "nvidia-smi.exe"
    for candidate in (system, Path(r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe")):
        if candidate.is_file():
            return str(candidate)
    return None


def run_smi(smi: str | None, query: str) -> list[list[str]]:
    if smi is None:
        return []
    try:
        out = subprocess.run(
            [smi, query, "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if out.returncode != 0:
        return []
    return [[part.strip() for part in line.split(",")] for line in out.stdout.strip().splitlines() if line.strip()]


def query_gpus(smi: str | None, fields: str) -> list[list[str]]:
    return run_smi(smi, f"--query-gpu={fields}")


def gpu_used_mb(smi: str | None) -> int | None:
    """Memory in use across every NVIDIA GPU, by every program."""
    rows = query_gpus(smi, "memory.used")
    try:
        return sum(int(float(row[0])) for row in rows) if rows else None
    except ValueError:
        return None


def gpu_programs(smi: str | None) -> list[str]:
    """Programs using CUDA. Windows reports their memory as N/A, and games or
    browsers holding graphics memory are not listed at all."""
    programs = []
    for row in run_smi(smi, "--query-compute-apps=pid,process_name,used_memory"):
        if len(row) < 2:
            continue
        memory = f", {row[2]} MB" if len(row) > 2 and row[2].isdigit() else ""
        programs.append(f"{PureWindowsPath(row[1]).name} (pid {row[0]}{memory})")
    return programs


def slope_mb_per_min(samples: list[tuple[float, int]]) -> float:
    if len(samples) < 3:
        return 0.0
    times = np.array([t for t, _ in samples]) / 60.0
    values = np.array([mb for _, mb in samples], dtype=np.float64)
    return float(np.polyfit(times, values, 1)[0])


def settled(samples: list[tuple[float, int]]) -> list[tuple[float, int]]:
    return [(t, mb) for t, mb in samples if t >= SETTLED_AFTER] or samples


def net_growth(samples: list[tuple[float, int]]) -> tuple[int, int, int]:
    """Median of the first three samples, of the last three, and the change, so
    a single noisy sample at either end cannot decide the verdict."""
    first = int(np.median([mb for _, mb in samples[:3]]))
    last = int(np.median([mb for _, mb in samples[-3:]]))
    return first, last, last - first


# --- Steps 1 and 2: magenta generate ----------------------------------------


@dataclass
class Render:
    ok: bool
    speed: float | None
    frames_ms: list[float]
    wall: float
    tail: list[str]

    @property
    def out_of_memory(self) -> bool:
        return any(marker in line for line in self.tail for marker in OUT_OF_MEMORY)


def run_generate(label: str, command: list[str], log_path: Path) -> Render:
    started = time.perf_counter()
    frames: list[float] = []
    speed: float | None = None
    tail: deque[str] = deque(maxlen=30)
    with (
        log_path.open("w", encoding="utf-8") as log,
        subprocess.Popen(
            command,
            cwd=ENGINE,
            env=child_env(),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        ) as proc,
    ):
        assert proc.stdout is not None
        for raw in proc.stdout:
            log.write(raw)
            line = raw.rstrip()
            tail.append(line)
            frame = FRAME_LINE.match(line)
            if frame:
                frames.append(float(frame.group(2)))
                if len(frames) % 25 == 0:
                    say(f"    {label}: {float(frame.group(1)):.0f} s of audio, {frames[-1]:.1f} ms per frame")
                continue
            found = SPEED.search(line)
            if found:
                speed = float(found.group(1))
            if line:
                say(f"    {line[:160]}")
        code = proc.wait()
    return Render(code == 0 and speed is not None, speed, frames, time.perf_counter() - started, list(tail))


def frame_summary(frames: list[float]) -> str:
    steady = frames[5:] or frames
    if not steady:
        return "no frame times"
    values = np.array(steady)
    return (
        f"{np.median(values):.1f} ms per frame typical, {np.percentile(values, 95):.1f} ms at the 95th percentile, "
        f"{values.max():.1f} ms slowest ({REALTIME_FRAME_MS:.0f} ms is real time)"
    )


def generate_lines(step: str, render: Render, busy_mb: int | None) -> list[str]:
    if render.ok and render.speed is not None:
        pace = "faster than real time" if render.speed >= 1.0 else "slower than real time"
        return [
            f"{step}: {render.speed:.2f}x, {pace} (it was about {OLD_SPEED:.2f}x before the speed work).",
            f"   {frame_summary(render.frames_ms)}.",
        ]
    if render.out_of_memory:
        held = f" Other programs held {busy_mb:,} MB of the GPU when the check began." if busy_mb else ""
        return [f"{step}: FAILED, out of GPU memory.{held} The end of its log:", *[f"   | {line}" for line in render.tail[-4:]]]
    return [f"{step}: FAILED. The end of its log:", *[f"   | {line}" for line in render.tail[-15:]]]


# --- Step 3: the live stream ------------------------------------------------


@dataclass
class Live:
    minutes: float
    audio_seconds: float = 0.0
    steers: int = 0
    choice_changes: int = 0
    chords: int = 0
    grooves_saved: int = 0
    groove_recalls: int = 0
    continues_sent: int = 0
    continued: int = 0
    restarts: int = 0
    started: int = 0
    revived: int = 0
    silent_at: list[float] = field(default_factory=list)
    frame_ms: list[float] = field(default_factory=list)
    rates: list[float] = field(default_factory=list)
    engine_allocated: list[tuple[float, int]] = field(default_factory=list)
    engine_reserved: list[tuple[float, int]] = field(default_factory=list)
    gpu_memory: list[tuple[float, int]] = field(default_factory=list)
    actions: list[tuple[float, str]] = field(default_factory=list)
    timeline: list[tuple[float, str]] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)
    health: dict[str, Any] = field(default_factory=dict)
    begin: float | None = None
    finished: bool = False

    def now(self) -> float:
        return 0.0 if self.begin is None else time.perf_counter() - self.begin

    def act(self, what: str) -> None:
        self.actions.append((self.now(), what))
        self.timeline.append((self.now(), what))

    def problem(self, what: str) -> None:
        t = self.now()
        cause = next(
            (f" ({t - at:.0f} s after: {action})" for at, action in reversed(self.actions) if t - at <= CAUSE_WINDOW),
            "",
        )
        self.problems.append(f"{clock(t)} {what}{cause}")
        self.timeline.append((t, f"ENGINE: {what}"))


def http_json(path: str, data: bytes | None = None, timeout: float = 30) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        method="POST" if data is not None else "GET",
        headers={"Content-Type": "application/octet-stream"} if data is not None else {},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fader_weights(t: float) -> list[dict[str, Any]]:
    return [
        {"text": text, "weight": round(0.15 + 0.85 * (0.5 + 0.5 * math.sin(2 * math.pi * t / period + phase)), 3)}
        for text, period, phase in FADERS
    ]


class Tape:
    """The last KEEP_SECONDS of the stream, and when it went silent."""

    def __init__(self) -> None:
        self.chunks: deque[np.ndarray] = deque()
        self.frames = 0
        self.pending: list[np.ndarray] = []
        self.pending_frames = 0

    def add(self, pcm: np.ndarray, live: Live) -> None:
        self.chunks.append(pcm)
        self.frames += pcm.shape[0]
        while self.chunks and self.frames - self.chunks[0].shape[0] >= KEEP_SECONDS * RATE:
            self.frames -= self.chunks.popleft().shape[0]
        self.pending.append(pcm)
        self.pending_frames += pcm.shape[0]
        if self.pending_frames >= RATE:
            second = np.concatenate(self.pending).astype(np.float32) / 32767.0
            if float(np.sqrt(np.mean(np.square(second)))) < SILENT_RMS:
                live.silent_at.append(live.now())
                live.timeline.append((live.now(), "ENGINE: a second of digital silence"))
            self.pending, self.pending_frames = [], 0

    def last(self, seconds: float) -> np.ndarray:
        if not self.chunks:
            return np.zeros((0, 2), np.int16)
        audio = np.concatenate(list(self.chunks))
        return audio[-int(seconds * RATE) :]


def write_wav(path: Path, pcm: np.ndarray) -> None:
    with wave.open(str(path), "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(pcm.astype("<i2").tobytes())


def handle_event(event: dict[str, Any], live: Live, started: asyncio.Event, stopped: asyncio.Event, failed: asyncio.Event) -> None:
    kind = event.get("type")
    if kind == "status":
        say(f"    engine: {event.get('message')}")
    elif kind == "started":
        live.started += 1
        live.timeline.append((live.now(), "ENGINE: started"))
        started.set()
    elif kind == "stats":
        live.frame_ms.append(float(event.get("msPerFrame", 0.0)))
    elif kind == "continued":
        live.continued += 1
        live.timeline.append((live.now(), f"ENGINE: continued, picking up {event.get('pickup')} s before the clip's end"))
    elif kind == "continue-failed":
        live.problem(f"continue failed: {event.get('message')}")
    elif kind == "forgotten":
        live.problem(f"groove {event.get('slot')} was forgotten")
    elif kind == "remembered":
        live.timeline.append((live.now(), f"ENGINE: remembered {event.get('slot')}"))
    elif kind == "revived":
        live.revived += 1
        live.problem("the model fell silent and the watchdog revived it")
    elif kind == "error":
        live.problem(f"engine error: {event.get('message')}")
        failed.set()
    elif kind == "stopped":
        stopped.set()


async def sample_memory(live: Live, smi: str | None, t: float) -> tuple[str, str]:
    engine = "engine memory unknown"
    try:
        health = await asyncio.to_thread(http_json, "/health", None, 5)
    except (OSError, urllib.error.URLError, ValueError):
        health = {}
    memory = health.get("cuda_memory")
    if isinstance(memory, dict):
        live.engine_allocated.append((t, int(memory["allocated_mb"])))
        live.engine_reserved.append((t, int(memory["reserved_mb"])))
        engine = f"engine {memory['allocated_mb']:,} MB"
    used = await asyncio.to_thread(gpu_used_mb, smi)
    whole = "GPU unknown"
    if used is not None:
        live.gpu_memory.append((t, used))
        whole = f"GPU {used:,} MB"
    return engine, whole


async def live_stream(minutes: float, smi: str | None, out_dir: Path) -> Live:
    from websockets.asyncio.client import connect

    live = Live(minutes)
    tape = Tape()
    started = asyncio.Event()
    stopped = asyncio.Event()
    failed = asyncio.Event()
    spec: dict[str, Any] = {
        "prompts": fader_weights(0.0),
        "temperature": 1.05,
        "top_k": 48,
        "seed": 1,
        "drums": "auto",
        "style_levels": 6,
    }

    # A continue's lead-in arrives as one message of up to 8 s, past the 1 MiB default.
    async with connect(f"ws://127.0.0.1:{PORT}/ws/stream", max_size=None, ping_interval=None) as ws:

        async def receive() -> None:
            async for message in ws:
                if isinstance(message, bytes):
                    pcm = np.frombuffer(message, "<i2").reshape(-1, 2)
                    live.audio_seconds += pcm.shape[0] / RATE
                    tape.add(pcm, live)
                else:
                    handle_event(json.loads(message), live, started, stopped, failed)

        receiver = asyncio.create_task(receive())
        await ws.send(json.dumps({"op": "start", **spec}))
        say("    loading the model and capturing the CUDA graph...")
        deadline = time.perf_counter() + 900
        while not started.is_set():
            if failed.is_set() or receiver.done() or time.perf_counter() > deadline:
                reason = "; ".join(live.problems) or "the engine never started streaming"
                raise RuntimeError(reason)
            await asyncio.sleep(0.5)
        try:
            live.health = await asyncio.to_thread(http_json, "/health")
        except (OSError, urllib.error.URLError, ValueError) as exc:
            live.problems.append(f"/health failed: {exc}")

        duration = minutes * 60.0
        live.begin = time.perf_counter()
        last_second = -1
        last_audio = 0.0
        tick = 1.0 / STEERS_PER_SECOND
        while True:
            t = live.now()
            if t >= duration or receiver.done():
                break
            extra: dict[str, Any] = {}
            op = "steer"
            second = int(t)
            if second != last_second:
                last_second = second
                if second and second % 30 == 0:
                    spec["top_k"] = CHOICES[(second // 30) % len(CHOICES)]
                    spec["seed"] += 1
                    live.choice_changes += 1
                    live.act(f"choices {spec['top_k']}, seed {spec['seed']}")
                if second % 20 == 10:
                    spec["notes"] = [3 if pitch in CHORD else 0 for pitch in range(128)]
                    spec["onsets"] = True
                    live.chords += 1
                    live.act("chord on")
                elif second % 20 == 15:
                    spec.pop("notes", None)
                    spec.pop("onsets", None)
                    live.act("chord off")
                if second % 120 == 45:
                    await ws.send(json.dumps({"op": "remember", "slot": "scene-1"}))
                    live.grooves_saved += 1
                    live.act("save groove scene-1")
                elif second >= 75 and second % 60 == 15:
                    extra = {"groove": "scene-1", "cut": True}
                    live.groove_recalls += 1
                    live.act("recall groove scene-1 with a cut")
                if second in (150, 450):
                    clip = tape.last(CLIP_SECONDS)
                    if clip.shape[0] >= 5 * RATE:
                        body = (clip.astype(np.float32) / 32767.0).reshape(-1).tobytes()
                        try:
                            stored = await asyncio.to_thread(http_json, "/clip", body)
                        except (OSError, urllib.error.URLError, ValueError) as exc:
                            live.problem(f"uploading a clip failed: {exc}")
                        else:
                            extra = {"continue": stored["id"], "lead": 2}
                            live.continues_sent += 1
                            live.act(f"continue from the stream's last {CLIP_SECONDS} s")
                if second == 300:
                    op = "restart"
                    live.restarts += 1
                    live.act("restart")
                if second % 10 == 0 and second:
                    engine, whole = await sample_memory(live, smi, t)
                    rate = (live.audio_seconds - last_audio) / 10.0
                    last_audio = live.audio_seconds
                    live.rates.append(rate)
                    frame = f"{live.frame_ms[-1]:.1f} ms per frame" if live.frame_ms else "no frame times yet"
                    live.timeline.append((t, f"memory: {engine}, {whole}; {frame}"))
                    say(f"    [{clock(t)} / {clock(duration)}]  {engine}  |  {whole}  |  {frame}  |  {live.steers} steers")
            spec["prompts"] = fader_weights(t)
            await ws.send(json.dumps({"op": op, **spec, **extra}))
            live.steers += 1
            await asyncio.sleep(tick)

        if receiver.done():
            reason = receiver.exception() or "the engine closed it"
            live.problem(f"the stream closed early: {reason}")
        else:
            await ws.send(json.dumps({"op": "stop"}))
            try:
                await asyncio.wait_for(stopped.wait(), timeout=10)
            except asyncio.TimeoutError:
                live.problem("the engine did not confirm the stop")
            live.finished = live.now() >= duration
        receiver.cancel()
    write_wav(out_dir / "live-last-30s.wav", tape.last(KEEP_SECONDS))
    timeline = "\n".join(f"{clock(t)}  {what}" for t, what in sorted(live.timeline, key=lambda item: item[0]))
    (out_dir / "3-timeline.txt").write_text(timeline + "\n", encoding="utf-8")
    return live


def start_server(log_path: Path) -> tuple[subprocess.Popen[bytes], Any]:
    log = log_path.open("wb")
    proc = subprocess.Popen(
        [sys.executable, "server.py"],
        cwd=ENGINE,
        env=child_env(),
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    deadline = time.time() + 180
    while time.time() < deadline:
        if proc.poll() is not None:
            break
        try:
            http_json("/health", timeout=2)
            return proc, log
        except (OSError, urllib.error.URLError, ValueError):
            time.sleep(1)
    stop_server(proc, log)
    raise RuntimeError(f"the engine did not start. See {log_path}")


def stop_server(proc: subprocess.Popen[bytes], log: Any) -> None:
    if proc.poll() is None:
        try:
            http_json("/shutdown", b"", timeout=5)
        except (OSError, urllib.error.URLError, ValueError):
            pass
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            kill_tree(proc)
    log.close()


def kill_tree(proc: subprocess.Popen[bytes]) -> None:
    """The venv's python.exe starts the real interpreter as a child, which holds the GPU."""
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, check=False)
    else:
        proc.kill()
    proc.wait(timeout=10)


# --- Report -----------------------------------------------------------------


def memory_lines(live: Live, idle_mb: int | None) -> list[str]:
    lines: list[str] = []
    steady: bool | None = None
    if live.engine_allocated:
        allocated = settled(live.engine_allocated)
        reserved = settled(live.engine_reserved)
        a0, a1, grew = net_growth(allocated)
        r0, r1, kept = net_growth(reserved)
        steady = grew < ENGINE_GROWTH_LIMIT_MB
        lines.append(
            f"   Engine GPU memory: {'STEADY' if steady else 'GROWING'}. Its tensors held {a0:,} MB at "
            f"{clock(allocated[0][0])} and {a1:,} MB at the end ({grew:+,} MB). PyTorch kept {r0:,} MB, then "
            f"{r1:,} MB ({kept:+,} MB), {max(mb for _, mb in live.engine_reserved):,} MB at most."
        )
    if live.gpu_memory:
        whole = settled(live.gpu_memory)
        g0, g1, change = net_growth(whole)
        recent = [(t, mb) for t, mb in live.gpu_memory if t >= live.gpu_memory[-1][0] - 240]
        label = "   Whole GPU, every program"
        if steady is None:
            steady = change < GPU_GROWTH_LIMIT_MB
            label = f"   GPU memory (whole GPU, since this engine does not report its own): {'STEADY' if steady else 'GROWING'}"
        lines.append(
            f"{label}: {g0:,} MB at {clock(whole[0][0])}, {g1:,} MB at the end ({change:+,} MB), "
            f"{max(mb for _, mb in live.gpu_memory):,} MB at most, {slope_mb_per_min(recent):+.0f} MB per minute "
            "over the last 4 minutes."
        )
    if idle_mb is not None:
        lines.append(f"   Before the engine started, other programs held {idle_mb:,} MB of the GPU.")
    if steady is None:
        return ["   GPU memory: not measured (no /health memory and no nvidia-smi)."]
    if not steady:
        lines.append("   Memory that keeps climbing is a leak. Send me this report, 3-timeline.txt and 3-server.log.")
    return lines


def live_lines(live: Live | None, error: str | None, idle_mb: int | None) -> list[str]:
    if live is None:
        return [f"3. Live stream: FAILED. {error}"]
    rates = live.rates[1:] or live.rates
    rate = float(np.median(rates)) if rates else 0.0
    frames = np.array(live.frame_ms) if live.frame_ms else np.array([0.0])
    typical = float(np.median(frames))
    speed = REALTIME_FRAME_MS / typical if typical > 0 else 0.0
    health = live.health
    silent = ", ".join(clock(t) for t in live.silent_at[:8]) + (" ..." if len(live.silent_at) > 8 else "")
    lines = [
        f"3. Live stream for {live.minutes:g} min: {'finished' if live.finished else 'STOPPED EARLY'}.",
        (
            f"   Steering: {live.steers:,} fader moves, {live.choice_changes} choice and seed changes, "
            f"{live.chords} chords, {live.grooves_saved} grooves saved, {live.groove_recalls} recalled, "
            f"{live.continued} of {live.continues_sent} continues done, "
            f"{live.restarts} restart{'' if live.restarts == 1 else 's'}."
        ),
        (
            f"   Speed: {typical:.1f} ms per {REALTIME_FRAME_MS:.0f} ms frame typical, {frames.max():.1f} ms slowest, "
            f"so the engine runs at {speed:.2f}x real time while it is steered (about {OLD_SPEED:.2f}x before)."
        ),
        (
            f"   Pace: the stream arrived at {rate:.2f}x real time. The engine stays about 1 s ahead, "
            "so this tops out near 1.00x."
        ),
        *memory_lines(live, idle_mb),
        (
            f"   Silent seconds: {len(live.silent_at)}{f' (at {silent})' if silent else ''}. "
            f"Watchdog revivals: {live.revived}."
        ),
        (
            f"   Text mapper: {health.get('text_mapper', '?')}. "
            f"Continue from audio: {health.get('clip_encoder', '?')}. GPU: {health.get('gpu', '?')}."
        ),
    ]
    if live.problems:
        lines.append("   Events to look at (3-timeline.txt has everything):")
        lines.extend(f"   - {problem}" for problem in live.problems[:20])
    else:
        lines.append("   No errors from the engine.")
    return lines


def preflight(smi: str | None, total_mb: int) -> tuple[int | None, list[str]]:
    """Other programs' share of the GPU before anything starts, and the CUDA ones by name."""
    while True:
        used = gpu_used_mb(smi)
        programs = gpu_programs(smi)
        if used is None or used <= BUSY_MB:
            return used, programs
        say(f"Other programs already hold {used:,} MB of the GPU's {total_mb:,} MB. The model needs several GB,")
        say("so the first step can run out of memory. Close what you can, such as games, LM Studio, Ollama,")
        say("ComfyUI or a second Magenta.")
        if programs:
            say("Programs using CUDA right now: " + "; ".join(programs))
        answer = input("Press Enter to check again, or type go and press Enter to run anyway: ")
        if answer.strip().lower() == "go":
            return used, programs


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check Magenta's speed, continue, and memory on this GPU.")
    parser.add_argument("--minutes", type=float, default=10.0, help="Length of the live stream test.")
    parser.add_argument("--skip-generate", action="store_true", help="Run only the live stream test.")
    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")  # engine output can hold characters the console lacks

    # Absolute, because magenta generate runs from the engine folder.
    out_dir = (ENGINE / "logs" / "gpu-check" / datetime.now().astimezone().strftime("%Y-%m-%d_%H-%M-%S")).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    smi = find_nvidia_smi()
    gpus = query_gpus(smi, "name,driver_version,memory.total")
    gpu_text = "; ".join(f"{row[0]} (driver {row[1]}, {int(float(row[2])):,} MB)" for row in gpus if len(row) >= 3)
    total_mb = sum(int(float(row[2])) for row in gpus if len(row) >= 3)

    say("Magenta GPU check")
    say(f"  GPU: {gpu_text or 'unknown, nvidia-smi was not found'}")
    say(f"  Results: {out_dir}")
    say(f"  This takes about {args.minutes + 5:.0f} minutes.")
    say()
    while port_open():
        say("The Magenta window (or another engine) is running on port 8765 and holds the GPU.")
        input("Close it, then press Enter to go on. ")
    busy_mb, programs = preflight(smi, total_mb)

    report = [f"Magenta GPU check, {datetime.now().astimezone():%Y-%m-%d %H:%M}", f"GPU: {gpu_text or 'unknown'}"]
    if busy_mb is not None:
        report.append(f"Other programs held {busy_mb:,} MB of the GPU when the check began.")
    if programs:
        report.append("Programs using CUDA then: " + "; ".join(programs))
    report.append("")
    techno = out_dir / "techno.wav"
    if not args.skip_generate:
        say("1/3  Speed: 20 s of techno with magenta generate")
        first = run_generate(
            "speed",
            [sys.executable, "-m", "magenta_win.cli", "generate", "--prompt", "techno", "--seconds", "20", "--out", str(techno)],
            out_dir / "1-generate.log",
        )
        report += generate_lines("1. Speed", first, busy_mb)
        say()
        say("2/3  Continue from a clip: carry techno.wav on for 10 s")
        if techno.is_file():
            second = run_generate(
                "continue",
                [
                    sys.executable, "-m", "magenta_win.cli", "generate", "--continue", str(techno),
                    "--prompt", "techno", "--seconds", "10", "--out", str(out_dir / "continue.wav"),
                ],
                out_dir / "2-continue.log",
            )
            report += generate_lines("2. Continue from a clip", second, busy_mb)
        else:
            report.append("2. Continue from a clip: skipped, because step 1 wrote no techno.wav.")
        say()

    say(f"3/3  Live stream: {args.minutes:g} minutes of steering, the way the window plays")
    idle_mb = gpu_used_mb(smi)
    live: Live | None = None
    error: str | None = None
    try:
        proc, log = start_server(out_dir / "3-server.log")
    except RuntimeError as exc:
        error = str(exc)
    else:
        try:
            live = asyncio.run(live_stream(args.minutes, smi, out_dir))
        except Exception as exc:  # noqa: BLE001 - report any failure, then shut the engine down
            error = f"{type(exc).__name__}: {exc}. See 3-server.log."
        finally:
            stop_server(proc, log)
    report += live_lines(live, error, idle_mb)
    report += [
        "",
        "Listen: techno.wav, continue.wav (it starts 4 s before the join) and live-last-30s.wav.",
        f"Folder: {out_dir}",
    ]

    text = "\n".join(report) + "\n"
    (out_dir / "report.txt").write_text(text, encoding="utf-8")
    say()
    say("=" * 72)
    say(text)
    say("Send me report.txt from that folder, plus 3-timeline.txt and 3-server.log if anything failed.")
    if sys.platform == "win32":
        os.startfile(out_dir)  # open the results for the person who double-clicked
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        say("\nStopped.")
        raise SystemExit(130) from None
