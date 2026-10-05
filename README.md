# magenta-windows

Windows desktop player and command line for Magenta RealTime 2. The sound engine is PyTorch on NVIDIA CUDA in `engine/`. The window is a live instrument: blend text and audio prompts, play notes from the keys or a MIDI controller, morph between scenes, and record what you hear. The upstream Magenta app is MLX on Apple Silicon.

An agent working in this repo should read this file, then `.grok/skills/magenta-windows/SKILL.md`. Run `magenta --help` before guessing flags. `magenta --help` does not load the model.

## What uses the GPU

| Command | GPU |
| --- | --- |
| `magenta --help`, `magenta health`, `magenta stop` | No |
| `magenta serve` | No, until something calls load |
| `magenta load` | Yes. The checkpoint stays loaded until `magenta stop` |
| `magenta generate` | Yes. One process loads the checkpoint, writes a wav, and exits |
| `bun run dev` | Starts the window. The model loads when the user presses Play |
| `pnpm mock` | No. A stand-in engine that plays test tones, for working on the window |

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

`generate` defaults: temperature 1.05, top-k 48, style 2.4, style detail 6, note strength 0.8, drums off, seed 7, wav path `magenta.wav`. `--seconds` is required and the maximum is 120. Repeat `--prompt` up to 8 times. A weight is `TEXT:WEIGHT`. `--continue song.wav` makes the model carry on from the end of any audio file instead of starting fresh, and the wav starts with `--lead-in` seconds of the file (4 by default) so you hear the join. The full menu is `magenta generate --help`.

The window still starts `engine\server.py` with no flags. That process listens on `127.0.0.1:8765`.

## The stage

The window has five areas. Every control can also be reached from the command palette (Ctrl K), and `?` lists the shortcuts.

- **Style.** Up to eight prompts, blended by weight. List mode gives each prompt a fader with mute and solo. Space mode places prompts in a field and blends them by distance from a listener you drag, fling, or set to orbit. A prompt can be text or a slice of an audio file (drop one on the panel). The Library (/) searches several hundred prompts by genre, instrument, mood, texture, region, and era. It has starter blends, favorites, recents, and preview as you browse.
- **Model.** Style strength, style detail, note strength, temperature, and a spring-loaded Chaos knob that the pitch wheel also drives. Style detail is how many of the 12 style tokens steer, coarsest first. Google's apps use 6, and so does the default. Drums are auto, on, or off. Choices (top-k) and the seed change while the music plays. Fresh clears the model's memory. If the model falls silent while it should be playing, the engine wakes it after six seconds and says so.
- **Continue.** The model can pick up from any audio as if it had just played it. Rewind (Backspace) goes back 5 to 20 seconds in what the model played and lets it take the music somewhere new from there. A take, or a file of your own (Rewind menu, Continue from a file), works the same way. The engine hears up to 28 seconds, replays the last two so you hear the join, and the new music starts about a second before the end, steered by your prompts and notes.
- **Scenes.** Eight slots that store the prompts and knobs. Number keys recall them with a morph over a set number of beats, or a cut. A scene saved while playing also remembers the model's groove, and a cut back to it picks the music up from there.
- **Notes.** Jam lets the model accompany the notes you hold. Solo plays only your notes. Hold latches chords, Strum lets held notes re-strike, Clearance keeps the model off neighboring semitones. The keys are A to ' on the home row, Z and X change octave. Chord pads follow a key, and a progression plays at the tempo.
- **Effects and takes.** DJ filter, three-band EQ, tempo-synced echo, reverb, and a limiter run in the window. Rec records what you hear. Keep (C) saves the last 10 to 60 seconds that already played. Takes download as WAV or go back in as an audio prompt.

MIDI works without setup: keys play notes, the sustain pedal holds, program changes recall scenes. MIDI learn (M) maps any knob or fader to a controller.

To work on the window without a GPU, run the stand-in engine and the window in two terminals:

```powershell
pnpm mock
pnpm --filter native dev
```

`pnpm test` runs the unit tests for the stage logic. The engine has its own tests, which also need no GPU:

```powershell
cd engine
uv run --with pytest --with flatbuffers pytest tests
```

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

Text prompts also go through the MusicCoCa text mapper, as they do in Google's apps. It is about 86 MB, comes from `magenta-rt-public` on Google Cloud Storage, and lands in the same cache under `models--google--magenta-realtime-2`. The first load downloads it when it is missing, and new releases include it. Without it the model still plays, but text prompts land on different style tokens than upstream. Set `MAGENTA_TEXT_MAPPER=off` to skip it.

Continuing from audio uses Google's SpectroStream encoder and its codebook, about 37 MB and 67 MB from the same bucket, kept in the same place. They download with the model unless `HF_HUB_OFFLINE=1`, and new releases include them. Without them everything else still works, and Settings says why continuing is unavailable.

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
- `packages/core/src/studio` is the stage. `ui/` holds its components.
- `scripts/mock-engine.mjs` is the stand-in engine for GPU-free development.
- `Magenta.exe` on the GitHub release is the app. First launch extracts the engine under `%LOCALAPPDATA%\Magenta\app` when the exe is outside a checkout.
- `install.ps1` puts the `magenta` command on PATH for a checkout-style install. The release does not use it.
- `.grok/skills/magenta-windows/SKILL.md` is the agent skill.

## License

The app shell is MIT (`LICENSE`, Copyright (c) 2026 Dest). `engine/model_code` is Apache-2.0. The weight files stay under their Hugging Face licenses and are downloaded, not vendored into git. `engine/magenta_win/text_mapper.py` reimplements the architecture of Google's MusicCoCa text mapper. Its weights, `mapper.tflite` from Magenta RealTime 2, are by Google and licensed CC BY 4.0. `engine/model_code/spectrostream_encoder.py` comes from the community PyTorch port (Apache-2.0), and the SpectroStream encoder and codebook weights it loads are also Google's, under CC BY 4.0.
