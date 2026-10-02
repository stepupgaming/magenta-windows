# magenta-windows

Magenta RealTime 2 as a Windows desktop player. The window is a typed prompt stack with a weight on each line, a keyboard, and live knobs. Sound is generated on an NVIDIA GPU by `engine/`, a PyTorch CUDA server. The upstream Magenta app is MLX on Apple Silicon, and that is not this build.

The checkpoint is not in this repo. The first time you click **Load model**, the engine downloads about 10 GB from Hugging Face into your cache:

- `magenta-community/magenta-realtime-2`
- `magenta-torch/magenta-rt-musiccoca-torch`

If those snapshots are already on disk, set `HUGGINGFACE_HUB_CACHE` to that folder. A folder at `F:\Models\huggingface\hub` is used when it exists. Closing the window stops the Python process and frees the GPU.

You need Windows, an NVIDIA GPU with 16 GB of VRAM, a driver that can run CUDA 13, [Node.js 20+](https://nodejs.org/), [pnpm 10+](https://pnpm.io/installation), [Rust](https://www.rust-lang.org/tools/install), and [uv](https://docs.astral.sh/uv/).

```powershell
git clone https://github.com/stepupgaming/magenta-windows.git
cd magenta-windows
powershell -ExecutionPolicy Bypass -File .\setup.ps1
pnpm tauri dev
```

`setup.ps1` creates `engine\.venv` and installs the JavaScript dependencies. In the window, click **Load model**. The first load also captures a CUDA graph, so sound starts a few seconds after the weights are ready. Type any description. Add lines. Set a weight on each one.

The base model on a 16 GB card finishes each chunk a little after the speaker clock. The player holds about a second of audio and stretches time slightly so the stream does not chop. Pitch stays put.

The app shell is MIT. `engine/model_code` is an Apache-2.0 PyTorch port of `google/magenta-realtime-2`. The weight files stay under their Hugging Face license and are downloaded, not vendored.

A four-second CUDA proof, without the window:

```powershell
uv run --project engine python engine/server.py --smoke-seconds 4 --out engine/outputs/smoke.wav
```

## Getting Started

### Prerequisites

- **[Node.js](https://nodejs.org/)** v20 or higher
- **[pnpm](https://pnpm.io/installation)** v8 or higher
- **[Rust](https://www.rust-lang.org/tools/install)** (latest stable, needed for native builds)
- **uv** and an NVIDIA GPU for `engine/`

> [!NOTE]
> Building native apps requires additional platform-specific tools (e.g., Xcode, Android Studio, C++ Build Tools).
> See Tauri's [Prerequisites Guide](https://v2.tauri.app/start/prerequisites/) for details.

### Development

```bash
pnpm install
pnpm dev
```

`pnpm tauri dev` is the desktop player (http://localhost:3000). `pnpm web dev` is the browser shell on port 3001.

### Commands

```bash
pnpm dev                  # Start all apps in dev mode
pnpm build                # Build everything
pnpm check                # Check formatting and lint rules
pnpm fix                  # Auto-fix formatting and lint issues
pnpm typecheck            # TypeScript validation across all workspaces
pnpm web dev              # Web app only
pnpm tauri dev            # Desktop app only
pnpm tauri android dev    # Android app
pnpm tauri ios dev        # iOS app
pnpm shadcn add           # Add shadcn/ui components to packages/ui
pnpm clean                # Clean all build outputs
```

### Monorepo Structure

```
apps/
  web/                → Next.js SSR — web app, landing page, docs, PWA
  native/             → Next.js (Static) + Tauri 2 — desktop & mobile

packages/
  core/               → Business logic: pages, stores, hooks, providers, config
  ui/                 → Design system: shadcn/ui primitives, themes, styles
  i18n/               → Type-safe translations (SSR & static)
  typescript-config/  → Shared TypeScript configs
```

### Configuration

Before deploying or sharing your project, update the site metadata (URLs, headline, and description) in:
`packages/core/src/config/site.ts`

---

<div align="center">
  <sub>Built with <b><a href="https://github.com/odest/catalyzer">Catalyzer</a></b> - Accelerate your cross-platform app development</sub>
</div>
