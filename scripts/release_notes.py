"""Write the notes for a GitHub release: the download, that version's changelog,
and the credit for Google's weights.

Release Please writes CHANGELOG.md. The Windows release workflow runs this once
Magenta.exe and the weight parts are up, so re-running it never loses the
changelog.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = "stepupgaming/magenta-windows"
CREDIT = (
    "The model weights are Magenta RealTime 2 by Google, licensed "
    "[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The part files hold the PyTorch "
    "checkpoints from the `magenta-community/magenta-realtime-2` and "
    "`magenta-torch/magenta-rt-musiccoca-torch` Hugging Face repos, plus Google's text mapper "
    "and SpectroStream encoder files, split under GitHub's 2 GB asset limit and otherwise unchanged."
)


def changelog_section(changelog: str, version: str) -> str:
    """The `## [version]` section of a Release Please changelog, heading included."""
    heading = re.compile(rf"^## \[?{re.escape(version)}\]?(?:[\s(]|$)")
    lines = changelog.splitlines()
    start = next((index for index, line in enumerate(lines) if heading.match(line)), None)
    if start is None:
        return ""
    end = next((index for index in range(start + 1, len(lines)) if lines[index].startswith("## ")), len(lines))
    return "\n".join(lines[start:end]).strip()


def release_notes(tag: str, changelog: str, repo: str = REPO) -> str:
    download = f"https://github.com/{repo}/releases/download/{tag}/Magenta.exe"
    intro = (
        f"Download [Magenta.exe]({download}) and run it. The first launch installs the CUDA engine "
        "and downloads the checkpoint. The part files on this release are the weights. "
        "There is no separate installer."
    )
    section = changelog_section(changelog, tag.removeprefix("v"))
    if not section:
        print(f"CHANGELOG.md has no section for {tag}", file=sys.stderr)
    return "\n\n".join(part for part in (intro, section, "---", CREDIT) if part) + "\n"


def self_test() -> None:
    changelog = (
        "# Changelog\n\n"
        "## [0.1.10](https://example.com/compare/v0.1.9...v0.1.10) (2026-11-01)\n\n"
        "### Features\n\n* ten\n\n"
        "## [0.1.1](https://example.com/compare/v0.1.0...v0.1.1) (2026-10-03)\n\n\n"
        "### Bug Fixes\n\n* one\n\n"
        "## 0.1.0 (2026-10-02)\n\n### Features\n\n* first\n"
    )
    one = changelog_section(changelog, "0.1.1")
    if not one.startswith("## [0.1.1](") or not one.endswith("* one") or "ten" in one:
        raise SystemExit(f"self-test picked the wrong section for 0.1.1: {one!r}")
    if changelog_section(changelog, "0.1.0") != "## 0.1.0 (2026-10-02)\n\n### Features\n\n* first":
        raise SystemExit("self-test missed a first release without a compare link")
    if changelog_section(changelog, "0.1.2") or changelog_section(changelog, "0.1"):
        raise SystemExit("self-test found a section for a version that is not there")
    notes = release_notes("v0.1.1", changelog, "owner/repo")
    if "releases/download/v0.1.1/Magenta.exe" not in notes or "* one" not in notes or "CC BY 4.0" not in notes:
        raise SystemExit(f"self-test notes are incomplete: {notes!r}")
    print("self-test ok", flush=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write the notes for a Magenta GitHub release.")
    commands = parser.add_subparsers(dest="command", required=True)
    write_cmd = commands.add_parser("write")
    write_cmd.add_argument("tag", help="release tag, for example v0.1.2")
    write_cmd.add_argument("--out", type=Path, required=True)
    write_cmd.add_argument("--repo", default=REPO)
    write_cmd.add_argument("--changelog", type=Path, default=ROOT / "CHANGELOG.md")
    commands.add_parser("self-test")
    args = parser.parse_args(argv)
    if args.command == "write":
        notes = release_notes(args.tag, args.changelog.read_text(encoding="utf-8"), args.repo)
        args.out.write_text(notes, encoding="utf-8")
    else:
        self_test()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
