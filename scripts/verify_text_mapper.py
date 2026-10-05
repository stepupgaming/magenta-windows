"""Check the PyTorch text mapper against Google's mapper.tflite.

This is a developer tool. It needs ai-edge-litert (the TFLite runtime) and
sentencepiece, which the engine itself does not:

    uv pip install ai-edge-litert sentencepiece
    python scripts/verify_text_mapper.py --resources DIR

DIR holds mapper.tflite, text_encoder.tflite, spm.model, and
pretrained_vector_quantizer.tflite from
https://storage.googleapis.com/magenta-rt-public/magenta-rt-2/resources/musiccoca/.
The script embeds real prompts with the TFLite text encoder, maps them with
both implementations, and compares the embeddings and the style tokens the
quantizer makes from them. It exits non-zero when they disagree.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

ENGINE = Path(__file__).resolve().parent.parent / "engine"
if str(ENGINE) not in sys.path:
    sys.path.insert(0, str(ENGINE))

from magenta_win.text_mapper import TextMapper, mapper_noise  # noqa: E402

PROMPTS = (
    "soothing chords",
    "lo-fi hip hop beat",
    "driving minimal techno",
    "warm rhodes electric piano",
    "dark cinematic soundtrack",
    "west african kora polyrhythms",
    "dusty jazz piano over lo-fi drums",
    "synthwave",
    "solo cello",
    "acid 303 bassline",
    "dreamy ambient pads with sub bass",
    "brazilian samba batucada percussion ensemble",
    "",
    "a",
    "heavily distorted granular textures with cavernous reverb and tape saturation",
)
MIN_COSINE = 0.99999
MAX_ABS = 1e-4
MAX_TEXT_TOKENS = 128


def interpreter(path: Path):
    from ai_edge_litert.interpreter import Interpreter

    model = Interpreter(model_path=str(path))
    model.allocate_tensors()
    return model


def embed_text(encoder, vocab, text: str) -> np.ndarray:
    """magenta_rt/musiccoca.py's _embed_batch_text, without the mapper."""
    ids_index = pad_index = -1
    ids_shape = pad_shape = None
    for detail in encoder.get_input_details():
        if detail["dtype"] == np.int32:
            ids_index, ids_shape = detail["index"], detail["shape"]
        elif detail["dtype"] == np.float32:
            pad_index, pad_shape = detail["index"], detail["shape"]
    labels = vocab.EncodeAsIds(text.lower())[: MAX_TEXT_TOKENS - 1]
    ids = np.array(([1] + labels + [0] * MAX_TEXT_TOKENS)[:MAX_TEXT_TOKENS], dtype=np.int32)
    paddings = np.ones(MAX_TEXT_TOKENS, dtype=np.float32)
    paddings[: len(labels) + 1] = 0.0
    encoder.set_tensor(ids_index, ids.reshape(ids_shape))
    encoder.set_tensor(pad_index, paddings.reshape(pad_shape))
    encoder.invoke()
    return encoder.get_tensor(encoder.get_output_details()[0]["index"]).reshape(-1).astype(np.float32)


def map_reference(mapper, embedding: np.ndarray) -> np.ndarray:
    """magenta_rt/musiccoca.py's mapper path."""
    inputs = mapper.get_input_details()
    mapper.set_tensor(inputs[0]["index"], embedding.reshape(inputs[0]["shape"]))
    mapper.set_tensor(inputs[1]["index"], mapper_noise().reshape(inputs[1]["shape"]))
    mapper.invoke()
    out = mapper.get_tensor(mapper.get_output_details()[0]["index"]).reshape(-1).astype(np.float32)
    return out / np.linalg.norm(out)


def quantize(quantizer, embedding: np.ndarray) -> np.ndarray:
    detail = quantizer.get_input_details()[0]
    quantizer.set_tensor(detail["index"], embedding.reshape(detail["shape"]).astype(np.float32))
    quantizer.invoke()
    return quantizer.get_tensor(quantizer.get_output_details()[0]["index"]).reshape(-1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--resources", type=Path, required=True)
    parser.add_argument("--random", type=int, default=200, help="Random unit vectors to check as well.")
    args = parser.parse_args()

    import sentencepiece

    vocab = sentencepiece.SentencePieceProcessor()
    vocab.Load(str(args.resources / "spm.model"))
    encoder = interpreter(args.resources / "text_encoder.tflite")
    reference = interpreter(args.resources / "mapper.tflite")
    quantizer = interpreter(args.resources / "pretrained_vector_quantizer.tflite")
    port = TextMapper.from_file(args.resources / "mapper.tflite")

    rng = np.random.default_rng(1234)
    random = rng.standard_normal((args.random, 768)).astype(np.float32)
    random /= np.linalg.norm(random, axis=1, keepdims=True)
    cases = [(repr(text), embed_text(encoder, vocab, text)) for text in PROMPTS]
    cases += [(f"random #{index}", vector) for index, vector in enumerate(random)]

    worst_cosine = 1.0
    worst_abs = 0.0
    token_mismatches = 0
    token_total = 0
    batch = np.stack([vector for _, vector in cases])
    import torch

    ported = port(torch.from_numpy(batch)).numpy()
    for (label, vector), mine in zip(cases, ported, strict=True):
        theirs = map_reference(reference, vector)
        cosine = float(np.dot(mine, theirs) / (np.linalg.norm(mine) * np.linalg.norm(theirs)))
        largest = float(np.max(np.abs(mine - theirs)))
        mine_tokens = quantize(quantizer, mine)
        their_tokens = quantize(quantizer, theirs)
        mismatched = int(np.sum(mine_tokens != their_tokens))
        worst_cosine = min(worst_cosine, cosine)
        worst_abs = max(worst_abs, largest)
        token_mismatches += mismatched
        token_total += mine_tokens.size
        if not label.startswith("random"):
            unmapped = float(np.dot(vector, theirs) / np.linalg.norm(vector))
            print(f"{label:>82}  cos {cosine:.8f}  max|d| {largest:.2e}  tokens {mine_tokens.size - mismatched}/{mine_tokens.size}  (mapping moves it to cos {unmapped:.3f})")

    print(f"\n{len(cases)} embeddings: worst cosine {worst_cosine:.8f}, worst max|d| {worst_abs:.2e}, "
          f"style tokens {token_total - token_mismatches}/{token_total} identical")
    ok = worst_cosine >= MIN_COSINE and worst_abs <= MAX_ABS
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
