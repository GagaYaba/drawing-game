import { readdir, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

function assertFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
}

export function calculatePercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new RangeError("At least one value is required to calculate a percentile.");
  }
  assertFiniteNumber(percentile, "The percentile");
  if (percentile < 0 || percentile > 100) {
    throw new RangeError("The percentile must be between 0 and 100 inclusive.");
  }

  const sorted = values.map((value, index) => {
    assertFiniteNumber(value, `Value at index ${index}`);
    return value;
  }).sort((left, right) => left - right);
  const rank = percentile === 0
    ? 0
    : Math.ceil((percentile / 100) * sorted.length) - 1;

  return sorted[rank];
}

export function summarizeFrontendFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new RangeError("At least one frontend build file is required.");
  }

  const normalizedFiles = files.map((file, index) => {
    if (
      typeof file !== "object" ||
      file === null ||
      typeof file.path !== "string" ||
      file.path.length === 0
    ) {
      throw new TypeError(`Frontend file at index ${index} has no valid path.`);
    }
    assertFiniteNumber(file.sizeBytes, `Size of ${file.path}`);
    if (!Number.isInteger(file.sizeBytes) || file.sizeBytes < 0) {
      throw new RangeError(`Size of ${file.path} must be a non-negative integer.`);
    }
    return { path: file.path, sizeBytes: file.sizeBytes };
  }).sort((left, right) => left.path.localeCompare(right.path, "en"));
  const sumForExtension = (extension) => normalizedFiles
    .filter(({ path }) => path.toLowerCase().endsWith(extension))
    .reduce((sum, { sizeBytes }) => sum + sizeBytes, 0);
  const largestFile = [...normalizedFiles].sort((left, right) =>
    right.sizeBytes - left.sizeBytes || left.path.localeCompare(right.path, "en")
  )[0];

  return {
    fileCount: normalizedFiles.length,
    totalBytes: normalizedFiles.reduce(
      (sum, { sizeBytes }) => sum + sizeBytes,
      0,
    ),
    javascriptBytes: sumForExtension(".js"),
    cssBytes: sumForExtension(".css"),
    imageBytes: normalizedFiles
      .filter(({ path }) => /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/iu.test(path))
      .reduce((sum, { sizeBytes }) => sum + sizeBytes, 0),
    largestFile,
    files: normalizedFiles,
  };
}

export function evaluateFrontendBudget(summary, budget) {
  assertFiniteNumber(summary?.totalBytes, "The frontend total size");
  assertFiniteNumber(budget?.referenceTotalBytes, "The frontend reference size");
  assertFiniteNumber(budget?.maximumTotalBytes, "The frontend maximum size");
  assertFiniteNumber(
    budget?.maximumGrowthPercent,
    "The frontend maximum growth percentage",
  );

  const allowedByMaximumGrowth = Math.floor(
    budget.referenceTotalBytes * (1 + budget.maximumGrowthPercent / 100),
  );
  const configuredMarginPercent =
    ((budget.maximumTotalBytes - budget.referenceTotalBytes) /
      budget.referenceTotalBytes) * 100;
  const configurationValid =
    budget.maximumTotalBytes <= allowedByMaximumGrowth &&
    budget.maximumTotalBytes >= budget.referenceTotalBytes;
  const passed = configurationValid && summary.totalBytes <= budget.maximumTotalBytes;

  return {
    name: "frontend-total-bytes",
    passed,
    actual: summary.totalBytes,
    maximum: budget.maximumTotalBytes,
    reference: budget.referenceTotalBytes,
    configuredMarginPercent,
    configurationValid,
    message: configurationValid
      ? `${summary.totalBytes} bytes / ${budget.maximumTotalBytes} bytes maximum.`
      : "The configured frontend budget exceeds its allowed reference margin.",
  };
}

function maximumCheck(name, actual, maximum, unit) {
  assertFiniteNumber(actual, `${name} actual value`);
  assertFiniteNumber(maximum, `${name} maximum value`);
  return {
    name,
    passed: actual <= maximum,
    actual,
    maximum,
    unit,
    message: `${actual.toFixed(2)} ${unit} / ${maximum} ${unit} maximum.`,
  };
}

function latencyCheck(name, actual, maximum) {
  assertFiniteNumber(maximum, `${name} maximum value`);
  if (actual === null) {
    return {
      name,
      passed: false,
      actual: null,
      maximum,
      unit: "ms",
      message: `No successful latency was available / ${maximum} ms maximum.`,
    };
  }
  return maximumCheck(name, actual, maximum, "ms");
}

function minimumCountCheck(name, actual, minimum) {
  assertFiniteNumber(actual, `${name} actual count`);
  assertFiniteNumber(minimum, `${name} minimum count`);
  if (!Number.isInteger(actual) || !Number.isInteger(minimum) || minimum <= 0) {
    throw new RangeError(`${name} counts must be integers with a positive minimum.`);
  }
  return {
    name,
    passed: actual >= minimum,
    actual,
    minimum,
    unit: "count",
    message: `${actual} measurements / ${minimum} required.`,
  };
}

function successRateCheck(name, successCount, totalCount, requiredRate) {
  assertFiniteNumber(successCount, `${name} success count`);
  assertFiniteNumber(totalCount, `${name} total count`);
  assertFiniteNumber(requiredRate, `${name} required rate`);
  if (!Number.isInteger(successCount) || !Number.isInteger(totalCount) || totalCount <= 0) {
    throw new RangeError(`${name} counts must be integers with a positive total.`);
  }
  if (successCount < 0 || successCount > totalCount) {
    throw new RangeError(`${name} success count must be between zero and the total.`);
  }
  if (requiredRate < 0 || requiredRate > 1) {
    throw new RangeError(`${name} required rate must be between zero and one.`);
  }
  const actualRate = successCount / totalCount;
  return {
    name,
    passed: successCount === totalCount && actualRate >= requiredRate,
    actual: actualRate,
    required: requiredRate,
    successCount,
    totalCount,
    unit: "ratio",
    message: `${successCount}/${totalCount} successful (${(
      actualRate * 100
    ).toFixed(2)}%).`,
  };
}

export function evaluatePerformanceThresholds(measurements, thresholds) {
  const healthP95Ms = measurements.health.latenciesMs.length > 0
    ? calculatePercentile(measurements.health.latenciesMs, 95)
    : null;
  const socketP95Ms = measurements.socket.latenciesMs.length > 0
    ? calculatePercentile(measurements.socket.latenciesMs, 95)
    : null;
  const checks = [
    maximumCheck(
      "server-startup",
      measurements.serverStartupMs,
      thresholds.serverStartupMs,
      "ms",
    ),
    minimumCountCheck(
      "health-measurement-count",
      measurements.health.requestCount,
      thresholds.health.measuredRequests,
    ),
    successRateCheck(
      "health-success-rate",
      measurements.health.successCount,
      measurements.health.requestCount,
      thresholds.health.requiredSuccessRate,
    ),
    latencyCheck("health-p95", healthP95Ms, thresholds.health.p95Ms),
    minimumCountCheck(
      "socket-measurement-count",
      measurements.socket.roundTripCount,
      thresholds.socket.measuredRoundTrips,
    ),
    successRateCheck(
      "socket-success-rate",
      measurements.socket.successCount,
      measurements.socket.roundTripCount,
      thresholds.socket.requiredSuccessRate,
    ),
    latencyCheck("socket-p95", socketP95Ms, thresholds.socket.p95Ms),
  ];

  return {
    passed: checks.every(({ passed }) => passed),
    healthP95Ms,
    socketP95Ms,
    checks,
  };
}

async function walkFiles(directory, rootDirectory) {
  const entries = (await readdir(directory, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name, "en"),
  );
  const files = [];

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(absolutePath, rootDirectory));
    } else if (entry.isFile()) {
      const fileStats = await stat(absolutePath);
      files.push({
        path: relative(rootDirectory, absolutePath).replaceAll("\\", "/"),
        sizeBytes: fileStats.size,
      });
    }
  }

  return files;
}

export async function measureFrontendBuild(directory) {
  const rootDirectory = resolve(directory);
  const directoryStats = await stat(rootDirectory).catch(() => null);
  if (directoryStats === null || !directoryStats.isDirectory()) {
    throw new Error(
      `The frontend build directory is missing at ${rootDirectory}. Run the production build first.`,
    );
  }
  return summarizeFrontendFiles(await walkFiles(rootDirectory, rootDirectory));
}
