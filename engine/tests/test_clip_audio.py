from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from magenta_win.clip_audio import load_clip, resample, to_stereo


def tone(rate: int, seconds: float, hz: float) -> np.ndarray:
    t = np.arange(int(rate * seconds)) / rate
    return np.sin(2 * np.pi * hz * t)


def test_resampling_keeps_a_tone() -> None:
    source = tone(44_100, 2.0, 1000.0)[:, None]
    out = resample(source, 44_100)
    assert out.shape == (96_000, 1)
    expected = tone(48_000, 2.0, 1000.0)
    # Exact away from the ends, where the engine never listens.
    middle = slice(4_800, -4_800)
    np.testing.assert_allclose(out[middle, 0], expected[middle], atol=1e-6)


def test_stereo_from_any_channel_count() -> None:
    mono = np.arange(4.0)
    assert to_stereo(mono).shape == (4, 2)
    assert to_stereo(np.ones((4, 1))).shape == (4, 2)
    assert to_stereo(np.ones((4, 6))).shape == (4, 2)


def test_loads_a_file_as_48k_stereo(tmp_path: Path) -> None:
    sf = pytest.importorskip("soundfile")
    path = tmp_path / "clip.wav"
    sf.write(str(path), (0.5 * tone(22_050, 1.0, 440.0)).astype(np.float32), 22_050)
    clip = load_clip(path)
    assert clip.dtype == np.float32
    assert clip.shape == (48_000, 2)
    assert np.abs(clip).max() <= 1.0
    np.testing.assert_array_equal(clip[:, 0], clip[:, 1])
