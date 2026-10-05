"""A/B the engine on this GPU: the v0.1.1 engine against today's, same prompt and seeds.

ab-check.bat runs this with engine\\.venv. It checks v0.1.1 out into a temporary
git worktree under engine/logs/ab-check/<time>/, renders each variant with
magenta generate, removes the worktree, and writes report.txt with each file's
level and tonal balance. Every variant runs on the same seeds:

  old     the v0.1.1 engine: no text mapper, all 12 style tokens, a 27-frame
          attention window, and the code from before the speed work.
  as-old  today's engine with v0.1.1's prompt handling (MAGENTA_TEXT_MAPPER=off),
          so only the engine's own changes differ.
  new     today's engine as it ships: Google's text mapper and all 12 style tokens.

Every variant gets the same drums: auto by default, which lets the model decide.

Old and new sample differently, so a seed does not give the same music in both.
Compare the sound across seeds, not note for note.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from itertools import pairwise
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gpu_check import (
    ENGINE,
    ROOT,
    find_nvidia_smi,
    port_open,
    preflight,
    query_gpus,
    run_generate,
    say,
)

OLD_TAG = "v0.1.1"
SEEDS = (7, 11, 23)
BAND_EDGES = (20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480)
BAND_NAMES = ("20", "40", "80", "160", "320", "640", "1.3k", "2.6k", "5.1k", "10k")
# Bands from 1.3 kHz up carry hats, snares, and the edge of synths.
UPPER_BANDS = slice(6, 10)
CLEAR_DIFFERENCE_DB = 6.0


@dataclass
class Variant:
    name: str
    engine: Path
    flags: tuple[str, ...] = ()
    env: dict[str, str] | None = None


@dataclass
class Sound:
    level: float
    peak: float
    clipped: float
    bands: list[float]

    @property
    def upper(self) -> float:
        return float(np.mean(self.bands[UPPER_BANDS]))


def analyze(path: Path) -> Sound:
    import soundfile as sf

    audio, rate = sf.read(str(path), always_2d=True)
    mono = audio.mean(axis=1)
    power = np.abs(np.fft.rfft(mono * np.hanning(len(mono)))) ** 2
    freqs = np.fft.rfftfreq(len(mono), 1 / rate)
    bands = [
        10 * np.log10(np.sum(power[(freqs >= lo) & (freqs < hi)]) + 1e-20)
        for lo, hi in pairwise(BAND_EDGES)
    ]
    top = max(bands)
    return Sound(
        level=float(20 * np.log10(np.sqrt(np.mean(audio**2)) + 1e-12)),
        peak=float(20 * np.log10(np.abs(audio).max() + 1e-12)),
        clipped=float(np.mean(np.abs(audio) >= 0.999) * 100),
        bands=[round(band - top, 1) for band in bands],
    )


def git(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True, check=False)


def checkout_old(dest: Path) -> Path | None:
    """v0.1.1's engine in a worktree. It runs with this checkout's venv: no
    dependency changed since then."""
    try:
        git("fetch", "--quiet", "--tags", "origin")
        added = git("worktree", "add", "--detach", "--force", str(dest), OLD_TAG)
    except OSError:
        say("    git was not found, so the old engine is skipped.")
        return None
    if added.returncode != 0:
        say(f"    Could not check out {OLD_TAG}: {added.stderr.strip()}")
        return None
    return dest / "engine"


def remove_old(dest: Path) -> None:
    try:
        git("worktree", "remove", "--force", str(dest))
        git("worktree", "prune")
    except OSError:
        pass


def compare(sounds: dict[str, list[Sound]], first: str, second: str, cause: str) -> str:
    if not sounds.get(first) or not sounds.get(second):
        return f"   {second} vs {first}: not compared, one side has no files."
    a = float(np.median([sound.upper for sound in sounds[first]]))
    b = float(np.median([sound.upper for sound in sounds[second]]))
    change = b - a
    if abs(change) < CLEAR_DIFFERENCE_DB:
        verdict = "about the same brightness"
    elif change < 0:
        verdict = "clearly DARKER"
    else:
        verdict = "clearly BRIGHTER"
    return (
        f"   {second} vs {first}: {verdict} ({change:+.1f} dB above 1.3 kHz, medians {b:.1f} vs {a:.1f} dB). "
        f"This difference comes from {cause}."
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render the same prompt with the v0.1.1 engine and today's.")
    parser.add_argument("--prompt", action="append", default=[], help='Prompt, repeatable. Default: "techno".')
    parser.add_argument("--seconds", type=float, default=20.0)
    parser.add_argument("--seeds", type=int, nargs="+", default=list(SEEDS))
    parser.add_argument(
        "--drums",
        choices=("auto", "off"),
        default="auto",
        help="auto lets the model decide, as generate and the window now do; off asks for none, v0.1.1's generate default.",
    )
    args = parser.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    prompts = args.prompt or ["techno"]

    out_dir = (ENGINE / "logs" / "ab-check" / datetime.now().astimezone().strftime("%Y-%m-%d_%H-%M-%S")).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    smi = find_nvidia_smi()
    gpus = query_gpus(smi, "name,driver_version,memory.total")
    total_mb = sum(int(float(row[2])) for row in gpus if len(row) >= 3)
    say("Magenta A/B: the v0.1.1 engine against today's")
    say(f"  Prompt: {' + '.join(prompts)}, {args.seconds:g} s, seeds {', '.join(map(str, args.seeds))}")
    say(f"  Results: {out_dir}")
    say(f"  This makes {3 * len(args.seeds)} files and takes about {3 * len(args.seeds)} minutes.")
    say()
    while port_open():
        say("The Magenta window (or another engine) is running on port 8765 and holds the GPU.")
        input("Close it, then press Enter to go on. ")
    preflight(smi, total_mb)

    worktree = out_dir / "v0.1.1"
    old_engine = checkout_old(worktree)
    # The same drums for every engine: v0.1.1 took a bare --drums as "let the
    # model decide" and used no drum strength without it.
    if args.drums == "auto":
        old_drums: tuple[str, ...] = ("--drums",)
        new_drums: tuple[str, ...] = ("--drums", "auto")
    else:
        old_drums = ()
        new_drums = ("--drums", "off", "--drum-strength", "0")
    variants = [
        Variant("as-old", ENGINE, ("--style-detail", "12", *new_drums), {"MAGENTA_TEXT_MAPPER": "off"}),
        Variant("new", ENGINE, new_drums),
    ]
    if old_engine is not None:
        variants.insert(0, Variant("old", old_engine, old_drums))

    base = [flag for prompt in prompts for flag in ("--prompt", prompt)]
    base += ["--seconds", f"{args.seconds:g}"]
    sounds: dict[str, list[Sound]] = {}
    rows: list[str] = []
    try:
        for seed in args.seeds:
            for variant in variants:
                wav = out_dir / f"seed{seed}-{variant.name}.wav"
                say(f"  seed {seed}, {variant.name}")
                render = run_generate(
                    variant.name,
                    [sys.executable, "-m", "magenta_win.cli", "generate", *base, *variant.flags,
                     "--seed", str(seed), "--out", str(wav)],
                    out_dir / f"seed{seed}-{variant.name}.log",
                    engine=variant.engine,
                    extra_env=variant.env,
                )
                if not render.ok or not wav.is_file():
                    rows.append(f"   {wav.name:24s} FAILED, see {wav.with_suffix('.log').name}")
                    continue
                sound = analyze(wav)
                sounds.setdefault(variant.name, []).append(sound)
                bands = " ".join(f"{band:5.0f}" for band in sound.bands)
                rows.append(
                    f"   {wav.name:24s} {sound.level:6.1f} {sound.peak:6.1f} {sound.clipped:6.3f}  {bands}"
                    f"   speed {render.speed:.2f}x"
                )
    finally:
        if old_engine is not None:
            remove_old(worktree)

    header = " ".join(f"{name:>5s}" for name in BAND_NAMES)
    report = [
        f"Magenta A/B, {datetime.now().astimezone():%Y-%m-%d %H:%M}",
        f"Prompt: {' + '.join(prompts)}, {args.seconds:g} s, drums {args.drums}",
        "",
        "old = v0.1.1 engine. as-old = today's engine with v0.1.1's prompt handling. new = today's engine.",
        "Bands are dB below each file's loudest octave. Level and peak are dBFS.",
        "",
        f"   {'file':24s} {'level':>6s} {'peak':>6s} {'clip%':>6s}  {header}",
        *rows,
        "",
        "Brightness, the median over seeds of the bands from 1.3 kHz up:",
        compare(sounds, "old", "as-old", "my engine changes: the attention window, the speed work and the sampling"),
        compare(sounds, "as-old", "new", "Google's text mapper"),
        "",
        "Listen in order for each seed: old, as-old, new. A seed is not the same music in old and new,",
        "so judge the sound (scratchy, metallic, booming), not the notes.",
        f"Folder: {out_dir}",
    ]
    text = "\n".join(report) + "\n"
    (out_dir / "report.txt").write_text(text, encoding="utf-8")
    say()
    say("=" * 72)
    say(text)
    say("Tell me which ones sound wrong, and send me report.txt.")
    if sys.platform == "win32":
        os.startfile(out_dir)  # open the results for the person who double-clicked
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        say("\nStopped.")
        raise SystemExit(130) from None
