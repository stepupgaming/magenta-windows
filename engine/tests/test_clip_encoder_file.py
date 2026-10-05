from __future__ import annotations

import hashlib
import http.client
import io
from pathlib import Path

import pytest

from magenta_win import google_files
from magenta_win.clip_encoder_file import locate_clip_encoder
from magenta_win.google_files import GoogleFile

ENCODER_BYTES = b"encoder" * 3000
QUANTIZER_BYTES = b"codebook" * 2000


def pinned(name: str, data: bytes, generation: int) -> GoogleFile:
    return GoogleFile(f"resources/spectrostream/{name}", hashlib.sha256(data).hexdigest(), len(data), generation)


FILES = (pinned("encoder.safetensors", ENCODER_BYTES, 11), pinned("quantizer.safetensors", QUANTIZER_BYTES, 12))
BODIES = {FILES[0].url: ENCODER_BYTES, FILES[1].url: QUANTIZER_BYTES}


def serve(monkeypatch: pytest.MonkeyPatch, bodies: dict[str, bytes]) -> list[str]:
    requested: list[str] = []

    def fake_urlopen(url: str, timeout: float) -> io.BytesIO:
        requested.append(url)
        return io.BytesIO(bodies[url])

    monkeypatch.setattr(google_files.urllib.request, "urlopen", fake_urlopen)
    return requested


def test_downloads_both_files_then_uses_the_cache(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    requested = serve(monkeypatch, BODIES)
    found = locate_clip_encoder(tmp_path, allow_download=True, log=lambda _: None, files=FILES)
    assert found.state == "on"
    assert found.encoder is not None and found.encoder.read_bytes() == ENCODER_BYTES
    assert found.quantizer is not None and found.quantizer.read_bytes() == QUANTIZER_BYTES
    assert requested == [FILES[0].url, FILES[1].url]
    assert found.encoder == google_files.target(tmp_path, FILES[0])
    again = serve(monkeypatch, {})
    assert locate_clip_encoder(tmp_path, allow_download=True, log=lambda _: None, files=FILES).state == "on"
    assert again == []


def test_offline_without_a_cache_is_unavailable(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    requested = serve(monkeypatch, BODIES)
    found = locate_clip_encoder(tmp_path, allow_download=False, files=FILES)
    assert found.state == "unavailable"
    assert found.encoder is None
    assert requested == []


def test_a_corrupt_download_is_rejected(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    serve(monkeypatch, {FILES[0].url: ENCODER_BYTES[:-1], FILES[1].url: QUANTIZER_BYTES})
    found = locate_clip_encoder(tmp_path, allow_download=True, log=lambda _: None, files=FILES)
    assert found.state == "unavailable"
    assert "encoder.safetensors" in found.detail
    target = google_files.target(tmp_path, FILES[0])
    assert not target.exists()
    assert not target.with_name(target.name + ".part").exists()


def test_a_dropped_connection_is_unavailable(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    class Dropped(io.BytesIO):
        def read(self, size: int | None = -1) -> bytes:
            raise http.client.IncompleteRead(b"partial")

    monkeypatch.setattr(google_files.urllib.request, "urlopen", lambda url, timeout: Dropped())
    found = locate_clip_encoder(tmp_path, allow_download=True, log=lambda _: None, files=FILES)
    assert found.state == "unavailable"
