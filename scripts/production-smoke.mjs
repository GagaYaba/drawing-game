#!/usr/bin/env node

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const STARTUP_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 7_500;
const SOCKET_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 30_000;
const FORCE_CLEANUP_TIMEOUT_MS = 3_000;
const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const serverEntryPath = resolve(repositoryRoot, "server/dist/index.js");
const clientIndexPath = resolve(repositoryRoot, "client/dist/index.html");
const serverEntryUrl = pathToFileURL(serverEntryPath).href;
const isWindows = process.platform === "win32";
const activeServers = new Set();

const windowsBootstrap = `
const entryUrl = process.argv[1];

if (entryUrl === undefined) {
  throw new Error("The production server entry URL is missing.");
}

process.on("message", (message) => {
  const signal =
    typeof message === "object" && message !== null
      ? message.signal
      : undefined;

  if (signal === "SIGTERM" || signal === "SIGINT") {
    process.emit(signal);
  }
});

await import(entryUrl);
`;

function appendCapturedOutput(current, chunk) {
  const combined = current + String(chunk);
  return combined.length <= MAX_CAPTURED_OUTPUT_BYTES
    ? combined
    : combined.slice(-MAX_CAPTURED_OUTPUT_BYTES);
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function childDiagnostics(server) {
  const sections = [];
  const stdout = server.stdout.trim();
  const stderr = server.stderr.trim();

  if (stdout.length > 0) {
    sections.push(`stdout:\n${stdout}`);
  }
  if (stderr.length > 0) {
    sections.push(`stderr:\n${stderr}`);
  }

  return sections.length === 0
    ? ""
    : `\n\nChild process output:\n${sections.join("\n")}`;
}

function childFailure(message, server) {
  return new Error(`${message}${childDiagnostics(server)}`);
}

async function assertFileExists(path, label) {
  let fileStats;

  try {
    fileStats = await stat(path);
  } catch (error) {
    throw new Error(
      `${label} is missing at ${path}. Run the production build first.`,
      { cause: error },
    );
  }

  if (!fileStats.isFile()) {
    throw new Error(`${label} is not a file at ${path}.`);
  }
}

async function assertBuildArtifactsExist() {
  await Promise.all([
    assertFileExists(serverEntryPath, "The compiled server entry"),
    assertFileExists(clientIndexPath, "The compiled client index"),
  ]);
}

function spawnProductionServer() {
  const args = isWindows
    ? [
        "--input-type=module",
        "-e",
        windowsBootstrap,
        serverEntryUrl,
      ]
    : [serverEntryPath];
  const child = spawn(process.execPath, args, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: "0",
    },
    stdio: isWindows
      ? ["ignore", "pipe", "pipe", "ipc"]
      : ["ignore", "pipe", "pipe"],
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
    for (const listener of [...server.listeners]) {
      listener();
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    server.stdout = appendCapturedOutput(server.stdout, chunk);
    notify();
  });

  child.stderr.setEncoding("utf8");
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

function waitForListeningPort(server) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let timeout;

    const cleanup = () => {
      clearTimeout(timeout);
      server.listeners.delete(check);
    };
    const resolveOnce = (port) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolvePromise(port);
    };
    const rejectOnce = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      rejectPromise(error);
    };
    const check = () => {
      const match =
        /Drawing game server listening on http:\/\/0\.0\.0\.0:(\d{1,5})\b/u.exec(
          server.stdout,
        );

      if (match !== null) {
        const port = Number(match[1]);
        if (Number.isSafeInteger(port) && port >= 1 && port <= 65_535) {
          resolveOnce(port);
          return;
        }
        rejectOnce(
          childFailure(
            `The production server reported an invalid port: ${match[1]}.`,
            server,
          ),
        );
        return;
      }

      if (server.spawnError !== null) {
        rejectOnce(
          childFailure(
            `Unable to start the production server: ${describeError(
              server.spawnError,
            )}.`,
            server,
          ),
        );
        return;
      }

      if (server.exit !== null) {
        rejectOnce(
          childFailure(
            `The production server exited before reporting its listening port (code ${String(
              server.exit.code,
            )}, signal ${String(server.exit.signal)}).`,
            server,
          ),
        );
      }
    };

    timeout = setTimeout(() => {
      rejectOnce(
        childFailure(
          `The production server did not start within ${STARTUP_TIMEOUT_MS} ms.`,
          server,
        ),
      );
    }, STARTUP_TIMEOUT_MS);
    server.listeners.add(check);
    check();
  });
}

function waitForExit(server, timeoutMilliseconds) {
  if (server.exit !== null) {
    return Promise.resolve(server.exit);
  }

  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let timeout;

    const cleanup = () => {
      clearTimeout(timeout);
      server.listeners.delete(check);
    };
    const resolveOnce = (exit) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolvePromise(exit);
    };
    const rejectOnce = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      rejectPromise(error);
    };
    const check = () => {
      if (server.exit !== null) {
        resolveOnce(server.exit);
        return;
      }
      if (server.spawnError !== null) {
        rejectOnce(
          childFailure(
            `The production server process failed: ${describeError(
              server.spawnError,
            )}.`,
            server,
          ),
        );
      }
    };

    timeout = setTimeout(() => {
      rejectOnce(
        childFailure(
          `The production server did not exit within ${timeoutMilliseconds} ms.`,
          server,
        ),
      );
    }, timeoutMilliseconds);
    server.listeners.add(check);
    check();
  });
}

async function fetchText(url, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: controller.signal,
    });
    const body = await response.text();
    return { response, body };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS} ms.`, {
        cause: error,
      });
    }
    throw new Error(`${label} failed: ${describeError(error)}.`, {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyHealth(baseUrl) {
  const { response, body } = await fetchText(
    `${baseUrl}/api/health`,
    "The health check",
  );

  if (response.status !== 200) {
    throw new Error(
      `The health check returned HTTP ${response.status} instead of 200.`,
    );
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error("The health check did not return valid JSON.", {
      cause: error,
    });
  }

  const keys =
    typeof payload === "object" && payload !== null
      ? Object.keys(payload).sort()
      : [];
  const isExactPayload =
    keys.length === 2 &&
    keys[0] === "service" &&
    keys[1] === "status" &&
    payload.status === "ok" &&
    payload.service === "drawing-game-server";

  if (!isExactPayload) {
    throw new Error(
      `The health check returned an unexpected payload: ${JSON.stringify(
        payload,
      )}.`,
    );
  }
}

async function verifyFrontend(baseUrl) {
  const { response, body } = await fetchText(
    `${baseUrl}/`,
    "The frontend request",
  );

  if (response.status !== 200) {
    throw new Error(
      `The frontend returned HTTP ${response.status} instead of 200.`,
    );
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const hasRootElement = /<div[^>]*\bid=["']root["'][^>]*>/iu.test(body);
  const hasModuleScript =
    /<script[^>]*\btype=["']module["'][^>]*>/iu.test(body);
  const hasBuiltAsset = /\/assets\/[^"'\s>]+\.js\b/iu.test(body);

  if (
    !contentType.includes("text/html") ||
    !hasRootElement ||
    !hasModuleScript ||
    !hasBuiltAsset
  ) {
    throw new Error(
      "The frontend response is not the expected built Vite HTML document.",
    );
  }
}

async function verifySocketPing(baseUrl) {
  const { io: createSocketClient } = await import("socket.io-client");
  const socket = createSocketClient(baseUrl, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    timeout: SOCKET_TIMEOUT_MS,
    transports: ["websocket"],
  });

  try {
    await new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      const timeout = setTimeout(() => {
        settle(
          rejectPromise,
          new Error(
            `The Socket.IO client did not connect within ${SOCKET_TIMEOUT_MS} ms.`,
          ),
        );
      }, SOCKET_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        socket.off("connect", handleConnect);
        socket.off("connect_error", handleConnectError);
      };
      const settle = (settler, value) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        settler(value);
      };
      const handleConnect = () => {
        settle(resolvePromise);
      };
      const handleConnectError = (error) => {
        settle(
          rejectPromise,
          new Error(
            `The Socket.IO websocket connection failed: ${describeError(
              error,
            )}.`,
            { cause: error },
          ),
        );
      };

      socket.once("connect", handleConnect);
      socket.once("connect_error", handleConnectError);
      socket.connect();
    });

    const sentAt = Date.now();
    const pong = await new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      const timeout = setTimeout(() => {
        settle(
          rejectPromise,
          new Error(
            `The server:pong event was not received within ${SOCKET_TIMEOUT_MS} ms.`,
          ),
        );
      }, SOCKET_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        socket.off("server:pong", handlePong);
        socket.off("disconnect", handleDisconnect);
      };
      const settle = (settler, value) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        settler(value);
      };
      const handlePong = (payload) => {
        settle(resolvePromise, payload);
      };
      const handleDisconnect = (reason) => {
        settle(
          rejectPromise,
          new Error(
            `The Socket.IO client disconnected before server:pong (${reason}).`,
          ),
        );
      };

      socket.once("server:pong", handlePong);
      socket.once("disconnect", handleDisconnect);
      socket.emit("client:ping", { sentAt });
    });

    const isValidPong =
      typeof pong === "object" &&
      pong !== null &&
      pong.sentAt === sentAt &&
      typeof pong.receivedAt === "number" &&
      Number.isFinite(pong.receivedAt);

    if (!isValidPong) {
      throw new Error("The server:pong event returned an invalid payload.");
    }
  } finally {
    socket.removeAllListeners();
    socket.disconnect();
  }
}

async function sendShutdownSignal(server, signal) {
  if (server.exit !== null) {
    throw childFailure(
      `The production server exited before ${signal} could be sent.`,
      server,
    );
  }

  if (isWindows) {
    if (!server.child.connected) {
      throw childFailure(
        `The production server IPC channel closed before ${signal}.`,
        server,
      );
    }

    await new Promise((resolvePromise, rejectPromise) => {
      server.child.send({ signal }, (error) => {
        if (error !== null && error !== undefined) {
          rejectPromise(
            childFailure(
              `Unable to emit ${signal} in the production server: ${describeError(
                error,
              )}.`,
              server,
            ),
          );
          return;
        }
        resolvePromise();
      });
    });
    return;
  }

  if (!server.child.kill(signal)) {
    throw childFailure(
      `Unable to send ${signal} to the production server.`,
      server,
    );
  }
}

async function forceStopServer(server) {
  if (server.exit !== null) {
    return;
  }

  try {
    if (isWindows) {
      server.child.kill();
    } else {
      server.child.kill("SIGKILL");
    }
  } catch {
    return;
  }

  try {
    await waitForExit(server, FORCE_CLEANUP_TIMEOUT_MS);
  } catch {
    // Best-effort cleanup must not hide the original smoke-test failure.
  }
}

function releaseServer(server) {
  server.listeners.clear();
  activeServers.delete(server);
}

async function runServerInstance(signal, verifyApplication) {
  const server = spawnProductionServer();

  try {
    const port = await waitForListeningPort(server);
    const baseUrl = `http://127.0.0.1:${port}`;

    await verifyHealth(baseUrl);
    if (verifyApplication) {
      await verifyFrontend(baseUrl);
      await verifySocketPing(baseUrl);
    }

    await sendShutdownSignal(server, signal);
    const exit = await waitForExit(server, SHUTDOWN_TIMEOUT_MS);

    if (exit.code !== 0 || exit.signal !== null) {
      throw childFailure(
        `The production server did not shut down cleanly after ${signal} (code ${String(
          exit.code,
        )}, signal ${String(exit.signal)}).`,
        server,
      );
    }
  } finally {
    await forceStopServer(server);
    releaseServer(server);
  }
}

function killActiveServersOnExit() {
  for (const server of activeServers) {
    if (server.exit !== null) {
      continue;
    }

    try {
      if (isWindows) {
        server.child.kill();
      } else {
        server.child.kill("SIGKILL");
      }
    } catch {
      // The child may already be exiting.
    }
  }
}

async function main() {
  await assertBuildArtifactsExist();
  await runServerInstance("SIGTERM", true);
  await runServerInstance("SIGINT", false);
  console.info(
    "Production smoke passed: health, frontend, Socket.IO, SIGTERM, SIGINT.",
  );
}

process.once("exit", killActiveServersOnExit);

try {
  await main();
} catch (error) {
  console.error(`Production smoke failed: ${describeError(error)}`);
  process.exitCode = 1;
} finally {
  for (const server of [...activeServers]) {
    await forceStopServer(server);
    releaseServer(server);
  }
  process.off("exit", killActiveServersOnExit);
}
