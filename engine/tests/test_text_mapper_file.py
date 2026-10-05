from __future__ import annotations

import hashlib
import http.client
import io
from pathlib import Path

import pytest

from magenta_win import google_files
from magenta_win import text_mapper_file as files

PAYLOAD = b"mapper-bytes" * 1000


@pytest.fixture
def pinned(monkeypatch: pytest.MonkeyPatch) -> bytes:
    """Pin the expected checksum to a small payload so tests stay fast."""
    monkeypatch.setattr(files, "MAPPER_SIZE", len(PAYLOAD))
    monkeypatch.setattr(files, "MAPPER_SHA256", hashlib.sha256(PAYLOAD).hexdigest())
    monkeypatch.delenv(files.MAPPER_ENV, raising=False)
    return PAYLOAD


def serve(monkeypatch: pytest.MonkeyPatch, body: bytes) -> list[str]:
    requested: list[str] = []

    def fake_urlopen(url: str, timeout: float) -> io.BytesIO:
        requested.append(url)
        return io.BytesIO(body)

    monkeypatch.setattr(google_files.urllib.request, "urlopen", fake_urlopen)
    return requested


def test_off_switch(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    for value in ("off", "0", "False", "no"):
        monkeypatch.setenv(files.MAPPER_ENV, value)
        found = files.locate_mapper(tmp_path, allow_download=True, log=lambda _: None)
        assert found.path is None
        assert found.state == "off"


def test_explicit_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, pinned: bytes) -> None:
    good = tmp_path / "mapper.tflite"
    good.write_bytes(pinned)
    monkeypatch.setenv(files.MAPPER_ENV, str(good))
    assert files.locate_mapper(tmp_path, allow_download=False).path == good

    bad = tmp_path / "other.tflite"
    bad.write_bytes(b"x" * len(pinned))
    monkeypatch.setenv(files.MAPPER_ENV, str(bad))
    found = files.locate_mapper(tmp_path, allow_download=False)
    assert found.path is None and found.state == "unavailable"

    monkeypatch.setenv(files.MAPPER_ENV, str(tmp_path / "missing.tflite"))
    assert files.locate_mapper(tmp_path, allow_download=False).state == "unavailable"


def test_uses_a_genuine_cached_copy(tmp_path: Path, pinned: bytes) -> None:
    cached = tmp_path / "models--google--magenta-realtime-2" / "snapshots" / "abc" / files.MAPPER_FILE
    cached.parent.mkdir(parents=True)
    cached.write_bytes(pinned)
    found = files.locate_mapper(tmp_path, allow_download=False)
    assert found.path == cached
    assert found.state == "on"


def test_skips_a_corrupt_cached_copy(tmp_path: Path, pinned: bytes) -> None:
    cached = tmp_path / "models--google--magenta-realtime-2" / "snapshots" / "abc" / files.MAPPER_FILE
    cached.parent.mkdir(parents=True)
    cached.write_bytes(pinned[:-1] + b"!")
    found = files.locate_mapper(tmp_path, allow_download=False)
    assert found.path is None
    assert found.state == "unavailable"


def test_downloads_when_missing(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, pinned: bytes) -> None:
    requested = serve(monkeypatch, pinned)
    found = files.locate_mapper(tmp_path, allow_download=True, log=lambda _: None)
    assert requested == [files.MAPPER_URL]
    assert found.state == "on"
    assert found.path == files.mapper_target(tmp_path)
    assert found.path.read_bytes() == pinned
    # The next lookup is served from the cache.
    serve(monkeypatch, b"")
    assert files.locate_mapper(tmp_path, allow_download=True, log=lambda _: None).path == found.path


def test_rejects_a_bad_download(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, pinned: bytes) -> None:
    serve(monkeypatch, pinned[:-1])
    found = files.locate_mapper(tmp_path, allow_download=True, log=lambda _: None)
    assert found.path is None
    assert found.state == "unavailable"
    target = files.mapper_target(tmp_path)
    assert not target.exists()
    assert not target.with_name(target.name + ".part").exists()


def test_survives_a_dropped_connection(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, pinned: bytes) -> None:
    class Dropped(io.BytesIO):
        def read(self, size: int | None = -1) -> bytes:
            raise http.client.IncompleteRead(b"partial")

    monkeypatch.setattr(google_files.urllib.request, "urlopen", lambda url, timeout: Dropped())
    found = files.locate_mapper(tmp_path, allow_download=True, log=lambda _: None)
    assert found.state == "unavailable"
    target = files.mapper_target(tmp_path)
    assert not target.exists()
    assert not target.with_name(target.name + ".part").exists()


def test_respects_offline(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, pinned: bytes) -> None:
    requested = serve(monkeypatch, pinned)
    found = files.locate_mapper(tmp_path, allow_download=False)
    assert requested == []
    assert found.state == "unavailable"
