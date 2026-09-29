#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";

import {
  forceStopProductionServer,
  releaseProductionServer,
  repositoryRoot,
  spawnProductionServer,
  stopProductionServer,
  waitForListeningPort,
} from "./lib/production-server.mjs";
import {
  PRODUCTION_BROWSER_VIEWPORTS,
  runProductionBrowserCheck,
} from "./production-browser-check.mjs";

const reportDirectory = resolve(repositoryRoot, "reports/c2-2-1");
const screenshotDirectory = resolve(reportDirectory, "screenshots");
const reportPath = resolve(reportDirectory, "prototype-report.json");
const SERVER_STARTUP_TIMEOUT_MS = 15_000;
const SERVER_SHUTDOWN_TIMEOUT_MS = 30_000;
const BROWSER_STEP_TIMEOUT_MS = 20_000;

function roundMilliseconds(value) {
  return Math.round(value * 1_000) / 1_000;
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeError(error) {
  const message = describeError(error)
    .replaceAll(repositoryRoot, "<repository>")
    .replaceAll(reportDirectory, "<report-directory>")
    .replace(/\b[A-Za-z]:[\\/][^\r\n\t"'<>|]*/gu, "<local-path>")
    .replace(/(^|[\s(='"])(\/(?!\/)[^\r\n\t"'<> ]*)/gu, "$1<local-path>")
    .replace(/\b[A-Za-z0-9_-]{43}\b/gu, "<redacted-secret>");
  return message.slice(0, 4_000);
}

function npmInvocation(argumentsReceived) {
  const npmExecPath = process.env.npm_execpath;
  if (typeof npmExecPath === "string" && npmExecPath.length > 0) {
    return {
      command: process.execPath,
      arguments: [npmExecPath, ...argumentsReceived],
    };
  }
  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    arguments: argumentsReceived,
  };
}

function runCommand(command, argumentsReceived, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, argumentsReceived, {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    if (options.capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) {
        resolvePromise({ stdout, stderr });
        return;
      }
      rejectPromise(
        new Error(
          `${command} exited with code ${String(code)} and signal ${String(
            signal,
          )}.${stderr.trim().length > 0 ? ` ${stderr.trim()}` : ""}`,
        ),
      );
    });
  });
}

async function buildProductionApplication() {
  const invocation = npmInvocation(["run", "build"]);
  console.info("[prototype] Building the production application...");
  await runCommand(invocation.command, invocation.arguments);
}

async function readCommit() {
  try {
    const result = await runCommand("git", ["rev-parse", "HEAD"], {
      capture: true,
    });
    const commit = result.stdout.trim();
    return /^[0-9a-f]{40}$/u.test(commit) ? commit : null;
  } catch {
    return null;
  }
}

async function listScreenshotFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name, "en")
  )) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listScreenshotFiles(absolutePath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
      files.push(
        relative(reportDirectory, absolutePath).replaceAll("\\", "/"),
      );
    }
  }
  return files;
}

function assertSafeReport(report) {
  const serialized = JSON.stringify(report);
  const forbiddenKeys = [
    "token",
    "tokenHash",
    "sessionTokenHash",
    "socketId",
    "credentials",
  ];
  for (const key of forbiddenKeys) {
    if (serialized.includes(`\"${key}\"`)) {
      throw new Error(`The prototype report contains the forbidden key ${key}.`);
    }
  }
  if (
    serialized.includes(repositoryRoot) ||
    serialized.includes(reportDirectory) ||
    /\b[A-Za-z]:[\\/]/u.test(serialized) ||
    /(^|[\s(='"])(\/(?!\/))/u.test(serialized)
  ) {
    throw new Error("The prototype report contains an absolute local path.");
  }
  if (/\b[A-Za-z0-9_-]{43}\b/u.test(serialized)) {
    throw new Error("The prototype report contains a token-shaped value.");
  }
}

async function main() {
  const startedAt = new Date();
  const timer = performance.now();
  let server = null;
  let serverStopped = false;
  let browserResult = null;
  let failure = null;

  await rm(reportDirectory, { recursive: true, force: true });
  await mkdir(screenshotDirectory, { recursive: true });
  const commit = await readCommit();

  try {
    await buildProductionApplication();
    server = spawnProductionServer();
    const port = await waitForListeningPort(
      server,
      SERVER_STARTUP_TIMEOUT_MS,
    );
    const baseUrl = `http://127.0.0.1:${port}`;
    console.info(`[prototype] Running the browser scenario against ${baseUrl}...`);
    browserResult = await runProductionBrowserCheck({
      baseUrl,
      chromePath: process.env.CHROME_PATH ?? null,
      timeoutMs: BROWSER_STEP_TIMEOUT_MS,
      headless: true,
      noSandbox: false,
      screenshotDirectory,
    });
  } catch (error) {
    failure = sanitizeError(error);
  } finally {
    if (server !== null) {
      try {
        await stopProductionServer(
          server,
          "SIGTERM",
          SERVER_SHUTDOWN_TIMEOUT_MS,
        );
        serverStopped = true;
      } catch (error) {
        failure ??= sanitizeError(error);
      } finally {
        if (!serverStopped) {
          await forceStopProductionServer(server);
          releaseProductionServer(server);
        }
      }
    }
  }

  const screenshots = await listScreenshotFiles(screenshotDirectory);
  const passed = failure === null && browserResult !== null;
  const report = {
    schemaVersion: 1,
    status: passed ? "passed" : "failed",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: roundMilliseconds(performance.now() - timer),
    environment: {
      node: process.version,
      os: {
        platform: platform(),
        release: release(),
        architecture: arch(),
      },
      commit,
    },
    equipment: {
      applicationType: "responsive web application",
      targetedInputMethods: ["mouse", "keyboard", "touch", "stylus"],
      automatedInputMethods: ["mouse", "keyboard"],
      targetViewports: PRODUCTION_BROWSER_VIEWPORTS.map(
        (viewport) => ({ ...viewport }),
      ),
      verifiedViewports:
        passed && browserResult !== null
          ? browserResult.verifiedViewports.map(
              (viewport) => ({ ...viewport }),
            )
          : [],
    },
    scenario: {
      functional: passed,
      browserClientCount: browserResult?.browserClientCount ?? 0,
      phasesVisited: browserResult?.phasesVisited ?? [],
      totalTurnsCompleted: browserResult?.uiChecks.totalTurnsCompleted ?? 0,
      health: browserResult?.health ?? "not-verified",
      realtimeTransport:
        browserResult?.socketIoVerifiedBy ?? "not-verified",
      responsiveSurfacesVerified:
        passed && browserResult !== null
          ? browserResult.responsiveSurfacesVerified
          : [],
      checks: browserResult === null
        ? null
        : {
            sameTabReloadRestored:
              browserResult.sameTabReloadRestored,
            realSecondTabRefused:
              browserResult.realSecondTabRefused,
            manualRetryRestored:
              browserResult.manualRetryRestored,
            hostPreserved: browserResult.hostPreserved,
            gamePreserved: browserResult.gamePreserved,
          },
    },
    screenshots,
    error: failure,
  };

  assertSafeReport(report);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.info(
    `[prototype] ${report.status.toUpperCase()} in ${report.durationMs} ms; ` +
      `${screenshots.length} screenshot(s); report: reports/c2-2-1/prototype-report.json`,
  );
  if (!passed) {
    console.error(`[prototype] ${failure ?? "The browser scenario did not return a result."}`);
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(`Prototype check failed: ${sanitizeError(error)}`);
  process.exitCode = 1;
}
