"""Engine tests. They need no GPU and no weights.

    cd engine
    uv run --with pytest --with flatbuffers pytest tests

Tests that compare against Google's mapper.tflite run when the file is in
the weight cache, or when MAGENTA_TEST_MAPPER points at it, and skip
otherwise.
"""

from __future__ import annotations

import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent
TESTS = Path(__file__).resolve().parent
for path in (ENGINE, TESTS):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))
