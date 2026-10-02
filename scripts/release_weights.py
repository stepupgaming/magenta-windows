"""Pack, unpack, and fetch Magenta weights for a GitHub release.

GitHub release assets are limited to 2 GB each. The checkpoint is about 9 GB,
so a release stores it as ordered parts plus magenta-weights.json.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent / "engine"
if str(ENGINE) not in sys.path:
    sys.path.insert(0, str(ENGINE))

from magenta_win.cache_path import weight_cache

REPOS = (
    "magenta-community/magenta-realtime-2",
    "magenta-torch/magenta-rt-musiccoca-torch",
)
RELEASE_BASE = "https://github.com/stepupgaming/magenta-windows/releases/latest/download"
MANIFEST_NAME = "magenta-weights.json"
CHUNK_BYTES = 1800 * 1024 * 1024
BLOCK = 8 * 1024 * 1024
NEEDED = (
    ("magenta-community/magenta-realtime-2", "model.safetensors"),
    ("magenta-torch/magenta-rt-musiccoca-torch", "text_encoder.pt"),
    ("magenta-torch/magenta-rt-musiccoca-torch", "quantizer.pt"),
)


def repo_dir(cache: Path, repo_id: str) -> Path:
    return cache / ("models--" + repo_id.replace("/", "--"))


def real_size(path: Path) -> int:
    return path.resolve().stat().st_size


def snapshots_ready(cache: Path) -> bool:
    for repo, name in NEEDED:
        found = list((repo_dir(cache, repo) / "snapshots").glob(f"*/{name}"))
        if not found or real_size(found[0]) < 1_000_000:
            return False
    return True


def newest_snapshot(cache: Path, repo_id: str) -> Path | None:
    snapshots = repo_dir(cache, repo_id) / "snapshots"
    if not snapshots.is_dir():
        return None
    dirs = [path for path in snapshots.iterdir() if path.is_dir()]
    if not dirs:
        return None
    return max(dirs, key=lambda path: path.stat().st_mtime)


def split_file(src: Path, out_dir: Path, chunk_bytes: int, counter: list[int]) -> dict[str, object] | None:
    digest = hashlib.sha256()
    size = 0
    parts: list[dict[str, object]] = []
    with src.resolve().open("rb") as handle:
        while True:
            counter[0] += 1
            name = f"magenta-weights-{counter[0]:04d}.part"
            part_path = out_dir / name
            part_hash = hashlib.sha256()
            part_size = 0
            with part_path.open("wb") as part:
                while part_size < chunk_bytes:
                    block = handle.read(min(BLOCK, chunk_bytes - part_size))
                    if not block:
                        break
                    part.write(block)
                    part_hash.update(block)
                    digest.update(block)
                    part_size += len(block)
                    size += len(block)
            if part_size == 0:
                part_path.unlink()
                counter[0] -= 1
                break
            parts.append({"name": name, "size": part_size, "sha256": part_hash.hexdigest()})
            if part_size < chunk_bytes:
                break
    if size == 0:
        return None
    return {"size": size, "sha256": digest.hexdigest(), "parts": parts}


def pack(cache: Path, out_dir: Path, chunk_bytes: int) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    counter = [0]
    files: list[dict[str, object]] = []
    for repo in REPOS:
        snapshot = newest_snapshot(cache, repo)
        if snapshot is None:
            raise SystemExit(f"No local snapshot for {repo} under {cache}")
        for path in sorted(item for item in snapshot.rglob("*") if item.is_file()):
            packed = split_file(path, out_dir, chunk_bytes, counter)
            if packed is None:
                continue
            files.append(
                {
                    "repo": repo,
                    "snapshot": snapshot.name,
                    "file": path.relative_to(snapshot).as_posix(),
                    **packed,
                }
            )
            print(f"packed {repo}/{path.name} ({packed['size']} bytes)", flush=True)
    if not files:
        raise SystemExit(f"No weight files found under {cache}")
    manifest = {
        "format": 1,
        "files": files,
        "note": (
            "Parts are under GitHub's 2 GB asset limit. "
            "The bytes are the public Hugging Face files for "
            + " and ".join(REPOS)
            + "."
        ),
    }
    dest = out_dir / MANIFEST_NAME
    dest.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"wrote {dest}", flush=True)
    return dest


def unpack(manifest_path: Path, parts_dir: Path, cache: Path) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for item in manifest["files"]:
        dest = repo_dir(cache, str(item["repo"])) / "snapshots" / str(item["snapshot"]) / str(item["file"])
        dest.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        with dest.open("wb") as handle:
            for part in item["parts"]:
                part_path = parts_dir / str(part["name"])
                if not part_path.is_file():
                    raise SystemExit(f"Missing weight part {part_path}")
                part_hash = hashlib.sha256()
                with part_path.open("rb") as incoming:
                    while True:
                        block = incoming.read(BLOCK)
                        if not block:
                            break
                        handle.write(block)
                        part_hash.update(block)
                        digest.update(block)
                if part_hash.hexdigest() != part["sha256"]:
                    raise SystemExit(f"Checksum failed for {part_path.name}")
        if digest.hexdigest() != item["sha256"]:
            raise SystemExit(f"Checksum failed for {dest}")
        print(f"unpacked {dest}", flush=True)


def download_release(cache: Path) -> bool:
    manifest_url = f"{RELEASE_BASE}/{MANIFEST_NAME}"
    try:
        with urllib.request.urlopen(manifest_url, timeout=60) as response:
            body = response.read()
    except urllib.error.URLError as exc:
        print(f"No weight manifest on the GitHub release ({exc}).", flush=True)
        return False
    work = cache.parent / "magenta-weight-parts"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    manifest_path = work / MANIFEST_NAME
    manifest_path.write_bytes(body)
    manifest = json.loads(body.decode("utf-8"))
    names = [part["name"] for item in manifest["files"] for part in item["parts"]]
    for name in names:
        dest = work / name
        print(f"downloading {name}", flush=True)
        urllib.request.urlretrieve(f"{RELEASE_BASE}/{name}", dest)
    unpack(manifest_path, work, cache)
    return True


def download_huggingface(cache: Path) -> None:
    from huggingface_hub import snapshot_download

    for repo in REPOS:
        print(f"downloading {repo}", flush=True)
        snapshot_download(repo, cache_dir=str(cache))


def ensure(cache: Path) -> None:
    if snapshots_ready(cache):
        print(f"weights already in {cache}", flush=True)
        return
    if download_release(cache) and snapshots_ready(cache):
        print(f"weights unpacked into {cache}", flush=True)
        return
    print("Release weights are not ready. The engine can still download from Hugging Face on load or generate.", flush=True)


def self_test() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        cache = root / "hub"
        snapshot = repo_dir(cache, REPOS[0]) / "snapshots" / "abc"
        snapshot.mkdir(parents=True)
        payload = b"magenta-weight-bytes-" * 100_000
        (snapshot / "model.safetensors").write_bytes(payload)
        other = repo_dir(cache, REPOS[1]) / "snapshots" / "def"
        other.mkdir(parents=True)
        (other / "text_encoder.pt").write_bytes(b"text" * 1000)
        (other / "quantizer.pt").write_bytes(b"q" * 2000)
        packed = root / "parts"
        pack(cache, packed, chunk_bytes=1024 * 1024)
        restored = root / "restored"
        unpack(packed / MANIFEST_NAME, packed, restored)
        got = (repo_dir(restored, REPOS[0]) / "snapshots" / "abc" / "model.safetensors").read_bytes()
        if got != payload:
            raise SystemExit("self-test payload mismatch")
    print("self-test ok", flush=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Pack or fetch Magenta release weights.")
    commands = parser.add_subparsers(dest="command", required=True)
    pack_cmd = commands.add_parser("pack")
    pack_cmd.add_argument("--cache", type=Path, required=True)
    pack_cmd.add_argument("--out", type=Path, required=True)
    pack_cmd.add_argument("--chunk-bytes", type=int, default=CHUNK_BYTES)
    unpack_cmd = commands.add_parser("unpack")
    unpack_cmd.add_argument("--manifest", type=Path, required=True)
    unpack_cmd.add_argument("--parts", type=Path, required=True)
    unpack_cmd.add_argument("--cache", type=Path, required=True)
    download_cmd = commands.add_parser("download")
    download_cmd.add_argument("--cache", type=Path, required=True)
    ensure_cmd = commands.add_parser("ensure")
    ensure_cmd.add_argument("--cache", type=Path, default=None)
    commands.add_parser("self-test")
    args = parser.parse_args(argv)
    if args.command == "pack":
        pack(args.cache, args.out, args.chunk_bytes)
    elif args.command == "unpack":
        unpack(args.manifest, args.parts, args.cache)
    elif args.command == "download":
        download_huggingface(args.cache)
    elif args.command == "ensure":
        ensure(args.cache or weight_cache())
    else:
        self_test()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
