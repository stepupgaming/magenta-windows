"""Find, download, and verify Magenta's text mapper. This module does not import PyTorch.

Upstream Magenta RealTime 2 refines every text prompt's MusicCoCa embedding
with a small model, mapper.tflite, before prompts are blended. Google
publishes it in the public magenta-rt-public bucket and in the
google/magenta-realtime-2 Hugging Face repo at the same relative path.

The file lives in the weight cache in Hugging Face layout:

    <cache>/models--google--magenta-realtime-2/snapshots/<rev>/resources/musiccoca/mapper.tflite

so release packing and unpacking treat it like every other weight file.

MAGENTA_TEXT_MAPPER controls it: unset uses the cached file and downloads it
when missing, "off" (or 0, false, no) disables it, and anything else is a
path to a mapper.tflite to use.
"""

from __future__ import annotations

import http.client
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from magenta_win import google_files
from magenta_win.google_files import GoogleFile

MAPPER_REPO = google_files.GOOGLE_REPO
MAPPER_FILE = "resources/musiccoca/mapper.tflite"
MAPPER_URL = f"{google_files.BUCKET}/{MAPPER_FILE}"
MAPPER_SHA256 = "2f9743cc8f121a588b69c7f4d79a2a4111ce81864cbde8830054cd5e97f3d717"
MAPPER_SIZE = 86_166_664
# The bucket object's generation. It names the snapshot folder the way a
# commit hash names one for files that come from Hugging Face.
MAPPER_GENERATION = 1780512877384441
MAPPER_SNAPSHOT = f"gcs-{MAPPER_GENERATION}"
MAPPER_ENV = "MAGENTA_TEXT_MAPPER"

_OFF = {"0", "off", "false", "no"}


@dataclass(frozen=True)
class MapperFile:
    """Where the mapper is, or why there is none."""

    path: Path | None
    state: str
    detail: str


def mapper() -> GoogleFile:
    """The pinned mapper, read when called so tests can pin other bytes."""
    return GoogleFile(MAPPER_FILE, MAPPER_SHA256, MAPPER_SIZE, MAPPER_GENERATION)


def mapper_target(cache: Path) -> Path:
    """Where a downloaded mapper is stored."""
    return google_files.target(cache, mapper())


def cached_mappers(cache: Path) -> list[Path]:
    """Every mapper.tflite in the cache, newest snapshot first."""
    return google_files.cached(cache, mapper())


def sha256_of(path: Path) -> str:
    return google_files.sha256_of(path)


def is_genuine(path: Path) -> bool:
    """True when the file is the mapper the PyTorch port was checked against."""
    return google_files.is_genuine(path, mapper())


def find_mapper(cache: Path) -> Path | None:
    return google_files.find(cache, mapper())


def fetch_mapper(cache: Path, log: Callable[[str], None] = print) -> Path:
    """Download the mapper into the cache and verify it. Returns its path."""
    return google_files.fetch(cache, mapper(), log)


def locate_mapper(cache: Path, allow_download: bool, log: Callable[[str], None] = print) -> MapperFile:
    """Resolve MAGENTA_TEXT_MAPPER, the cache, and the download, in that order."""
    setting = os.environ.get(MAPPER_ENV, "").strip()
    if setting.lower() in _OFF:
        return MapperFile(None, "off", f"{MAPPER_ENV}={setting}")
    if setting:
        path = Path(setting).expanduser()
        if not path.is_file():
            return MapperFile(None, "unavailable", f"{MAPPER_ENV} points at a missing file: {path}")
        if not is_genuine(path):
            return MapperFile(None, "unavailable", f"{path} is not the mapper this engine was checked against")
        return MapperFile(path, "on", str(path))
    found = find_mapper(cache)
    if found is not None:
        return MapperFile(found, "on", str(found))
    if not allow_download:
        return MapperFile(None, "unavailable", "mapper.tflite is not cached and downloads are off")
    try:
        return MapperFile(fetch_mapper(cache, log), "on", str(mapper_target(cache)))
    except (OSError, http.client.HTTPException) as exc:
        return MapperFile(None, "unavailable", f"could not download mapper.tflite: {exc}")
