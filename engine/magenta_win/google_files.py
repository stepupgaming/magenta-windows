"""Files Google publishes for Magenta RealTime 2, fetched and verified. No PyTorch.

Google serves resource files (the text mapper, the SpectroStream encoder, and
others) from the public magenta-rt-public bucket, at the same relative paths
as the google/magenta-realtime-2 Hugging Face repo. They are stored in the
weight cache in Hugging Face layout:

    <cache>/models--google--magenta-realtime-2/snapshots/gcs-<generation>/<file>

so release packing and unpacking treat them like every other weight file. The
generation is the bucket object's, which names the snapshot folder the way a
commit hash names one for files that come from Hugging Face. Every file is
checked against a pinned size and SHA-256 before it is used.
"""

from __future__ import annotations

import hashlib
import os
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

GOOGLE_REPO = "google/magenta-realtime-2"
BUCKET = "https://storage.googleapis.com/magenta-rt-public/magenta-rt-2"

_BLOCK = 4 * 1024 * 1024
_TIMEOUT = 30


@dataclass(frozen=True)
class GoogleFile:
    """One pinned file from Google's bucket."""

    file: str
    sha256: str
    size: int
    generation: int

    @property
    def url(self) -> str:
        return f"{BUCKET}/{self.file}"

    @property
    def snapshot(self) -> str:
        return f"gcs-{self.generation}"

    @property
    def name(self) -> str:
        return Path(self.file).name


SPECTROSTREAM_ENCODER = GoogleFile(
    "resources/spectrostream/encoder.safetensors",
    "f20c197ddcbb9cd43e1a97f9bee0d07d211f79966cd3862d9830a32885090f72",
    37_013_392,
    1780512933836913,
)
SPECTROSTREAM_QUANTIZER = GoogleFile(
    "resources/spectrostream/quantizer.safetensors",
    "0ba89dcb85344bb14f4f34b8f597c0d6adaa560002d4fd88879a2944c98a20f0",
    67_108_984,
    1780512935538528,
)


def repo_dir(cache: Path) -> Path:
    return cache / ("models--" + GOOGLE_REPO.replace("/", "--"))


def target(cache: Path, item: GoogleFile) -> Path:
    """Where a downloaded copy of `item` is stored."""
    return repo_dir(cache) / "snapshots" / item.snapshot / item.file


def cached(cache: Path, item: GoogleFile) -> list[Path]:
    """Every copy of `item` in the cache, newest snapshot first."""
    snapshots = repo_dir(cache) / "snapshots"
    if not snapshots.is_dir():
        return []
    found = [path for path in snapshots.glob(f"*/{item.file}") if path.is_file()]
    return sorted(found, key=lambda path: path.stat().st_mtime, reverse=True)


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(_BLOCK):
            digest.update(block)
    return digest.hexdigest()


def is_genuine(path: Path, item: GoogleFile) -> bool:
    """True when the file is the exact one this engine was checked against."""
    try:
        return path.stat().st_size == item.size and sha256_of(path) == item.sha256
    except OSError:
        return False


def find(cache: Path, item: GoogleFile) -> Path | None:
    for path in cached(cache, item):
        if is_genuine(path, item):
            return path
    return None


def fetch(cache: Path, item: GoogleFile, log: Callable[[str], None] = print) -> Path:
    """Download `item` into the cache and verify it. Returns its path.

    Raises OSError (or http.client.HTTPException for a dropped connection)
    when the download fails or does not match, leaving nothing behind."""
    path = target(cache, item)
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".part")
    digest = hashlib.sha256()
    size = 0
    log(f"downloading {item.name} ({max(1, item.size // 1_000_000)} MB) from {item.url}")
    try:
        with urllib.request.urlopen(item.url, timeout=_TIMEOUT) as response, partial.open("wb") as handle:
            while block := response.read(_BLOCK):
                handle.write(block)
                digest.update(block)
                size += len(block)
        if size != item.size or digest.hexdigest() != item.sha256:
            raise OSError(f"the downloaded {item.name} failed its checksum ({size} bytes)")
        os.replace(partial, path)
    finally:
        partial.unlink(missing_ok=True)
    return path
