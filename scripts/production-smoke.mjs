#!/usr/bin/env node

import {
  describeError,
  verifyFrontend,
  verifyHealth,
  verifySocketPing,
} from "./lib/application-probes.mjs";
import {
  assertProductionBuildExists,
  forceStopProductionServer,
  releaseProductionServer,
  spawnProductionServer,
  stopProductionServer,
  waitForListeningPort,
} from "./lib/production-server.mjs";

const STARTUP_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 7_500;
const SOCKET_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 30_000;

async function runServerInstance(signal, verifyApplication) {
  const server = spawnProductionServer();
  let stopped = false;

  try {
    const port = await waitForListeningPort(server, STARTUP_TIMEOUT_MS);
    const baseUrl = `http://127.0.0.1:${port}`;

    await verifyHealth(baseUrl, { timeoutMs: REQUEST_TIMEOUT_MS });
    if (verifyApplication) {
      await verifyFrontend(baseUrl, { timeoutMs: REQUEST_TIMEOUT_MS });
      await verifySocketPing(baseUrl, { timeoutMs: SOCKET_TIMEOUT_MS });
    }

    await stopProductionServer(server, signal, SHUTDOWN_TIMEOUT_MS);
    stopped = true;
  } finally {
    if (!stopped) {
      await forceStopProductionServer(server);
      releaseProductionServer(server);
    }
  }
}

async function main() {
  await assertProductionBuildExists();
  await runServerInstance("SIGTERM", true);
  await runServerInstance("SIGINT", false);
  console.info(
    "Production smoke passed: health, frontend, Socket.IO, SIGTERM, SIGINT.",
  );
}

try {
  await main();
} catch (error) {
  console.error(`Production smoke failed: ${describeError(error)}`);
  process.exitCode = 1;
}
