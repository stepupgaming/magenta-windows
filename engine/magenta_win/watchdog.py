"""Notices when the model has fallen silent while it should be playing.

Held on one unchanging style for long enough, the model can collapse into
digital silence and stay there. The audio path keeps reporting perfect health
while it does, because it is faithfully delivering silence. The fuchsia project
found a 280 second collapse this way in a 30 minute soak of the same PyTorch
port. This module does not import PyTorch.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

# Digital silence, about -80 dBFS. A quiet passage or a single soft tone sits
# far above this, so music never trips it.
SILENT_RMS = 1e-4
# Long enough that a rest in the music never counts as a collapse.
REVIVE_AFTER_SECONDS = 6.0


def expects_silence(notes: Sequence[int] | None) -> bool:
    """True when every note slot asks for off, which is how Solo rests."""
    return notes is not None and len(notes) > 0 and all(note == 0 for note in notes)


class SilenceWatch:
    """Counts unexpected silence and says when to revive the model."""

    def __init__(self, threshold: float = SILENT_RMS, patience: float = REVIVE_AFTER_SECONDS) -> None:
        self.threshold = threshold
        self.patience = patience
        self.silent_seconds = 0.0
        self.revivals = 0

    def observe(self, samples: np.ndarray, sample_rate: int, expected: bool = False) -> bool:
        """Feed one generated chunk. Returns True when the model should be revived."""
        if samples.size == 0:
            return False
        rms = float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))
        if expected or rms >= self.threshold:
            self.silent_seconds = 0.0
            return False
        self.silent_seconds += samples.shape[0] / sample_rate
        if self.silent_seconds < self.patience:
            return False
        self.silent_seconds = 0.0
        self.revivals += 1
        return True

    def reset(self) -> None:
        self.silent_seconds = 0.0
