import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024;
const FORCE_CLEANUP_TIMEOUT_MS = 3_000;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptDirectory, "../..");
export const serverEntryPath = resolve(repositoryRoot, "server/dist/index.js");
export const clientIndexPath = resolve(repositoryRoot, "client/dist/index.html");
const serverEntryUrl = pathToFileURL(serverEntryPath).href;
const isWindows = process.platform === "win32";
const activeServers = new Set();

const windowsBootstrap = `
const entryUrl = process.argv[1];
if (entryUrl === undefined) throw new Error("The production server entry URL is missing.");
process.on("message", (message) => {
  const signal = typeof message === "object" && message !== null ? message.signal : undefined;
  if (signal === "SIGTERM" || signal === "SIGINT") process.emit(signal);
});
await import(entryUrl);
`;

function appendCapturedOutput(current, chunk) {
  const combined = current + String(chunk);
  return combined.length <= MAX_CAPTURED_OUTPUT_BYTES
    ? combined
    : combined.slice(-MAX_CAPTURED_OUTPUT_BYTES);
}

export function formatServerDiagnostics(server) {
  const sections = [];
  if (server.stdout.trim().length > 0) sections.push(`stdout:\n${server.stdout.trim()}`);
  if (server.stderr.trim().length > 0) sections.push(`stderr:\n${server.stderr.trim()}`);
  return sections.length === 0 ? "" : `\n\nChild process output:\n${sections.join("\n")}`;
}

function serverError(message, server) {
  return new Error(`${message}${formatServerDiagnostics(server)}`);
}

async function assertFile(path, label) {
  const fileStats = await stat(path).catch(() => null);
  if (fileStats === null || !fileStats.isFile()) {
    throw new Error(`${label} is missing at ${path}. Run the production build first.`);
  }
}

export async function assertProductionBuildExists() {
  await Promise.all([
    assertFile(serverEntryPath, "The compiled server entry"),
    assertFile(clientIndexPath, "The compiled client index"),
  ]);
}

export function spawnProductionServer(environment = {}) {
  const args = isWindows
    ? ["--input-type=module", "-e", windowsBootstrap, serverEntryUrl]
    : [serverEntryPath];
  const child = spawn(process.execPath, args, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: "0",
      ...environment,
    },
    stdio: isWindows ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const server = {
    child,
    stdout: "",
    stderr: "",
    spawnError: null,
    exit: null,
    listeners: new Set(),
  };
  const notify = () => {
    for (const listener of [...server.listeners]) listener();
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    server.stdout = appendCapturedOutput(server.stdout, chunk);
    notify();
  });
  child.stderr.on("data", (chunk) => {
    server.stderr = appendCapturedOutput(server.stderr, chunk);
    notify();
  });
  child.once("error", (error) => {
    server.spawnError = error;
    notify();
  });
  child.once("exit", (code, signal) => {
    server.exit = { code, signal };
    notify();
  });
  activeServers.add(server);
  return server;
}

function waitForState(server, timeoutMs, description, predicate) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      server.listeners.delete(check);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const check = () => {
      try {
        const value = predicate();
        if (value !== undefined) settle(resolvePromise, value);
      } catch (error) {
        settle(rejectPromise, error);
      }
    };
    timeout = setTimeout(() => {
      settle(rejectPromise, serverError(`${description} within ${timeoutMs} ms.`, server));
    }, timeoutMs);
    server.listeners.add(check);
    check();
  });
}

export function waitForListeningPort(server, timeoutMs = 15_000) {
  return waitForState(
    server,
    timeoutMs,
    "The production server did not report a listening port",
    () => {
      const match = /Drawing game server listening on http:\/\/0\.0\.0\.0:(\d{1,5})\b/u.exec(
        server.stdout,
      );
      if (match !== null) {
        const port = Number(match[1]);
        if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
          throw serverError(`The production server reported an invalid port: ${match[1]}.`, server);
        }
        return port;
      }
      if (server.spawnError !== null) {
        throw serverError(`Unable to start the production server: ${server.spawnError.message}.`, server);
      }
      if (server.exit !== null) {
        throw serverError(
          `The production server exited before reporting its port (code ${String(server.exit.code)}, signal ${String(server.exit.signal)}).`,
          server,
        );
      }
      return undefined;
    },
  );
}

export function waitForServerExit(server, timeoutMs = 30_000) {
  if (server.exit !== null) return Promise.resolve(server.exit);
  return waitForState(
    server,
    timeoutMs,
    "The production server did not exit",
    () => {
      if (server.exit !== null) return server.exit;
      if (server.spawnError !== null) {
        throw serverError(`The production server process failed: ${server.spawnError.message}.`, server);
      }
      return undefined;
    },
  );
}

export async function sendServerSignal(server, signal) {
  if (server.exit !== null) {
    throw serverError(`The production server exited before ${signal} could be sent.`, server);
  }
  if (isWindows) {
    if (!server.child.connected) {
      throw serverError(`The production server IPC channel closed before ${signal}.`, server);
    }
    await new Promise((resolvePromise, rejectPromise) => {
      server.child.send({ signal }, (error) => {
        if (error) rejectPromise(serverError(`Unable to emit ${signal}: ${error.message}.`, server));
        else resolvePromise();
      });
    });
  } else if (!server.child.kill(signal)) {
    throw serverError(`Unable to send ${signal} to the production server.`, server);
  }
}

export async function forceStopProductionServer(server) {
  if (server.exit !== null) return;
  try {
    server.child.kill(isWindows ? undefined : "SIGKILL");
    await waitForServerExit(server, FORCE_CLEANUP_TIMEOUT_MS);
  } catch {
    // Cleanup is best effort; callers retain the original failure.
  }
}

export function releaseProductionServer(server) {
  server.listeners.clear();
  activeServers.delete(server);
}

export async function stopProductionServer(server, signal = "SIGTERM", timeoutMs = 30_000) {
  try {
    await sendServerSignal(server, signal);
    const exit = await waitForServerExit(server, timeoutMs);
    if (exit.code !== 0 || exit.signal !== null) {
      throw serverError(
        `The production server did not shut down cleanly (code ${String(exit.code)}, signal ${String(exit.signal)}).`,
        server,
      );
    }
  } finally {
    await forceStopProductionServer(server);
    releaseProductionServer(server);
  }
}

process.once("exit", () => {
  for (const server of activeServers) {
    if (server.exit === null) {
      try {
        server.child.kill(isWindows ? undefined : "SIGKILL");
      } catch {
        // The child may already be exiting.
      }
    }
  }
});
