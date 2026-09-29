#!/usr/bin/env node

import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  closeSocket,
  connectSocket,
  describeError,
  normalizeBaseUrl,
  pingSocket,
  verifyFrontend,
  verifyHealth,
} from "./lib/application-probes.mjs";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 30_000;

function showHelp() {
  console.info(`Usage:
  node scripts/post-deploy-check.mjs --url <url> [options]
  node scripts/post-deploy-check.mjs <url> [options]

Options:
  --url <url>             Deployment URL
  --timeout <ms>          Timeout for each probe (default: ${DEFAULT_TIMEOUT_MS})
  --attempts <count>      Health/wake attempts, from 1 to 5 (default: ${DEFAULT_ATTEMPTS})
  --retry-delay <ms>      Initial health retry delay (default: ${DEFAULT_RETRY_DELAY_MS})
  --help                  Show this help

Environment fallback:
  POST_DEPLOY_CHECK_URL

Only the read-only /api/health probe is retried. After the deployment is
awake, the frontend and one Socket.IO client:ping/server:pong exchange are
checked exactly once. No room or game event is emitted.`);
}

function parseBoundedInteger(value, option, minimum, maximum) {
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${option} must be an integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${option} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return parsed;
}

export function parseArguments(
  argumentsReceived,
  environment = process.env,
) {
  const options = {
    baseUrl: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    attempts: DEFAULT_ATTEMPTS,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    help: false,
  };
  let positionalUrl = null;
  let optionUrl = null;
  let parseOptions = true;

  for (let index = 0; index < argumentsReceived.length; index += 1) {
    const argument = argumentsReceived[index];
    const nextValue = () => {
      const value = argumentsReceived[index + 1];
      if (value === undefined || (parseOptions && value.startsWith("--"))) {
        throw new Error(`A value is required after ${argument}.`);
      }
      index += 1;
      return value;
    };

    if (parseOptions && argument === "--") {
      parseOptions = false;
    } else if (parseOptions && argument === "--url") {
      if (optionUrl !== null) {
        throw new Error("--url may only be provided once.");
      }
      optionUrl = nextValue();
    } else if (parseOptions && argument.startsWith("--url=")) {
      if (optionUrl !== null) {
        throw new Error("--url may only be provided once.");
      }
      optionUrl = argument.slice("--url=".length);
    } else if (parseOptions && argument === "--timeout") {
      options.timeoutMs = parseBoundedInteger(
        nextValue(),
        "--timeout",
        1_000,
        120_000,
      );
    } else if (parseOptions && argument.startsWith("--timeout=")) {
      options.timeoutMs = parseBoundedInteger(
        argument.slice("--timeout=".length),
        "--timeout",
        1_000,
        120_000,
      );
    } else if (parseOptions && argument === "--attempts") {
      options.attempts = parseBoundedInteger(
        nextValue(),
        "--attempts",
        1,
        5,
      );
    } else if (parseOptions && argument.startsWith("--attempts=")) {
      options.attempts = parseBoundedInteger(
        argument.slice("--attempts=".length),
        "--attempts",
        1,
        5,
      );
    } else if (parseOptions && argument === "--retry-delay") {
      options.retryDelayMs = parseBoundedInteger(
        nextValue(),
        "--retry-delay",
        0,
        MAX_RETRY_DELAY_MS,
      );
    } else if (parseOptions && argument.startsWith("--retry-delay=")) {
      options.retryDelayMs = parseBoundedInteger(
        argument.slice("--retry-delay=".length),
        "--retry-delay",
        0,
        MAX_RETRY_DELAY_MS,
      );
    } else if (
      parseOptions &&
      (argument === "--help" || argument === "-h")
    ) {
      options.help = true;
    } else if (parseOptions && argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (positionalUrl === null) {
      positionalUrl = argument;
    } else {
      throw new Error(`Unexpected positional argument: ${argument}`);
    }
  }

  if (optionUrl !== null && positionalUrl !== null) {
    throw new Error(
      "Provide the deployment URL either positionally or with --url, not both.",
    );
  }

  if (options.help) {
    return options;
  }

  const environmentUrl = environment.POST_DEPLOY_CHECK_URL;
  const candidateUrl =
    optionUrl ??
    positionalUrl ??
    (typeof environmentUrl === "string" ? environmentUrl : null);
  options.baseUrl = normalizeBaseUrl(candidateUrl);
  return options;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

export async function waitForHealthyDeployment(
  options,
  {
    verifyHealthProbe = verifyHealth,
    sleep = delay,
    logger = console,
  } = {},
) {
  let lastError = null;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      logger.info(
        `[post-deploy] Health attempt ${attempt}/${options.attempts}...`,
      );
      const result = await verifyHealthProbe(options.baseUrl, {
        timeoutMs: options.timeoutMs,
      });
      return { ...result, attemptsUsed: attempt };
    } catch (error) {
      lastError = error;
      if (attempt === options.attempts) {
        break;
      }

      const retryDelayMs = Math.min(
        options.retryDelayMs * 2 ** (attempt - 1),
        MAX_RETRY_DELAY_MS,
      );
      logger.warn(
        `[post-deploy] Health attempt ${attempt}/${options.attempts} failed: ${describeError(
          error,
        )}. Retrying in ${retryDelayMs} ms.`,
      );
      await sleep(retryDelayMs);
    }
  }

  throw new Error(
    `The deployment did not become healthy after ${options.attempts} attempt(s): ${describeError(
      lastError,
    )}`,
    lastError instanceof Error ? { cause: lastError } : undefined,
  );
}

export async function runPostDeployCheck(
  options,
  {
    verifyHealthProbe = verifyHealth,
    verifyFrontendProbe = verifyFrontend,
    connectSocketProbe = connectSocket,
    pingSocketProbe = pingSocket,
    closeSocketProbe = closeSocket,
    sleep = delay,
    logger = console,
  } = {},
) {
  logger.info(`[post-deploy] Checking ${options.baseUrl}`);
  const health = await waitForHealthyDeployment(options, {
    verifyHealthProbe,
    sleep,
    logger,
  });
  logger.info(
    `[post-deploy] Health OK in ${health.durationMs.toFixed(1)} ms ` +
      `(attempt ${health.attemptsUsed}/${options.attempts}).`,
  );

  const frontend = await verifyFrontendProbe(options.baseUrl, {
    timeoutMs: options.timeoutMs,
  });
  logger.info(
    `[post-deploy] Frontend OK in ${frontend.durationMs.toFixed(1)} ms.`,
  );

  const connection = await connectSocketProbe(options.baseUrl, {
    timeoutMs: options.timeoutMs,
  });
  let ping;
  let closed;
  try {
    ping = await pingSocketProbe(connection.socket, {
      timeoutMs: options.timeoutMs,
    });
  } finally {
    closed = closeSocketProbe(connection.socket);
  }
  logger.info(
    `[post-deploy] Socket.IO connected in ${connection.durationMs.toFixed(
      1,
    )} ms; ping/pong OK in ${ping.durationMs.toFixed(1)} ms.`,
  );

  return {
    baseUrl: options.baseUrl,
    health,
    frontend,
    socket: {
      connectionDurationMs: connection.durationMs,
      pingDurationMs: ping.durationMs,
      closeDurationMs: closed.durationMs,
      transport: connection.transport,
      sentAt: ping.sentAt,
      receivedAt: ping.receivedAt,
    },
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    showHelp();
    return;
  }

  const result = await runPostDeployCheck(options);
  console.info(
    `[post-deploy] Passed: health, frontend and Socket.IO ping/pong ` +
      `(${result.socket.transport ?? "unknown transport"}).`,
  );
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
  try {
    await main();
  } catch (error) {
    console.error(`Post-deployment check failed: ${describeError(error)}`);
    process.exitCode = 1;
  }
}
