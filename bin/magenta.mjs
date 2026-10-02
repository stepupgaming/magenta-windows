#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = path.join(root, "engine");
const python = path.join(engine, ".venv", "Scripts", "python.exe");
const args = process.argv.slice(2);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    cwd: root,
    env: process.env,
    shell: false,
    ...options,
  });
  if (result.error) {
    fail(result.error.message);
  }
  return result.status ?? 1;
}

if (!existsSync(python)) {
  const synced = spawnSync("uv", ["sync"], {
    cwd: engine,
    stdio: "inherit",
    shell: true,
  });
  if (!existsSync(python)) {
    fail(
      synced.error
        ? `uv sync failed: ${synced.error.message}`
        : "uv sync did not create engine/.venv. Install uv, then run this again.",
    );
  }
}

const needsWeights = args.includes("generate") || args.includes("load");
if (needsWeights) {
  const status = run(python, [path.join(root, "scripts", "release_weights.py"), "ensure"], {
    env: { ...process.env, PYTHONPATH: engine },
  });
  if (status !== 0) {
    process.exit(status);
  }
}

process.exit(
  run(python, ["-m", "magenta_win.cli", ...args], {
    cwd: engine,
    env: { ...process.env, PYTHONPATH: engine },
  }),
);
