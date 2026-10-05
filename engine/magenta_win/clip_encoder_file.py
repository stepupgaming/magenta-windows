"""Find or download the files that turn a clip into model tokens. No PyTorch.

Continuing from a clip needs Google's SpectroStream encoder and the RVQ
codebook that quantizes its output: about 37 MB and 67 MB from the public
magenta-rt-public bucket. They are fetched with the model, unless
HF_HUB_OFFLINE=1, and kept in the weight cache like the text mapper.
"""

from __future__ import annotations

import http.client
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from magenta_win import google_files
from magenta_win.google_files import SPECTROSTREAM_ENCODER, SPECTROSTREAM_QUANTIZER, GoogleFile


@dataclass(frozen=True)
class ClipEncoderFiles:
    """Where the encoder files are, or why there are none."""

    encoder: Path | None
    quantizer: Path | None
    state: str
    detail: str


def locate_clip_encoder(
    cache: Path,
    allow_download: bool,
    log: Callable[[str], None] = print,
    files: tuple[GoogleFile, GoogleFile] = (SPECTROSTREAM_ENCODER, SPECTROSTREAM_QUANTIZER),
) -> ClipEncoderFiles:
    """Use verified cached copies, downloading what is missing when allowed."""
    found: list[Path] = []
    for item in files:
        path = google_files.find(cache, item)
        if path is None:
            if not allow_download:
                return ClipEncoderFiles(None, None, "unavailable", f"{item.name} is not cached and downloads are off")
            try:
                path = google_files.fetch(cache, item, log)
            except (OSError, http.client.HTTPException) as exc:
                return ClipEncoderFiles(None, None, "unavailable", f"could not download {item.name}: {exc}")
        found.append(path)
    encoder, quantizer = found
    return ClipEncoderFiles(encoder, quantizer, "on", str(encoder))
