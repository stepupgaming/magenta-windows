"""Magenta command line. Importing this module does not import PyTorch."""

from __future__ import annotations

import argparse
import json
import math
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

# The server's drum modes, kept here so --help never imports PyTorch.
DRUM_MODES = ("auto", "on", "off")


class HelpFormatter(argparse.ArgumentDefaultsHelpFormatter, argparse.RawDescriptionHelpFormatter):
    pass


def engine_root() -> Path:
    here = Path(__file__).resolve().parent.parent
    if (here / "server.py").is_file():
        return here
    cwd = Path.cwd()
    starts = [cwd, *cwd.parents]
    for start in starts:
        if (start / "engine" / "server.py").is_file():
            return start / "engine"
        if (start / "server.py").is_file() and (start / "model_code").is_dir():
            return start
    raise SystemExit("magenta could not find engine/server.py. Run it from the magenta-windows checkout.")


def prepare_import() -> None:
    root = str(engine_root())
    if root not in sys.path:
        sys.path.insert(0, root)


def default_port() -> int:
    raw = os.environ.get("MAGENTA_PORT", "8765")
    try:
        return int(raw)
    except ValueError:
        return 8765


def port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), 0.3):
            return True
    except OSError:
        return False


def split_prompt(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if not text:
        raise SystemExit("A --prompt value is empty.")
    head, sep, tail = text.rpartition(":")
    weight = 1.0
    if sep:
        try:
            weight = float(tail)
        except ValueError:
            head = text
        else:
            text = head.strip()
            if not text:
                raise SystemExit(f"Prompt text is missing: {raw}")
            if not math.isfinite(weight) or weight < 0:
                raise SystemExit(f"Prompt weight must be zero or higher: {raw}")
    if len(text) > 180:
        raise SystemExit("Each prompt is limited to 180 characters.")
    return {"text": text, "weight": weight}


def held_notes(midis: list[int]) -> list[int] | None:
    if not midis:
        return None
    notes = [-1] * 128
    for midi in midis:
        if midi < 0 or midi > 127:
            raise SystemExit(f"--note must be a MIDI number from 0 to 127. Got {midi}.")
        notes[midi] = 1
    return notes


def require_range(name: str, value: float, low: float, high: float) -> None:
    if not math.isfinite(value) or value < low or value > high:
        raise SystemExit(f"{name} must be between {low} and {high}.")


def build_spec(args: argparse.Namespace) -> dict[str, Any]:
    prompts = [split_prompt(item) for item in args.prompt]
    if not prompts:
        raise SystemExit("Pass at least one --prompt.")
    if len(prompts) > 8:
        raise SystemExit("A render takes at most 8 prompts.")
    if sum(float(item["weight"]) for item in prompts) <= 0:
        raise SystemExit("At least one prompt weight has to be above zero.")
    require_range("seconds", float(args.seconds), 0.01, 120)
    require_range("temperature", float(args.temperature), 0.2, 2)
    require_range("top-k", float(args.top_k), 1, 256)
    require_range("style", float(args.style), 0, 6)
    require_range("style-detail", float(args.style_detail), 1, 12)
    require_range("note-strength", float(args.note_strength), 0, 6)
    require_range("drum-strength", float(args.drum_strength), 0, 4)
    return {
        "prompts": prompts,
        "temperature": float(args.temperature),
        "top_k": int(args.top_k),
        "cfg_musiccoca": float(args.style),
        "cfg_notes": float(args.note_strength),
        "cfg_drums": float(args.drum_strength),
        "notes": held_notes(list(args.note)),
        "drums": args.drums,
        "seed": int(args.seed),
        "style_levels": int(args.style_detail),
    }


def http_json(port: int, method: str, path: str, timeout: float) -> dict[str, Any]:
    url = f"http://127.0.0.1:{port}{path}"
    data = b"" if method == "POST" else None
    request = urllib.request.Request(url, data=data, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except urllib.error.URLError as exc:
        raise SystemExit(f"No Magenta server on 127.0.0.1:{port}.\nStart one with: magenta serve") from exc
    payload = json.loads(body)
    if not isinstance(payload, dict):
        raise SystemExit("The server returned a response that was not an object.")
    return payload


def print_health(payload: dict[str, Any]) -> None:
    keys = (
        "ok",
        "backend",
        "model_loaded",
        "error",
        "gpu",
        "sample_rate",
        "text_mapper",
        "text_mapper_detail",
        "clip_encoder",
        "clip_encoder_detail",
    )
    for key in keys:
        if key in payload:
            print(f"{key}: {payload[key]}")


def cmd_serve(args: argparse.Namespace) -> int:
    if port_open(args.port):
        raise SystemExit(f"Something is already listening on 127.0.0.1:{args.port}.")
    prepare_import()
    from server import serve

    serve(args.port)
    return 0


def cmd_health(args: argparse.Namespace) -> int:
    print_health(http_json(args.port, "GET", "/health", timeout=5))
    return 0


def cmd_load(args: argparse.Namespace) -> int:
    print("Loading the checkpoint into the running server. The first load downloads about 10 GB when the cache is empty.")
    print_health(http_json(args.port, "POST", "/load", timeout=3600))
    print("The model stays on the GPU until you run: magenta stop")
    return 0


def cmd_stop(args: argparse.Namespace) -> int:
    if not port_open(args.port):
        print(f"No Magenta server on 127.0.0.1:{args.port}.")
        return 0
    try:
        http_json(args.port, "POST", "/shutdown", timeout=5)
    except SystemExit:
        if port_open(args.port):
            raise
    for _ in range(25):
        if not port_open(args.port):
            print("Server stopped.")
            return 0
        time.sleep(0.2)
    raise SystemExit("The server accepted shutdown and was still listening.")


def cmd_generate(args: argparse.Namespace) -> int:
    if port_open(args.port):
        raise SystemExit(
            f"A server is already listening on 127.0.0.1:{args.port}.\n"
            "Stop it with: magenta stop\n"
            "generate loads the checkpoint in this process. A second copy fills the GPU."
        )
    spec = build_spec(args)
    clip = None
    if args.continue_from:
        from magenta_win.clip_audio import load_clip

        clip = load_clip(Path(args.continue_from))
        if clip.shape[0] < 4 * 48_000:
            raise SystemExit("--continue needs at least 4 seconds of audio.")
    prepare_import()
    from server import render

    render(spec, float(args.seconds), Path(args.out), continue_clip=clip, lead_in=float(args.lead_in))
    return 0


def add_port(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--port",
        type=int,
        default=default_port(),
        help="Local server port. MAGENTA_PORT is the default when the flag is omitted.",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="magenta",
        description=(
            "Magenta RealTime 2 on Windows. serve starts the CUDA server with the model unloaded. "
            "load and generate put the checkpoint on the GPU."
        ),
        formatter_class=HelpFormatter,
        epilog=(
            "examples:\n"
            "  magenta serve\n"
            "  magenta health\n"
            "  magenta load\n"
            "  magenta generate --prompt \"soothing chords\" --prompt \"dusty breakbeat:0.4\" --seconds 8 --out take.wav\n"
            "  magenta stop"
        ),
    )
    commands = parser.add_subparsers(dest="command", required=True)

    serve = commands.add_parser(
        "serve",
        help="Start the local CUDA server. The model stays unloaded.",
        description="Listen on 127.0.0.1. The window can use this server. The checkpoint stays unloaded until load.",
        formatter_class=HelpFormatter,
    )
    add_port(serve)
    serve.set_defaults(func=cmd_serve)

    health = commands.add_parser(
        "health",
        help="Print whether the server is up and whether the model is loaded.",
        formatter_class=HelpFormatter,
    )
    add_port(health)
    health.set_defaults(func=cmd_health)

    load = commands.add_parser(
        "load",
        help="Load the checkpoint into a running server and leave it on the GPU.",
        description=(
            "POST /load on the running server. The first load downloads magenta-community/magenta-realtime-2 "
            "and magenta-torch/magenta-rt-musiccoca-torch when those snapshots are missing. "
            "The model stays resident until magenta stop."
        ),
        formatter_class=HelpFormatter,
    )
    add_port(load)
    load.set_defaults(func=cmd_load)

    stop = commands.add_parser(
        "stop",
        help="Tell the local server to exit and free the GPU.",
        formatter_class=HelpFormatter,
    )
    add_port(stop)
    stop.set_defaults(func=cmd_stop)

    generate = commands.add_parser(
        "generate",
        help="Render one wav in this process, then exit and free the GPU.",
        description=(
            "Loads the checkpoint, captures the CUDA graph, writes a wav, and exits. "
            "Refuses to start when --port is already open. "
            "The first run downloads about 10 GB when the cache is empty. "
            "--top-k is fixed for the whole file. Each --note is held for the whole file."
        ),
        formatter_class=HelpFormatter,
    )
    generate.add_argument(
        "--prompt",
        action="append",
        default=[],
        metavar="TEXT[:WEIGHT]",
        help="Prompt line. Repeat up to 8 times. Weight defaults to 1. Example: \"rain on a tin roof:0.4\".",
    )
    generate.add_argument("--seconds", type=float, required=True, help="Length of the wav, from 0.01 to 120.")
    generate.add_argument("--out", default="magenta.wav", help="Wav path to write.")
    generate.add_argument("--temperature", type=float, default=1.05, help="Sampling temperature, from 0.2 to 2.")
    generate.add_argument("--top-k", dest="top_k", type=int, default=48, help="How many token choices are kept, from 1 to 256.")
    generate.add_argument("--style", type=float, default=2.4, help="How hard the text prompts steer, from 0 to 6.")
    generate.add_argument(
        "--style-detail",
        dest="style_detail",
        type=int,
        default=12,
        help="How many of the 12 style tokens steer, coarsest first, from 1 to 12. Fewer follows the prompt more loosely.",
    )
    generate.add_argument("--note-strength", type=float, default=0.8, help="How hard held notes steer, from 0 to 6.")
    generate.add_argument(
        "--drums",
        nargs="?",
        const="on",
        default="auto",
        choices=DRUM_MODES,
        help="auto lets the model decide, as the window does; on asks for drums (a bare --drums), off asks for none.",
    )
    generate.add_argument("--drum-strength", type=float, default=1.0, help="Drum steer, from 0 to 4.")
    generate.add_argument("--note", action="append", type=int, default=[], help="MIDI note held for the whole file, from 0 to 127. Repeat to stack notes.")
    generate.add_argument("--seed", type=int, default=7, help="Sampler seed.")
    generate.add_argument(
        "--continue",
        dest="continue_from",
        metavar="AUDIO",
        help="Continue this audio file (wav, flac, ogg) from its end. The last 28 s are heard.",
    )
    generate.add_argument(
        "--lead-in",
        dest="lead_in",
        type=float,
        default=4.0,
        help="With --continue, seconds of the clip to keep before the continuation, as the codec decodes them.",
    )
    add_port(generate)
    generate.set_defaults(func=cmd_generate)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
