from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pytest
import torch

from magenta_win import google_files
from magenta_win.cache_path import weight_cache
from model_code.spectrostream_encoder import load_clip_encoder

# Google's MLX SpectroStream (magenta_rt/mlx/spectrostream, run on the CPU) codes
# for golden_clip(): every level at a few frames, and the coarsest level at all.
GOLDEN_ROWS = {
    25: [218, 278, 105, 977, 119, 902, 128, 886, 815, 201, 839, 295],
    40: [76, 32, 334, 785, 576, 637, 567, 1011, 1009, 947, 984, 250],
    55: [390, 1015, 279, 395, 498, 381, 352, 937, 39, 236, 15, 708],
    70: [390, 337, 279, 379, 687, 193, 752, 751, 244, 457, 234, 716],
}
GOLDEN_COARSE = [
    905, 738, 76, 962, 390, 390, 390, 390, 390, 390, 390, 390, 158, 579, 801, 76, 861, 390, 390, 390,
    390, 390, 390, 390, 42, 218, 801, 76, 962, 390, 390, 390, 390, 390, 390, 390, 390, 158, 579, 801,
    76, 390, 390, 390, 681, 390, 390, 390, 390, 42, 218, 801, 76, 962, 390, 390, 390, 390, 390, 390,
    390, 390, 158, 579, 801, 76, 390, 390, 390, 390, 390, 390, 390, 390, 42, 218, 801, 76, 962, 390,
    390, 390, 390, 390, 390, 390, 390, 158, 579, 801, 76, 861, 390, 390, 681, 390, 390, 390, 390, 1020,
]


def golden_clip() -> np.ndarray:
    """4 s of deterministic stereo test audio: a decaying chord and noise hits."""
    rate = 48_000
    t = np.arange(rate * 4) / rate
    chord = sum(np.sin(2 * np.pi * hz * t) for hz in (220.0, 277.18, 329.63)) * np.exp(-(t % 1.0) * 2)
    hits = np.random.default_rng(0).standard_normal(t.shape) * np.exp(-(t % 0.5) * 40)
    left = 0.15 * chord + 0.05 * hits
    right = 0.12 * chord - 0.04 * hits
    return np.stack([left, right], -1).astype(np.float32)


def real_files() -> tuple[Path, Path] | None:
    """MAGENTA_TEST_SPECTROSTREAM names a folder with Google's encoder.safetensors
    and quantizer.safetensors; otherwise use verified copies in the weight cache."""
    folder = os.environ.get("MAGENTA_TEST_SPECTROSTREAM")
    items = (google_files.SPECTROSTREAM_ENCODER, google_files.SPECTROSTREAM_QUANTIZER)
    if folder:
        paths = [Path(folder) / item.name for item in items]
        if all(google_files.is_genuine(path, item) for path, item in zip(paths, items, strict=True)):
            return paths[0], paths[1]
        return None
    found = [google_files.find(weight_cache(), item) for item in items]
    if found[0] is None or found[1] is None:
        return None
    return found[0], found[1]


@pytest.fixture(scope="module")
def google_codes() -> np.ndarray:
    files = real_files()
    if files is None:
        pytest.skip("SpectroStream encoder files are not available. Set MAGENTA_TEST_SPECTROSTREAM to run these.")
    encoder = load_clip_encoder(*files, levels=12)
    with torch.no_grad():
        return encoder(torch.from_numpy(golden_clip())[None])[0].numpy()


def test_encodes_whole_frames(google_codes: np.ndarray) -> None:
    assert google_codes.shape == (100, 12)
    assert google_codes.min() >= 0
    assert google_codes.max() < 1024


def test_matches_google_reference_codes(google_codes: np.ndarray) -> None:
    for row, codes in GOLDEN_ROWS.items():
        assert google_codes[row].tolist() == codes
    assert google_codes[:, 0].tolist() == GOLDEN_COARSE
