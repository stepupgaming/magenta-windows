from __future__ import annotations

import numpy as np
import pytest
from tflite_builder import OperatorSpec, SubgraphSpec, TensorSpec, build_model

from magenta_win.tflite_reader import TFLiteFormatError, TFLiteModel

ADD = 0
CUMSUM = 128


def small_model() -> bytes:
    weights = np.arange(6, dtype=np.float32).reshape(2, 3)
    return build_model(
        [
            SubgraphSpec(
                name="main",
                tensors=[
                    TensorSpec("input", (2, 3)),
                    TensorSpec("weights", (2, 3), weights),
                    TensorSpec("output", (2, 3)),
                    TensorSpec("axis", (), np.array(1, dtype=np.int32), dtype="int32"),
                ],
                inputs=(0,),
                outputs=(2,),
                operators=[
                    OperatorSpec(ADD, (0, 1), (2,)),
                    OperatorSpec(CUMSUM, (2, 3), (2,), options=(0, 1)),
                ],
            )
        ]
    )


def test_reads_graph_structure() -> None:
    model = TFLiteModel(small_model())
    (graph,) = model.subgraphs
    assert graph.name == "main"
    assert graph.inputs == (0,)
    assert graph.outputs == (2,)
    assert [tensor.name for tensor in graph.tensors] == ["input", "weights", "output", "axis"]
    assert graph.tensors[1].shape == (2, 3)
    assert [operator.code for operator in graph.operators] == [ADD, CUMSUM]
    assert graph.operators[0].inputs == (0, 1)


def test_reads_constants_and_skips_runtime_tensors() -> None:
    model = TFLiteModel(small_model())
    (graph,) = model.subgraphs
    np.testing.assert_array_equal(model.constant(graph.tensors[1]), np.arange(6, dtype=np.float32).reshape(2, 3))
    assert model.constant(graph.tensors[0]) is None
    assert int(model.constant(graph.tensors[3])) == 1


def test_reads_operator_options() -> None:
    model = TFLiteModel(small_model())
    options = model.subgraphs[0].operators[1].options
    assert options is not None
    assert options.scalar(1, "<i") == 1
    assert model.subgraphs[0].operators[0].options is None


def test_returns_copies_of_constants() -> None:
    model = TFLiteModel(small_model())
    first = model.constant(model.subgraphs[0].tensors[1])
    assert first is not None
    first[0, 0] = 99
    again = model.constant(model.subgraphs[0].tensors[1])
    assert again is not None and again[0, 0] == 0


def test_rejects_files_that_are_not_tflite() -> None:
    with pytest.raises(TFLiteFormatError):
        TFLiteModel(b"not a model at all")
    with pytest.raises(TFLiteFormatError):
        TFLiteModel(build_model([SubgraphSpec("main", [], (), ())], identifier=b"ABCD"))


def test_rejects_truncated_files() -> None:
    data = small_model()
    with pytest.raises(TFLiteFormatError):
        TFLiteModel(data[: len(data) // 3])


def test_rejects_a_constant_that_does_not_fit_its_shape() -> None:
    data = build_model(
        [
            SubgraphSpec(
                "main",
                [TensorSpec("short", (4, 4), np.zeros(3, dtype=np.float32))],
                (),
                (0,),
            )
        ]
    )
    model = TFLiteModel(data)
    with pytest.raises(TFLiteFormatError):
        model.constant(model.subgraphs[0].tensors[0])
