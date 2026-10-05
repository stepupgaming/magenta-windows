"""Read tensors and operators out of a TFLite flatbuffer with only numpy.

Magenta's text mapper ships as a TFLite file. The engine runs it in PyTorch,
so it only needs the constant tensors and enough of the graph to check that
the file is the one the port was written for. This module reads that much of
the TFLite schema (https://github.com/google/flatbuffers, schema.fbs in
tensorflow/lite) and nothing else, so the engine does not depend on a
TFLite runtime.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np

FILE_IDENTIFIER = b"TFL3"

# TensorType values from schema.fbs.
_DTYPES: dict[int, np.dtype] = {
    0: np.dtype("<f4"),
    1: np.dtype("<f2"),
    2: np.dtype("<i4"),
    3: np.dtype("u1"),
    4: np.dtype("<i8"),
    6: np.dtype("?"),
    7: np.dtype("<i2"),
    9: np.dtype("i1"),
    10: np.dtype("<f8"),
}

# Field slots in schema.fbs tables.
_MODEL_OPERATOR_CODES = 1
_MODEL_SUBGRAPHS = 2
_MODEL_BUFFERS = 4
_CODE_DEPRECATED_BUILTIN = 0
_CODE_BUILTIN = 3
_SUBGRAPH_TENSORS = 0
_SUBGRAPH_INPUTS = 1
_SUBGRAPH_OUTPUTS = 2
_SUBGRAPH_OPERATORS = 3
_SUBGRAPH_NAME = 4
_TENSOR_SHAPE = 0
_TENSOR_TYPE = 1
_TENSOR_BUFFER = 2
_TENSOR_NAME = 3
_OPERATOR_CODE_INDEX = 0
_OPERATOR_INPUTS = 1
_OPERATOR_OUTPUTS = 2
_OPERATOR_OPTIONS = 4
_BUFFER_DATA = 0
_BUFFER_OFFSET = 1
_BUFFER_SIZE = 2


class TFLiteFormatError(ValueError):
    """The bytes are not a TFLite model this reader understands."""


class _Table:
    """Read-only view of one flatbuffer table."""

    def __init__(self, data: bytes, position: int) -> None:
        self._data = data
        self._position = position
        self._check(position, 4)
        vtable = position - self._read("<i", position)
        self._check(vtable, 4)
        self._vtable = vtable
        self._vtable_size = self._read("<H", vtable)

    def _check(self, position: int, size: int) -> None:
        if position < 0 or position + size > len(self._data):
            raise TFLiteFormatError("flatbuffer offset points outside the file")

    def _read(self, fmt: str, position: int) -> int | float:
        self._check(position, struct.calcsize(fmt))
        return struct.unpack_from(fmt, self._data, position)[0]

    def _field(self, slot: int) -> int:
        entry = 4 + 2 * slot
        if entry + 2 > self._vtable_size:
            return 0
        return int(self._read("<H", self._vtable + entry))

    def scalar(self, slot: int, fmt: str, default: int | float = 0) -> int | float:
        offset = self._field(slot)
        if not offset:
            return default
        return self._read(fmt, self._position + offset)

    def _target(self, slot: int) -> int | None:
        offset = self._field(slot)
        if not offset:
            return None
        at = self._position + offset
        return at + int(self._read("<I", at))

    def table(self, slot: int) -> _Table | None:
        target = self._target(slot)
        return None if target is None else _Table(self._data, target)

    def vector(self, slot: int) -> tuple[int, int]:
        """Start and length of a vector field, or (0, 0) when it is absent."""
        target = self._target(slot)
        if target is None:
            return 0, 0
        length = int(self._read("<I", target))
        return target + 4, length

    def ints(self, slot: int) -> list[int]:
        start, length = self.vector(slot)
        if not length:
            return []
        self._check(start, 4 * length)
        return list(struct.unpack_from(f"<{length}i", self._data, start))

    def tables(self, slot: int) -> list[_Table]:
        start, length = self.vector(slot)
        self._check(start, 4 * length)
        return [
            _Table(self._data, start + 4 * index + int(self._read("<I", start + 4 * index)))
            for index in range(length)
        ]

    def string(self, slot: int) -> str:
        start, length = self.vector(slot)
        if not length:
            return ""
        self._check(start, length)
        return self._data[start : start + length].decode("utf-8", errors="replace")


@dataclass(frozen=True)
class Tensor:
    index: int
    name: str
    shape: tuple[int, ...]
    dtype: np.dtype | None
    buffer: int


@dataclass(frozen=True)
class Operator:
    code: int
    inputs: tuple[int, ...]
    outputs: tuple[int, ...]
    options: _Table | None


@dataclass(frozen=True)
class Subgraph:
    name: str
    tensors: tuple[Tensor, ...]
    inputs: tuple[int, ...]
    outputs: tuple[int, ...]
    operators: tuple[Operator, ...]


class TFLiteModel:
    """The subgraphs and constant tensors of a TFLite file."""

    def __init__(self, data: bytes) -> None:
        if len(data) < 8 or data[4:8] != FILE_IDENTIFIER:
            raise TFLiteFormatError("missing the TFL3 file identifier")
        self._data = data
        root = _Table(data, int(struct.unpack_from("<I", data, 0)[0]))
        self._codes = [
            max(int(code.scalar(_CODE_DEPRECATED_BUILTIN, "<b")), int(code.scalar(_CODE_BUILTIN, "<i")))
            for code in root.tables(_MODEL_OPERATOR_CODES)
        ]
        self._buffers = root.tables(_MODEL_BUFFERS)
        self.subgraphs = tuple(self._subgraph(graph) for graph in root.tables(_MODEL_SUBGRAPHS))
        if not self.subgraphs:
            raise TFLiteFormatError("the model has no subgraphs")

    @classmethod
    def read(cls, path: Path) -> TFLiteModel:
        return cls(path.read_bytes())

    def _subgraph(self, graph: _Table) -> Subgraph:
        tensors = []
        for index, tensor in enumerate(graph.tables(_SUBGRAPH_TENSORS)):
            type_code = int(tensor.scalar(_TENSOR_TYPE, "<b"))
            tensors.append(
                Tensor(
                    index=index,
                    name=tensor.string(_TENSOR_NAME),
                    shape=tuple(tensor.ints(_TENSOR_SHAPE)),
                    dtype=_DTYPES.get(type_code),
                    buffer=int(tensor.scalar(_TENSOR_BUFFER, "<I")),
                )
            )
        operators = []
        for operator in graph.tables(_SUBGRAPH_OPERATORS):
            code_index = int(operator.scalar(_OPERATOR_CODE_INDEX, "<I"))
            if code_index >= len(self._codes):
                raise TFLiteFormatError("operator refers to a missing operator code")
            operators.append(
                Operator(
                    code=self._codes[code_index],
                    inputs=tuple(operator.ints(_OPERATOR_INPUTS)),
                    outputs=tuple(operator.ints(_OPERATOR_OUTPUTS)),
                    options=operator.table(_OPERATOR_OPTIONS),
                )
            )
        return Subgraph(
            name=graph.string(_SUBGRAPH_NAME),
            tensors=tuple(tensors),
            inputs=tuple(graph.ints(_SUBGRAPH_INPUTS)),
            outputs=tuple(graph.ints(_SUBGRAPH_OUTPUTS)),
            operators=tuple(operators),
        )

    def constant(self, tensor: Tensor) -> np.ndarray | None:
        """The tensor's stored value, or None when it is computed at run time."""
        if tensor.buffer == 0 or tensor.buffer >= len(self._buffers):
            return None
        if tensor.dtype is None:
            raise TFLiteFormatError(f"tensor {tensor.name!r} has a type this reader does not support")
        buffer = self._buffers[tensor.buffer]
        start, length = buffer.vector(_BUFFER_DATA)
        if not length:
            # Models over 2 GB keep tensor bytes after the flatbuffer.
            offset = int(buffer.scalar(_BUFFER_OFFSET, "<Q"))
            length = int(buffer.scalar(_BUFFER_SIZE, "<Q"))
            if offset <= 1 or not length:
                return None
            start = offset
        count = int(np.prod(tensor.shape, dtype=np.int64)) if tensor.shape else 1
        if count * tensor.dtype.itemsize != length:
            raise TFLiteFormatError(f"tensor {tensor.name!r} does not match its buffer size")
        if start + length > len(self._data):
            raise TFLiteFormatError(f"tensor {tensor.name!r} runs past the end of the file")
        values = np.frombuffer(self._data, dtype=tensor.dtype, count=count, offset=start)
        return values.reshape(tensor.shape).copy()
