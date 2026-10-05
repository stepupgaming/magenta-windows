"""Audio files as the 48 kHz stereo clips the engine continues from. No PyTorch.

Resampling is done in the frequency domain over the whole clip, which is exact
away from its ends. The engine drops the first and last second of every clip
it continues from, so the ends never reach the model.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

CLIP_RATE = 48_000


def to_stereo(samples: np.ndarray) -> np.ndarray:
    """[n] or [n, channels] -> [n, 2]. Mono is doubled; extra channels are dropped."""
    if samples.ndim == 1:
        samples = samples[:, None]
    if samples.shape[1] == 1:
        return np.repeat(samples, 2, axis=1)
    return samples[:, :2]


def resample(samples: np.ndarray, rate: int, target: int = CLIP_RATE) -> np.ndarray:
    """Resample [n, channels] audio from `rate` to `target` Hz."""
    if rate == target or samples.shape[0] == 0:
        return samples
    count = round(samples.shape[0] * target / rate)
    spectrum = np.fft.rfft(samples.astype(np.float64), axis=0)
    bins = count // 2 + 1
    if bins <= spectrum.shape[0]:
        spectrum = spectrum[:bins]
    else:
        spectrum = np.concatenate([spectrum, np.zeros((bins - spectrum.shape[0], samples.shape[1]))], axis=0)
    return np.fft.irfft(spectrum, n=count, axis=0) * (count / samples.shape[0])


def load_clip(path: Path) -> np.ndarray:
    """Read any file soundfile can, as float32 [samples, 2] at 48 kHz."""
    import soundfile as sf

    samples, rate = sf.read(str(path), dtype="float32", always_2d=True)
    return np.clip(resample(to_stereo(samples), int(rate)), -1.0, 1.0).astype(np.float32)
