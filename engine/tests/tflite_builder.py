"""Write small TFLite flatbuffers for tests, following tensorflow/lite/schema.fbs."""

from __future__ import annotations

from dataclasses import dataclass, field

import flatbuffers
import numpy as np

_TYPES = {np.dtype("float32"): 0, np.dtype("int32"): 2}


@dataclass
class TensorSpec:
    name: str
    shape: tuple[int, ...]
    value: np.ndarray | None = None
    dtype: str = "float32"


@dataclass
class OperatorSpec:
    code: int
    inputs: tuple[int, ...]
    outputs: tuple[int, ...]
    # WhileOptions-style table of int32 fields, written in slot order.
    options: tuple[int, ...] = ()


@dataclass
class SubgraphSpec:
    name: str
    tensors: list[TensorSpec]
    inputs: tuple[int, ...]
    outputs: tuple[int, ...]
    operators: list[OperatorSpec] = field(default_factory=list)


def _int_vector(builder: flatbuffers.Builder, values: tuple[int, ...]) -> int:
    builder.StartVector(4, len(values), 4)
    for value in reversed(values):
        builder.PrependInt32(value)
    return builder.EndVector()


def _offset_vector(builder: flatbuffers.Builder, offsets: list[int]) -> int:
    builder.StartVector(4, len(offsets), 4)
    for offset in reversed(offsets):
        builder.PrependUOffsetTRelative(offset)
    return builder.EndVector()


def build_model(subgraphs: list[SubgraphSpec], identifier: bytes = b"TFL3") -> bytes:
    """A TFLite model whose constants carry the given values."""
    builder = flatbuffers.Builder(1024)
    codes = sorted({operator.code for graph in subgraphs for operator in graph.operators})
    payloads: list[bytes] = [b""]
    for graph in subgraphs:
        for tensor in graph.tensors:
            if tensor.value is not None:
                payloads.append(np.ascontiguousarray(tensor.value, dtype=tensor.dtype).tobytes())
    buffer_offsets = []
    for payload in payloads:
        data = builder.CreateByteVector(payload) if payload else None
        builder.StartObject(3)
        if data is not None:
            builder.PrependUOffsetTRelativeSlot(0, data, 0)
        buffer_offsets.append(builder.EndObject())

    graph_offsets = []
    next_buffer = 1
    for graph in subgraphs:
        tensor_offsets = []
        for tensor in graph.tensors:
            name = builder.CreateString(tensor.name)
            shape = _int_vector(builder, tensor.shape)
            buffer = 0
            if tensor.value is not None:
                buffer = next_buffer
                next_buffer += 1
            builder.StartObject(4)
            builder.PrependUOffsetTRelativeSlot(0, shape, 0)
            builder.PrependInt8Slot(1, _TYPES[np.dtype(tensor.dtype)], -1)
            builder.PrependUint32Slot(2, buffer, 0)
            builder.PrependUOffsetTRelativeSlot(3, name, 0)
            tensor_offsets.append(builder.EndObject())
        operator_offsets = []
        for operator in graph.operators:
            options = None
            if operator.options:
                builder.StartObject(len(operator.options))
                for slot, value in enumerate(operator.options):
                    builder.PrependInt32Slot(slot, value, -1)
                options = builder.EndObject()
            inputs = _int_vector(builder, operator.inputs)
            outputs = _int_vector(builder, operator.outputs)
            builder.StartObject(5)
            builder.PrependUint32Slot(0, codes.index(operator.code), 0xFFFFFFFF)
            builder.PrependUOffsetTRelativeSlot(1, inputs, 0)
            builder.PrependUOffsetTRelativeSlot(2, outputs, 0)
            if options is not None:
                builder.PrependUint8Slot(3, 1, 0)
                builder.PrependUOffsetTRelativeSlot(4, options, 0)
            operator_offsets.append(builder.EndObject())
        name = builder.CreateString(graph.name)
        tensors = _offset_vector(builder, tensor_offsets)
        inputs = _int_vector(builder, graph.inputs)
        outputs = _int_vector(builder, graph.outputs)
        operators = _offset_vector(builder, operator_offsets)
        builder.StartObject(5)
        builder.PrependUOffsetTRelativeSlot(0, tensors, 0)
        builder.PrependUOffsetTRelativeSlot(1, inputs, 0)
        builder.PrependUOffsetTRelativeSlot(2, outputs, 0)
        builder.PrependUOffsetTRelativeSlot(3, operators, 0)
        builder.PrependUOffsetTRelativeSlot(4, name, 0)
        graph_offsets.append(builder.EndObject())

    code_offsets = []
    for code in codes:
        builder.StartObject(4)
        builder.PrependInt8Slot(0, min(code, 127), 0)
        builder.PrependInt32Slot(3, code, 0)
        code_offsets.append(builder.EndObject())
    code_vector = _offset_vector(builder, code_offsets)
    graph_vector = _offset_vector(builder, graph_offsets)
    buffer_vector = _offset_vector(builder, buffer_offsets)
    builder.StartObject(5)
    builder.PrependUint32Slot(0, 3, 0)
    builder.PrependUOffsetTRelativeSlot(1, code_vector, 0)
    builder.PrependUOffsetTRelativeSlot(2, graph_vector, 0)
    builder.PrependUOffsetTRelativeSlot(4, buffer_vector, 0)
    model = builder.EndObject()
    builder.Finish(model, file_identifier=identifier)
    return bytes(builder.Output())
