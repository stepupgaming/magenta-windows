from __future__ import annotations

import importlib

import pytest
import torch
from torch import nn

pytest.importorskip("transformers")
pytest.importorskip("fastapi")
server = importlib.import_module("server")


def test_jobs_run_without_autograd() -> None:
    assert server.GpuLane().call(torch.is_grad_enabled) is False
    assert torch.is_grad_enabled()


def test_steering_keeps_the_source_buffer_out_of_autograd() -> None:
    # The session encodes each steer with trainable weights and copies the
    # result into the CUDA graph's static source buffer. With autograd on,
    # that copy chains every steer's graph onto the buffer and VRAM grows.
    encoder = nn.Linear(16, 16)
    with torch.no_grad():
        source = torch.zeros(4, 16)

    def steer() -> bool:
        source.copy_(encoder(torch.randn(4, 16)))
        return source.requires_grad

    lane = server.GpuLane()
    assert [lane.call(steer) for _ in range(3)] == [False, False, False]
    assert source.grad_fn is None
