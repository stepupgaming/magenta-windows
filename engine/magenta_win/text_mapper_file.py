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

import hashlib
import http.client
import os
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

MAPPER_REPO = "google/magenta-realtime-2"
MAPPER_FILE = "resources/musiccoca/mapper.tflite"
MAPPER_URL = "https://storage.googleapis.com/magenta-rt-public/magenta-rt-2/resources/musiccoca/mapper.tflite"
MAPPER_SHA256 = "2f9743cc8f121a588b69c7f4d79a2a4111ce81864cbde8830054cd5e97f3d717"
MAPPER_SIZE = 86_166_664
# The bucket object's generation. It names the snapshot folder the way a
# commit hash names one for files that come from Hugging Face.
MAPPER_SNAPSHOT = "gcs-1780512877384441"
MAPPER_ENV = "MAGENTA_TEXT_MAPPER"

_OFF = {"0", "off", "false", "no"}
_BLOCK = 4 * 1024 * 1024
_TIMEOUT = 30


@dataclass(frozen=True)
class MapperFile:
    """Where the mapper is, or why there is none."""

    path: Path | None
    state: str
    detail: str


def _repo_dir(cache: Path) -> Path:
    return cache / ("models--" + MAPPER_REPO.replace("/", "--"))


def mapper_target(cache: Path) -> Path:
    """Where a downloaded mapper is stored."""
    return _repo_dir(cache) / "snapshots" / MAPPER_SNAPSHOT / MAPPER_FILE


def cached_mappers(cache: Path) -> list[Path]:
    """Every mapper.tflite in the cache, newest snapshot first."""
    snapshots = _repo_dir(cache) / "snapshots"
    if not snapshots.is_dir():
        return []
    found = [path for path in snapshots.glob(f"*/{MAPPER_FILE}") if path.is_file()]
    return sorted(found, key=lambda path: path.stat().st_mtime, reverse=True)


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(_BLOCK):
            digest.update(block)
    return digest.hexdigest()


def is_genuine(path: Path) -> bool:
    """True when the file is the mapper the PyTorch port was checked against."""
    try:
        return path.stat().st_size == MAPPER_SIZE and sha256_of(path) == MAPPER_SHA256
    except OSError:
        return False


def find_mapper(cache: Path) -> Path | None:
    for path in cached_mappers(cache):
        if is_genuine(path):
            return path
    return None


def fetch_mapper(cache: Path, log: Callable[[str], None] = print) -> Path:
    """Download the mapper into the cache and verify it. Returns its path."""
    target = mapper_target(cache)
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".part")
    digest = hashlib.sha256()
    size = 0
    log(f"downloading the text mapper ({MAPPER_SIZE // 1_000_000} MB) from {MAPPER_URL}")
    try:
        with urllib.request.urlopen(MAPPER_URL, timeout=_TIMEOUT) as response, partial.open("wb") as handle:
            while block := response.read(_BLOCK):
                handle.write(block)
                digest.update(block)
                size += len(block)
        if size != MAPPER_SIZE or digest.hexdigest() != MAPPER_SHA256:
            raise OSError(f"the downloaded mapper failed its checksum ({size} bytes)")
        os.replace(partial, target)
    finally:
        partial.unlink(missing_ok=True)
    return target


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
