from __future__ import annotations

import numpy as np

from magenta_win.watchdog import SilenceWatch, expects_silence

RATE = 48_000
CHUNK = RATE // 5


def chunk(level: float) -> np.ndarray:
    rng = np.random.default_rng(0)
    return (rng.standard_normal((CHUNK, 2)) * level).astype(np.float32)


def test_revives_after_sustained_digital_silence() -> None:
    watch = SilenceWatch(patience=1.0)
    results = [watch.observe(chunk(0.0), RATE) for _ in range(5)]
    assert results == [False, False, False, False, True]
    assert watch.revivals == 1
    # The count starts over after a revival.
    assert not watch.observe(chunk(0.0), RATE)


def test_quiet_music_is_not_silence() -> None:
    watch = SilenceWatch(patience=0.4)
    # About -60 dBFS, far quieter than any mix but far above digital silence.
    assert not any(watch.observe(chunk(0.001), RATE) for _ in range(20))


def test_sound_resets_the_count() -> None:
    watch = SilenceWatch(patience=1.0)
    for _ in range(4):
        watch.observe(chunk(0.0), RATE)
    watch.observe(chunk(0.1), RATE)
    assert not any(watch.observe(chunk(0.0), RATE) for _ in range(4))


def test_expected_silence_never_revives() -> None:
    watch = SilenceWatch(patience=0.4)
    assert not any(watch.observe(chunk(0.0), RATE, expected=True) for _ in range(20))
    assert watch.revivals == 0


def test_solo_rest_expects_silence() -> None:
    assert expects_silence([0] * 128)
    assert not expects_silence(None)
    assert not expects_silence([0] * 60 + [1] + [0] * 67)
    assert not expects_silence([-1] * 128)
