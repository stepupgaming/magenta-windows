#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// tauri.conf.json opens the window on this port. `pnpm web dev` keeps 3001.
const DEFAULT_PORT = 3000;
const WEB_PORT = 3001;
const LAST_PORT = 3099;
const PROBE_MS = 500;

/** Whether a server can listen on the port the way `next dev` does. */
const canListen = (port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });

/** Whether something already answers on host:port, which the window would reach first. */
const answers = (host, port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(PROBE_MS, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });

const isFree = async (port) => {
  if (!(await canListen(port))) {
    return false;
  }
  const taken = await Promise.all([
    answers("127.0.0.1", port),
    answers("::1", port),
  ]);
  return !taken.some(Boolean);
};

const freePort = async (port = DEFAULT_PORT) => {
  if (port > LAST_PORT) {
    return null;
  }
  if (port !== WEB_PORT && (await isFree(port))) {
    return port;
  }
  return freePort(port + 1);
};

/** A Tauri config to merge over tauri.conf.json that serves and opens `port`. */
const portConfig = (port) => {
  const file = path.join(os.tmpdir(), `magenta-tauri-dev-${port}.json`);
  const config = {
    build: {
      beforeDevCommand: `pnpm exec next dev --turbopack --port ${port}`,
      devUrl: `http://localhost:${port}`,
    },
  };
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
};

const port = await freePort();
if (port === null) {
  process.stderr.write(
    `No free port from ${DEFAULT_PORT} to ${LAST_PORT} for the desktop dev window. Stop another dev server and run it again.\n`
  );
  process.exit(1);
}

const args = ["--filter", "native", "tauri", "dev"];
if (port !== DEFAULT_PORT) {
  process.stdout.write(
    `Port ${DEFAULT_PORT} is in use, so the desktop dev window uses http://localhost:${port}.\n`
  );
  // The shell joins arguments with spaces, so quote the path for a temp folder that has them.
  args.push("--config", `"${portConfig(port)}"`);
}

const result = spawnSync("pnpm", args, {
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
