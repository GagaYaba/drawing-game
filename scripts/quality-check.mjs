#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { describeError } from "./lib/application-probes.mjs";
import { QUALITY_THRESHOLDS } from "./lib/quality-thresholds.mjs";
import { runQualityPerformanceCheck } from "./quality-performance-check.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const reportDirectory = resolve(repositoryRoot, "reports/c2-1-1");
const reportPath = resolve(reportDirectory, "quality-performance-report.json");
const MAX_RECORDED_OUTPUT_CHARACTERS = 24_000;
let currentNodeVersionCheck = null;

function roundMilliseconds(value) {
  return Math.round(value * 1_000) / 1_000;
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "");
}

function appendRecordedOutput(current, chunk) {
  const combined = current + stripAnsi(String(chunk));
  return combined.length <= MAX_RECORDED_OUTPUT_CHARACTERS
    ? combined
    : combined.slice(-MAX_RECORDED_OUTPUT_CHARACTERS);
}

async function checkNodeVersion() {
  const startedAt = new Date();
  const timer = performance.now();
  const nodeVersionPath = resolve(repositoryRoot, ".node-version");
  const packagePath = resolve(repositoryRoot, "package.json");
  const [nodeVersionFile, packageFile] = await Promise.all([
    readFile(nodeVersionPath, "utf8"),
    readFile(packagePath, "utf8"),
  ]);
  const expectedVersion = nodeVersionFile.trim().replace(/^v/u, "");
  if (!/^\d+\.\d+\.\d+$/u.test(expectedVersion)) {
    throw new Error(
      `.node-version must contain an exact semantic version; received ${JSON.stringify(
        nodeVersionFile.trim(),
      )}.`,
    );
  }

  let packageManifest;
  try {
    packageManifest = JSON.parse(packageFile);
  } catch (error) {
    throw new Error("package.json does not contain valid JSON.", { cause: error });
  }
  const expectedRange = packageManifest?.engines?.node;
  if (typeof expectedRange !== "string" || expectedRange.trim().length === 0) {
    throw new Error("package.json must define a non-empty engines.node range.");
  }

  const detectedVersion = process.versions.node;
  const passed = detectedVersion === expectedVersion;
  const output = [
    `Node.js detected: v${detectedVersion}`,
    `Node.js expected: v${expectedVersion} (.node-version)`,
    `Node.js project range: ${expectedRange} (package.json engines.node)`,
  ];
  for (const line of output) console.info(`[quality] ${line}`);

  return {
    name: "Node.js version",
    command: "node --version",
    startedAt: startedAt.toISOString(),
    durationMs: roundMilliseconds(performance.now() - timer),
    status: passed ? "passed" : "failed",
    exitCode: passed ? 0 : 1,
    signal: null,
    error: passed
      ? null
      : `Unsupported Node.js version v${detectedVersion}; expected v${expectedVersion}.`,
    outputTail: output.join("\n"),
    detectedVersion: `v${detectedVersion}`,
    expectedVersion: `v${expectedVersion}`,
    expectedRange,
    source: ".node-version",
  };
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

function runCommand(name, command, argumentsReceived) {
  const startedAt = new Date();
  const timer = performance.now();
  console.info(`\n[quality] ${name}`);

  return new Promise((resolvePromise) => {
    let output = "";
    let settled = false;
    const child = spawn(command, argumentsReceived, {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      output = appendRecordedOutput(output, chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      output = appendRecordedOutput(output, chunk);
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolvePromise({
        name,
        command: [command, ...argumentsReceived].join(" "),
        startedAt: startedAt.toISOString(),
        durationMs: roundMilliseconds(performance.now() - timer),
        outputTail: output.trim(),
        ...result,
      });
    };

    child.once("error", (error) => {
      finish({ status: "failed", exitCode: null, signal: null, error: describeError(error) });
    });
    child.once("exit", (code, signal) => {
      finish({
        status: code === 0 && signal === null ? "passed" : "failed",
        exitCode: code,
        signal,
        error: code === 0 && signal === null
          ? null
          : `Command exited with code ${String(code)} and signal ${String(signal)}.`,
      });
    });
  });
}

async function runNpmScript(name, script) {
  const invocation = npmInvocation(["run", script]);
  return runCommand(name, invocation.command, invocation.arguments);
}

function skippedStep(name, reason) {
  return {
    name,
    command: null,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    status: "skipped",
    exitCode: null,
    signal: null,
    error: reason,
    outputTail: "",
  };
}

async function readCommit() {
  const step = await runCommand("Commit metadata", "git", ["rev-parse", "HEAD"]);
  return step.status === "passed"
    ? step.outputTail.trim().split(/\r?\n/u).at(-1) ?? null
    : null;
}

function extractTestSummary(output) {
  const testFiles = /Test Files\s+(\d+) passed/iu.exec(output)?.[1] ?? null;
  const tests = /Tests\s+(\d+) passed/iu.exec(output)?.[1] ?? null;
  return {
    passedTestFiles: testFiles === null ? null : Number(testFiles),
    passedTests: tests === null ? null : Number(tests),
  };
}

async function runPerformanceStep() {
  const startedAt = new Date();
  const timer = performance.now();
  console.info("\n[quality] Performance and static budget");

  try {
    const result = await runQualityPerformanceCheck();
    for (const check of result.checks) {
      console.info(`  [${check.passed ? "PASS" : "FAIL"}] ${check.name}: ${check.message}`);
    }
    return {
      step: {
        name: "Performance and static budget",
        command: "node scripts/quality-performance-check.mjs",
        startedAt: startedAt.toISOString(),
        durationMs: roundMilliseconds(performance.now() - timer),
        status: result.passed ? "passed" : "failed",
        exitCode: result.passed ? 0 : 1,
        signal: null,
        error: result.passed
          ? null
          : "At least one performance or static budget threshold failed.",
        outputTail: "",
      },
      result,
    };
  } catch (error) {
    return {
      step: {
        name: "Performance and static budget",
        command: "node scripts/quality-performance-check.mjs",
        startedAt: startedAt.toISOString(),
        durationMs: roundMilliseconds(performance.now() - timer),
        status: "failed",
        exitCode: 1,
        signal: null,
        error: describeError(error),
        outputTail: "",
      },
      result: null,
    };
  }
}

function printSummary(report) {
  console.info("\nC.2.1.1 quality gate summary");
  for (const step of report.steps) {
    console.info(`  [${step.status.toUpperCase()}] ${step.name} (${step.durationMs} ms)`);
  }
  if (report.measurements !== null) {
    const { measurements } = report;
    console.info(
      `  Startup ${measurements.serverStartupMs} ms; ` +
        `HTTP p95 ${String(measurements.health.p95Ms)} ms; ` +
        `Socket.IO p95 ${String(measurements.socket.p95Ms)} ms; ` +
        `frontend ${measurements.frontend.totalBytes} bytes.`,
    );
  }
  console.info(`  Overall: ${report.overallStatus.toUpperCase()}`);
  console.info(`  JSON report: ${report.reportPath}`);
}

async function main() {
  const startedAt = new Date();
  const overallTimer = performance.now();
  currentNodeVersionCheck = await checkNodeVersion();
  if (currentNodeVersionCheck.status !== "passed") {
    throw new Error(
      `${currentNodeVersionCheck.error} Switch to the version declared in .node-version before running the quality gate.`,
    );
  }

  await mkdir(reportDirectory, { recursive: true });
  const commit = await readCommit();
  const steps = [currentNodeVersionCheck];

  steps.push(await runNpmScript("TypeScript typecheck", "typecheck"));
  const tests = await runNpmScript("Automated tests", "test");
  steps.push({ ...tests, testSummary: extractTestSummary(tests.outputTail) });
  const build = await runNpmScript("Production build", "build");
  steps.push(build);

  let performanceResult = null;
  if (build.status === "passed") {
    steps.push(await runNpmScript("Production smoke", "smoke:production"));
    const performance = await runPerformanceStep();
    steps.push(performance.step);
    performanceResult = performance.result;
  } else {
    const reason = "Skipped because the production build failed.";
    steps.push(skippedStep("Production smoke", reason));
    steps.push(skippedStep("Performance and static budget", reason));
  }

  const failures = steps
    .filter(({ status }) => status !== "passed")
    .map(({ name, status, error }) => ({ name, status, error }));
  const report = {
    schemaVersion: 1,
    reportPath: "reports/c2-1-1/quality-performance-report.json",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: roundMilliseconds(performance.now() - overallTimer),
    runtime: {
      node: process.version,
      nodeExpected: currentNodeVersionCheck.expectedVersion,
      nodeEngineRange: currentNodeVersionCheck.expectedRange,
      nodeCompatible: true,
      os: { platform: platform(), release: release(), architecture: arch() },
      commit,
    },
    thresholds: QUALITY_THRESHOLDS,
    steps,
    measurements: performanceResult?.measurements ?? null,
    performanceChecks: performanceResult?.checks ?? [],
    failures,
    overallStatus: failures.length === 0 ? "passed" : "failed",
  };

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  printSummary(report);
  if (report.overallStatus !== "passed") process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  const fallbackReport = {
    schemaVersion: 1,
    reportPath: "reports/c2-1-1/quality-performance-report.json",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    runtime: {
      node: process.version,
      nodeExpected: currentNodeVersionCheck?.expectedVersion ?? null,
      nodeEngineRange: currentNodeVersionCheck?.expectedRange ?? null,
      nodeCompatible: currentNodeVersionCheck?.status === "passed",
      os: { platform: platform(), release: release(), architecture: arch() },
      commit: null,
    },
    thresholds: QUALITY_THRESHOLDS,
    steps: currentNodeVersionCheck === null ? [] : [currentNodeVersionCheck],
    measurements: null,
    performanceChecks: [],
    failures: [{ name: "Quality gate", status: "failed", error: describeError(error) }],
    overallStatus: "failed",
  };
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(fallbackReport, null, 2)}\n`, "utf8");
  console.error(`Quality gate failed: ${describeError(error)}`);
  console.error("A failure report was written to reports/c2-1-1/quality-performance-report.json.");
  process.exitCode = 1;
}
