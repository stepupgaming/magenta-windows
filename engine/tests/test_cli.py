from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest
from magenta_win.cli import build_parser, build_spec

ENGINE = Path(__file__).resolve().parent.parent


def generate_spec(*flags: str) -> dict[str, object]:
    args = build_parser().parse_args(["generate", "--prompt", "techno", "--seconds", "2", *flags])
    return build_spec(args)


def test_generate_matches_the_window_by_default() -> None:
    spec = generate_spec()
    # The window leaves drums to the model; asking for none made genre prompts odd.
    assert spec["drums"] == "auto"
    assert spec["cfg_drums"] == 1.0
    assert spec["style_levels"] == 12


@pytest.mark.parametrize(("flags", "drums"), [(("--drums",), "on"), (("--drums", "off"), "off"), (("--drums", "on"), "on")])
def test_generate_drum_modes(flags: tuple[str, ...], drums: str) -> None:
    assert generate_spec(*flags)["drums"] == drums


def test_cli_does_not_import_pytorch() -> None:
    """magenta --help must stay instant, so the CLI keeps its own drum modes."""
    probe = "import sys, magenta_win.cli; print('torch' in sys.modules)"
    out = subprocess.run([sys.executable, "-c", probe], cwd=ENGINE, capture_output=True, text=True, check=True)
    assert out.stdout.strip() == "False"
