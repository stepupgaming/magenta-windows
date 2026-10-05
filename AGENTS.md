# magenta-2-windows

Windows desktop app for Magenta RealTime 2. Catalyzer (Next.js + Tauri 2) draws the stage. `engine/server.py` is the NVIDIA CUDA renderer: PyTorch, one CUDA graph, websocket PCM at 48 kHz. Upstream MLX, the Mac apps, and WSL are not the product path.

The desktop window is the player. Native layout does not draw the Catalyzer sidebar. It does provide sidebar context so the settings page can be statically exported. The stage (`packages/core/src/studio`, components in `studio/ui`) is a live instrument. Style blends up to eight text or audio prompts, either as a list of faders or as a 2D Space where a listener's distance sets the blend. The sound library (`library-data.ts`, about 900 researched prompts and 40 blends) opens with `/` and searches by text and tags. Notes come from the orange keyboard, the computer keys, MIDI, chord pads, or a chord progression. Jam lets the model accompany them and Solo plays only them. The model knobs are style strength, note strength, drum strength, temperature, spring-loaded Chaos, choices (top-k), and seed. Eight scenes morph or cut. Effects, the limiter, recording, and retro capture run in the window. `conductor.ts` sends the engine one spec (`spec.ts`) whenever it changes. There is no footage in the window. Playback runs in an audio-thread worklet (`apps/*/public/pcm-worklet.js`, keep both copies identical), which also hosts the tap that meters, records, and keeps the last minute for retro capture. The base model on this GPU finishes each chunk a little after the speaker clock (about 0.94x), so the worklet holds about one second and time-stretches to keep that cushion. Pitch stays put. Tempo sits a little under the model's native pace. Tauri starts `engine/server.py` with `engine/.venv`. That launcher and the uv interpreter it starts are placed in a Windows job destroyed with the window process, including a hard kill, so closing the app unloads the GPU. An engine already listening on port 8765 is adopted into that job only when its command line is this repo's `server.py`. A checkout named `magenta-windows` counts the same as `magenta-2-windows`. The command line is `magenta` (`engine/magenta_win/cli.py`). Launch it with `magenta.cmd`, `node bin/magenta.mjs`, `npx --package github:stepupgaming/magenta-windows magenta`, or `bunx --package github:stepupgaming/magenta-windows magenta`. `bun run dev` and `pnpm dev` open the desktop window through `bin/dev.mjs`. The Windows release asset is `Magenta.exe` from `pnpm --filter native exec tauri build --no-bundle`. There is no NSIS or MSI installer. A downloaded exe extracts `engine/` and `scripts/release_weights.py` to `%LOCALAPPDATA%\Magenta\app`, runs `uv sync` when `engine\.venv\Scripts\python.exe` is missing, then `release_weights.py ensure`. An exe launched inside this checkout uses the checkout and its existing venv and does not download weights again. Setup processes are in the same kill-on-close job as the server. The window reads `bootstrap_status` while the engine is down. `magenta --help` does not import PyTorch. `serve` listens on `127.0.0.1:8765` with the model unloaded. `load` leaves the checkpoint resident until `stop`. `generate` renders one wav in its own process, refuses to start while that port is open, and exits. `server.py` remains the process the window starts. Its websocket takes `start`, `steer`, `restart`, and `stop`. A steer may carry `cut: true` to flush the old style at once. Prompts are `{text, weight}` or `{audio, weight}`, where the audio id comes from `POST /audio-prompt` (16 kHz mono float32). The release weights carry only the MusicCoCa text encoder, so the first audio prompt downloads `music_encoder.pt` and `mel_params.npz` from the MusicCoCa repo unless `HF_HUB_OFFLINE=1`. `drums` is `auto`, `on`, or `off` (the old boolean still works). Note slots are -1 masked, 0 off, 1 sustain, 2 onset, 3 on, and `onsets: true` makes the server mark fresh notes as onsets for one frame. `free_style: true` lets an empty blend leave the style unconditioned. Text prompts pass through the text mapper before blending, as upstream does: `engine/magenta_win/text_mapper.py` is a PyTorch port of Google's `mapper.tflite` that reads its weights straight from that file (`tflite_reader.py`, numpy only). Audio prompts skip it. `text_mapper_file.py` finds the file in the weight cache at `models--google--magenta-realtime-2/snapshots/*/resources/musiccoca/mapper.tflite`, or downloads it from the public `magenta-rt-public` bucket with a pinned SHA-256. `MAGENTA_TEXT_MAPPER=off` disables it, and a path selects a file. A missing mapper never stops the model; `/health` reports `text_mapper`. `scripts/verify_text_mapper.py` compares the port with the TFLite runtime. `scripts/mock-engine.mjs` (`pnpm mock`) speaks the same protocol with test tones so the window can be built without a GPU. Weights are not committed. `.github/workflows/release-windows.yml` downloads the public checkpoints and uploads them as parts under GitHub's 2 GB asset limit, with `magenta-weights.json` as the manifest. `scripts/release_weights.py ensure` uses a local snapshot when one exists, otherwise those release parts. The agent skill is `.grok/skills/magenta-windows/SKILL.md`. Weights come from `HUGGINGFACE_HUB_CACHE` when that is set, otherwise `F:\Models\huggingface\hub` if that folder exists, otherwise the default Hugging Face cache. A missing snapshot downloads on first load unless `HF_HUB_OFFLINE=1`. Do not vendor the 9 GB checkpoint into this repo. `engine/model_code` is the executable PyTorch port and stays in git.

Cross-platform app shell is still Next.js 16 and Tauri 2 in a pnpm monorepo. The web app (`apps/web`) runs with server-side rendering. The native app (`apps/native`) static-exports the same pages into a WebView2 window. Both import pages from `packages/core` and primitives from `packages/ui`.

The project includes 40+ OKLCh color themes with light/dark variants, type-safe i18n for 10 languages via next-intl, a command palette (Cmd+K), keyboard shortcuts, and a sidebar dashboard layout. State management uses Zustand with localStorage persistence. Styling uses Tailwind CSS v4 with shadcn/ui components built on Radix UI.

CI/CD runs through GitHub Actions with Release Please for Conventional Commits-based versioning and automated changelogs.

## Setup and commands

```bash
# Install: always use pnpm, never npm/yarn
pnpm install

# Development (starts web + native in parallel)
pnpm dev

# Individual targets
pnpm web dev               # Web only (http://localhost:3001). Desktop dev is native on port 3000.
pnpm tauri dev             # Desktop only
pnpm tauri android dev     # Android
pnpm tauri ios dev         # iOS

# Quality gates (CI runs all four on every PR)
pnpm check                 # Biome/Ultracite check
pnpm typecheck             # tsc --noEmit across all workspaces
pnpm build                 # Full production build

# Utilities
pnpm fix                   # Auto-format and fix lint issues
pnpm clean                 # Remove build artifacts
pnpm shadcn add <name>     # Add shadcn/ui component to packages/ui
pnpm deps:check            # Check for outdated deps
pnpm deps:update           # Interactive update
```

All tasks are Turborepo-aware. Run from the repo root; never `cd` into a package to run scripts.

## Monorepo architecture

```
apps/
  web/                Next.js (SSR), web app, landing page, docs (Fumadocs), PWA (Serwist)
  native/             Next.js (static export) + Tauri 2, desktop and mobile

packages/
  core/               Shared business logic: pages, components, hooks, stores, providers, config
  ui/                 Design system: shadcn/ui primitives, 40+ themes, global styles (Tailwind v4)
  i18n/               10-language type-safe translations (next-intl), SSR and static support
  typescript-config/  Shared tsconfig presets (base, nextjs, react-library)
```

### Dependency flow

```
apps/web & apps/native
  └─ @workspace/core
       ├─ @workspace/ui
       └─ @workspace/i18n
```

Both apps import pages, layouts, and state from `packages/core`. Do not put platform-specific UI logic in `packages/core`; use the `@tauri-apps/api` guard pattern already in place.

## Coding standards

### TypeScript

- Strict mode is on globally (`strict: true`, `noUncheckedIndexedAccess: true`).
- Target: `ES2022`. Module: `NodeNext`.
- All new code must be TypeScript. No `.js` files in `packages/` or `apps/` source directories.

### Formatting and Linting (Biome/Ultracite)

- This project uses **Ultracite** as a zero-config preset over Biome.
- Formatting is strictly enforced (double quotes, 2-space indent).
- Linting catches issues but favors warnings or auto-fixing over failing builds locally.
- Tailwind class sorting is handled natively by Biome (`npx @biomejs/biome check`).
- Stylesheet reference: `packages/ui/src/styles/globals.css`.
- Run `pnpm fix` to automatically resolve formatting and lint issues.

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/). Release Please parses these to auto-generate changelogs.

| Prefix      | Purpose                             |
| ----------- | ----------------------------------- |
| `feat:`     | New feature                         |
| `fix:`      | Bug fix                             |
| `docs:`     | Documentation only                  |
| `style:`    | Formatting, no logic                |
| `refactor:` | Refactor, no behavior change        |
| `perf:`     | Performance improvement             |
| `test:`     | Adding/fixing tests                 |
| `deps:`     | Dependency updates                  |
| `ci:`       | CI config changes                   |
| `chore:`    | Maintenance (hidden from changelog) |

## Architecture boundaries

### Do

- Add new UI primitives to `packages/ui/src/components/`. Use shadcn/ui patterns.
- Add shared pages to `packages/core/src/pages/`, hooks to `hooks/`, stores to `stores/`.
- Add new translations to all 10 JSON files in `packages/i18n/src/messages/` (de, en, es, fr, it, ja, pt, ru, tr, zh).
- Use `@workspace/ui`, `@workspace/core`, `@workspace/i18n` workspace imports, never relative paths across package boundaries.
- Export new modules via the `exports` field in the respective `package.json`.

### Do not

- Do not modify `packages/typescript-config/` without explicit approval.
- Do not add app-specific dependencies to shared packages (`core`, `ui`, `i18n`).
- Do not modify `release-please-config.json`, `.release-please-manifest.json`, or GitHub workflow files without explicit approval.
- Do not use `npm` or `yarn`. This repo uses pnpm exclusively (v10+, corepack-managed).
- Do not add `"use server"` directives in `packages/core`. It must stay runtime-agnostic for static export.
- Do not edit auto-generated directories: `.next/`, `.source/`, `.turbo/`, `dist/`, `gen/`, `node_modules/`.

## Config locations

| What                  | Where                                              |
| --------------------- | -------------------------------------------------- |
| Site metadata         | `packages/core/src/config/site.ts`                 |
| Theme definitions     | `packages/core/src/config/themes.ts`               |
| Navigation config     | `packages/core/src/config/navigation.ts`           |
| Global CSS + themes   | `packages/ui/src/styles/globals.css`, `themes.css` |
| Tauri config          | `apps/native/src-tauri/tauri.conf.json`            |
| Web Next.js config    | `apps/web/next.config.ts`                          |
| Native Next.js config | `apps/native/next.config.ts`                       |
| PWA service worker    | `apps/web/app/sw.ts`                               |
| Docs content (MDX)    | `apps/web/content/docs/`                           |

## Gotchas

- `apps/native` sets `output: "export"` in Next.js config. API routes, server components, and `revalidate` will not work there.
- This project uses Tailwind CSS v4 with `@tailwindcss/postcss`. Configuration lives in `globals.css`, not `tailwind.config.ts`.
- `packages/i18n` serves both SSR (web) and static (native). The routing config differs per app. Check `apps/native/src/i18n/request.ts` for the static variant.
- Always add shadcn/ui components via `pnpm shadcn add <name>` from root. They land in `packages/ui/src/components/`.
- `dev` and `clean` tasks have `cache: false` in Turborepo. Everything else is cacheable.
- The repo requires squash merging with PR title as commit message. This keeps a linear history for Release Please.

## Testing

- Vitest runs the stage logic tests in `packages/core` (`pnpm test`). Co-locate test files next to source (`*.test.ts`).
- Engine tests are pytest in `engine/tests`: `cd engine && uv run --with pytest --with flatbuffers pytest tests`. They need no GPU. The tests that compare against Google's mapper run when `MAGENTA_TEST_MAPPER` points at `mapper.tflite` or it is in the weight cache.

## Prerequisites

- Node.js >= 20
- pnpm >= 10 (via corepack: `corepack enable`)
- Rust (latest stable), required only for native/desktop/mobile builds
- Platform-specific tools for native builds: see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)


# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `pnpm dlx ultracite fix`
- **Check for issues**: `pnpm dlx ultracite check`
- **Diagnose setup**: `pnpm dlx ultracite doctor`

Biome (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

### Framework-Specific Guidance

**Next.js:**
- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components

**React 19+:**
- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**
- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Biome. Run `pnpm dlx ultracite fix` before committing to ensure compliance.
