#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync("pnpm", ["--filter", "native", "tauri", "dev"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});

if (result.error) {
  process.stderr.write(
    "pnpm is required for the desktop dev window. Install pnpm 10, then run bun run dev again.\n"
  );
  process.exit(1);
}

process.exit(result.status ?? 1);
