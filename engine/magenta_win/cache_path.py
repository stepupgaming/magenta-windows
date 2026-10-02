"""Where Magenta looks for Hugging Face weights. This module does not import PyTorch."""

from __future__ import annotations

import os
from pathlib import Path


def weight_cache() -> Path:
    configured = os.environ.get("HUGGINGFACE_HUB_CACHE")
    if configured:
        return Path(configured)
    local = Path(r"F:\Models\huggingface\hub")
    if local.is_dir():
        return local
    return Path.home() / ".cache" / "huggingface" / "hub"
