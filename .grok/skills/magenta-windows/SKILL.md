---
name: magenta-windows
description: >
  Run, install, and release the Windows Magenta RealTime 2 player and CLI in
  this repo. Use when the user mentions magenta-windows, the magenta command,
  npx or bunx magenta, bun run dev, a Windows release, or the Magenta weights.
  Slash command: /magenta-windows.
---

# magenta-windows

Read `README.md` before inventing a command. The help menu is `node bin/magenta.mjs --help`. That command does not import PyTorch and does not load weights.

## Rules

- Windows only. Do not route this project through WSL.
- Do not run `magenta load` or `magenta generate` unless the user asked for audio or a loaded model.
- Do not leave the server running. `magenta generate` must exit. If you started `magenta serve` or the desktop window, stop it before you finish.
- Do not commit weights, wavs, `engine/.venv`, `release-weights/`, or `stage.mp4`.
- The checkpoint is about 9 GB. GitHub release assets are capped at 2 GB. The release stores parts named `magenta-weights-####.part` plus `magenta-weights.json`. Do not try to upload `model.safetensors` as one asset.
- `npx magenta` is the wrong package. The package name is `magenta-windows`. The binary is `magenta`.

## Commands

From the repo root:

- `node .\bin\magenta.mjs --help`
- `npx --package github:stepupgaming/magenta-windows magenta --help`
- `bunx --package github:stepupgaming/magenta-windows magenta --help`
- `bun run dev` opens the desktop window. It calls pnpm. Do not launch it unless the user asked to see the window.
- `pnpm mock` runs `scripts/mock-engine.mjs`, a stand-in engine on port 8765 that plays test tones. Use it with `pnpm --filter native dev` to work on the window without a GPU. Stop it when you finish.
- `pnpm test` runs the stage unit tests. It needs no GPU.
- `cd engine && uv run --with pytest --with flatbuffers pytest tests` runs the engine tests. It needs no GPU or weights. They cover the streamer on a tiny random model, the session, the GPU lane, the silence watchdog, the text mapper, and continuing from a clip. Set `MAGENTA_TEST_SPECTROSTREAM` to a folder with Google's `encoder.safetensors` and `quantizer.safetensors` to check the encoder against Google's reference codes.
- `magenta generate --continue song.wav --seconds 20` renders a continuation of an audio file, with `--lead-in` seconds of the file first.
- The Windows release file is `Magenta.exe`. Download it from the GitHub release and run it. First launch installs PyTorch and the checkpoint. Do not build an NSIS installer.
- `powershell -ExecutionPolicy Bypass -File .\install.ps1` installs the `magenta` command onto the user PATH. A test install passes `-Prefix` and `-NoPath`.

`generate` writes one wav and exits. Tell the user the absolute path of that wav. The default relative path is `magenta.wav` in the current directory. Pass an absolute `--out` when you need a stable path.

Weight lookup lives in `engine/magenta_win/cache_path.py`. `scripts/release_weights.py ensure` uses a local snapshot first, then the GitHub release parts. `python .\scripts\release_weights.py self-test` checks the splitter without a GPU.

The Windows release workflow is `.github/workflows/release-windows.yml`. A Release Please tag starts it only when the `RELEASE_PLEASE_TOKEN` secret holds a personal access token; otherwise run it with the new tag, such as `v0.1.2`. It downloads the public Hugging Face checkpoints on the runner, then `scripts/release_notes.py` writes the notes from `CHANGELOG.md`. Do not upload Steve's `F:\` cache by hand.
