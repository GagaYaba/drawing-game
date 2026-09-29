#!/usr/bin/env node

import { performance } from "node:perf_hooks";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  closeSocket,
  connectSocket,
  describeError,
  pingSocket,
  verifyHealth,
} from "./lib/application-probes.mjs";
import {
  evaluateFrontendBudget,
  evaluatePerformanceThresholds,
  measureFrontendBuild,
} from "./lib/quality-metrics.mjs";
import { QUALITY_THRESHOLDS } from "./lib/quality-thresholds.mjs";
import {
  assertProductionBuildExists,
  forceStopProductionServer,
  releaseProductionServer,
  spawnProductionServer,
  stopProductionServer,
  waitForListeningPort,
} from "./lib/production-server.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const clientDistPath = resolve(repositoryRoot, "client/dist");

function roundMilliseconds(value) {
  return Math.round(value * 1_000) / 1_000;
}

function serializeError(error) {
  return {
    message: describeError(error),
    name: error instanceof Error ? error.name : "Error",
  };
}

async function collectHealthMeasurements(baseUrl) {
  const threshold = QUALITY_THRESHOLDS.health;
  const warmupErrors = [];
  for (let index = 0; index < threshold.warmupRequests; index += 1) {
    try {
      await verifyHealth(baseUrl, { timeoutMs: threshold.requestTimeoutMs });
    } catch (error) {
      warmupErrors.push(serializeError(error));
    }
  }

  const latenciesMs = [];
  const errors = [];
  for (let index = 0; index < threshold.measuredRequests; index += 1) {
    try {
      const result = await verifyHealth(baseUrl, {
        timeoutMs: threshold.requestTimeoutMs,
      });
      latenciesMs.push(roundMilliseconds(result.durationMs));
    } catch (error) {
      errors.push({ index: index + 1, ...serializeError(error) });
    }
  }

  return {
    warmupRequestCount: threshold.warmupRequests,
    warmupErrors,
    requestCount: threshold.measuredRequests,
    successCount: latenciesMs.length,
    latenciesMs,
    errors,
  };
}

async function collectSocketMeasurements(baseUrl) {
  const threshold = QUALITY_THRESHOLDS.socket;
  const baseMeasurements = {
    warmupRoundTripCount: threshold.warmupRoundTrips,
    warmupErrors: [],
    roundTripCount: threshold.measuredRoundTrips,
    successCount: 0,
    latenciesMs: [],
    errors: [],
    connectionDurationMs: null,
    transport: null,
  };
  let socket;

  try {
    const connection = await connectSocket(baseUrl, {
      timeoutMs: threshold.connectTimeoutMs,
    });
    socket = connection.socket;
    baseMeasurements.connectionDurationMs = roundMilliseconds(
      connection.durationMs,
    );
    baseMeasurements.transport = connection.transport;
  } catch (error) {
    baseMeasurements.errors.push({ stage: "connect", ...serializeError(error) });
    return baseMeasurements;
  }

  try {
    for (let index = 0; index < threshold.warmupRoundTrips; index += 1) {
      try {
        await pingSocket(socket, { timeoutMs: threshold.pingTimeoutMs });
      } catch (error) {
        baseMeasurements.warmupErrors.push(serializeError(error));
      }
    }

    for (let index = 0; index < threshold.measuredRoundTrips; index += 1) {
      try {
        const ping = await pingSocket(socket, {
          timeoutMs: threshold.pingTimeoutMs,
        });
        baseMeasurements.latenciesMs.push(
          roundMilliseconds(ping.durationMs),
        );
      } catch (error) {
        baseMeasurements.errors.push({
          stage: "ping",
          index: index + 1,
          ...serializeError(error),
        });
      }
    }
  } finally {
    closeSocket(socket);
  }

  baseMeasurements.successCount = baseMeasurements.latenciesMs.length;
  return baseMeasurements;
}

export async function runQualityPerformanceCheck() {
  await assertProductionBuildExists();
  const frontend = await measureFrontendBuild(clientDistPath);
  const frontendBudget = evaluateFrontendBudget(
    frontend,
    QUALITY_THRESHOLDS.frontend,
  );
  const startupStartedAt = performance.now();
  const server = spawnProductionServer();
  let serverReleased = false;
  let measurements;
  let shutdownError = null;

  try {
    const port = await waitForListeningPort(
      server,
      QUALITY_THRESHOLDS.serverStartupMs,
    );
    const serverStartupMs = roundMilliseconds(
      performance.now() - startupStartedAt,
    );
    const baseUrl = `http://127.0.0.1:${port}`;
    const health = await collectHealthMeasurements(baseUrl);
    const socket = await collectSocketMeasurements(baseUrl);
    measurements = { serverStartupMs, health, socket, frontend };
  } finally {
    try {
      await stopProductionServer(server, "SIGTERM", 30_000);
      serverReleased = true;
    } catch (error) {
      shutdownError = serializeError(error);
    } finally {
      if (!serverReleased) {
        await forceStopProductionServer(server);
        releaseProductionServer(server);
      }
    }
  }

  if (measurements === undefined) {
    throw new Error("Performance measurements could not be collected.");
  }
  const performanceEvaluation = evaluatePerformanceThresholds(
    measurements,
    QUALITY_THRESHOLDS,
  );
  const checks = [...performanceEvaluation.checks, frontendBudget];
  if (shutdownError !== null) {
    checks.push({
      name: "server-clean-shutdown",
      passed: false,
      actual: shutdownError,
      message: shutdownError.message,
    });
  }

  return {
    passed: checks.every(({ passed }) => passed),
    thresholds: QUALITY_THRESHOLDS,
    measurements: {
      ...measurements,
      health: {
        ...measurements.health,
        p95Ms: performanceEvaluation.healthP95Ms,
      },
      socket: {
        ...measurements.socket,
        p95Ms: performanceEvaluation.socketP95Ms,
      },
      frontend: {
        ...measurements.frontend,
        referenceTotalBytes: QUALITY_THRESHOLDS.frontend.referenceTotalBytes,
        maximumTotalBytes: QUALITY_THRESHOLDS.frontend.maximumTotalBytes,
        configuredMarginPercent: frontendBudget.configuredMarginPercent,
      },
    },
    checks,
  };
}

function printResult(result) {
  console.info("\nQuality and performance measurements");
  console.info(`  Server startup: ${result.measurements.serverStartupMs} ms / ${result.thresholds.serverStartupMs} ms`);
  console.info(`  HTTP health: ${result.measurements.health.successCount}/${result.measurements.health.requestCount}, p95 ${String(result.measurements.health.p95Ms)} ms / ${result.thresholds.health.p95Ms} ms`);
  console.info(`  Socket.IO ping/pong: ${result.measurements.socket.successCount}/${result.measurements.socket.roundTripCount}, p95 ${String(result.measurements.socket.p95Ms)} ms / ${result.thresholds.socket.p95Ms} ms`);
  console.info(`  Frontend build: ${result.measurements.frontend.totalBytes} bytes / ${result.thresholds.frontend.maximumTotalBytes} bytes`);
  for (const check of result.checks) {
    console.info(`  [${check.passed ? "PASS" : "FAIL"}] ${check.name}: ${check.message}`);
  }
}

async function main() {
  const result = await runQualityPerformanceCheck();
  printResult(result);
  if (!result.passed) process.exitCode = 1;
}

const isMain = process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(`Quality performance check failed: ${describeError(error)}`);
    process.exitCode = 1;
  }
}
