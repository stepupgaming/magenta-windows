# magenta-windows

Windows desktop player and command line for Magenta RealTime 2. The sound engine is PyTorch on NVIDIA CUDA in `engine/`. The window is a prompt stack with a weight on each line. The upstream Magenta app is MLX on Apple Silicon.

An agent working in this repo should read this file, then `.grok/skills/magenta-windows/SKILL.md`. Run `magenta --help` before guessing flags. `magenta --help` does not load the model.

## What uses the GPU

| Command | GPU |
| --- | --- |
| `magenta --help`, `magenta health`, `magenta stop` | No |
| `magenta serve` | No, until something calls load |
| `magenta load` | Yes. The checkpoint stays loaded until `magenta stop` |
| `magenta generate` | Yes. One process loads the checkpoint, writes a wav, and exits |
| `bun run dev` | Starts the window. The model loads when the user clicks Load model |

Do not run `load` or `generate` unless the user asked for audio or a loaded model. Do not start a second generate while port 8765 is open. `generate` refuses that case because a second copy fills a 16 GB card.

## Install

Requirements: Windows, an NVIDIA GPU with 16 GB, and a driver that can run CUDA 13.

Download [Magenta.exe](https://github.com/stepupgaming/magenta-windows/releases/latest/download/Magenta.exe) and run it. The first launch installs PyTorch and downloads the checkpoint into your user profile. The window opens while that runs. The header line shows the step. Closing the window stops the setup.

A checkout is for development. It needs Node.js 20+, uv, pnpm 10, and Rust.

From a checkout, without changing PATH:

```powershell
node .\bin\magenta.mjs --help
bun run magenta -- --help
```

After this repo is on GitHub, the same launcher is:

```powershell
npx --package github:stepupgaming/magenta-windows magenta --help
bunx --package github:stepupgaming/magenta-windows magenta --help
bun install -g github:stepupgaming/magenta-windows
```

`npx magenta` is a different package. Use the `magenta-windows` package name. The binary it runs is named `magenta`.

## Commands that exist

```powershell
magenta serve
magenta health
magenta load
magenta stop
magenta generate --prompt "soothing chords" --prompt "dusty breakbeat:0.4" --seconds 8 --out take.wav
bun run dev
pnpm dev
```

`bun run dev` and `pnpm dev` both run `bin/dev.mjs`, which runs `pnpm --filter native tauri dev`. That opens the desktop window at http://localhost:3000. `pnpm web dev` is the browser shell on port 3001.

`generate` defaults: temperature 1.05, top-k 48, style 2.4, note strength 0.8, drums off, seed 7, wav path `magenta.wav`. `--seconds` is required and the maximum is 120. Repeat `--prompt` up to 8 times. A weight is `TEXT:WEIGHT`. The full menu is `magenta generate --help`.

The window still starts `engine\server.py` with no flags. That process listens on `127.0.0.1:8765`.

## Weights

The checkpoint is not in git. `model.safetensors` is about 9 GB. GitHub allows 2 GB per release asset, so `.github/workflows/release-windows.yml` downloads the public Hugging Face files and uploads ordered parts plus `magenta-weights.json`.

`scripts/release_weights.py ensure` looks in this order:

1. `HUGGINGFACE_HUB_CACHE` when that variable is set.
2. `F:\Models\huggingface\hub` when that folder exists.
3. `%USERPROFILE%\.cache\huggingface\hub`.
4. The latest GitHub release parts, reassembled into that cache.

If the release does not exist yet, `magenta load` and `magenta generate` download these repos from Hugging Face:

- `magenta-community/magenta-realtime-2`
- `magenta-torch/magenta-rt-musiccoca-torch`

Pack or check the splitter without touching the GPU:

```powershell
python .\scripts\release_weights.py self-test
```

Publish a release by pushing a `v0.0.0` tag, or by running the `Release Windows` workflow with a tag such as `v0.1.0`.

## Layout

- `bin/magenta.mjs` is the npx and bunx launcher.
- `bin/dev.mjs` opens the desktop window.
- `engine/magenta_win/cli.py` is the command line.
- `engine/server.py` is the CUDA server.
- `engine/model_code` is the Apache-2.0 PyTorch port of `google/magenta-realtime-2`.
- `Magenta.exe` on the GitHub release is the app. First launch extracts the engine under `%LOCALAPPDATA%\Magenta\app` when the exe is outside a checkout.
- `install.ps1` puts the `magenta` command on PATH for a checkout-style install. The release does not use it.
- `.grok/skills/magenta-windows/SKILL.md` is the agent skill.

## License

The app shell is MIT (`LICENSE`, Copyright (c) 2026 Dest). `engine/model_code` is Apache-2.0. The weight files stay under their Hugging Face licenses and are downloaded, not vendored into git.
