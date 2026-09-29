import { describe, expect, it } from "vitest";

import {
  calculatePercentile,
  evaluateFrontendBudget,
  evaluatePerformanceThresholds,
  summarizeFrontendFiles,
} from "../../scripts/lib/quality-metrics.mjs";

const THRESHOLDS = {
  serverStartupMs: 15_000,
  health: {
    measuredRequests: 30,
    requiredSuccessRate: 1,
    p95Ms: 250,
  },
  socket: {
    measuredRoundTrips: 20,
    requiredSuccessRate: 1,
    p95Ms: 500,
  },
};

describe("quality metrics", () => {
  it("calcule le percentile par rang supérieur sans modifier la série", () => {
    const values = [30, 10, 20, 40, 50, 60, 70, 80, 90, 100,
      110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
    const original = [...values];

    expect(calculatePercentile(values, 95)).toBe(190);
    expect(calculatePercentile(values, 0)).toBe(10);
    expect(calculatePercentile(values, 100)).toBe(200);
    expect(values).toEqual(original);
  });

  it("refuse les séries vides, les percentiles hors bornes et les valeurs non finies", () => {
    expect(() => calculatePercentile([], 95)).toThrow(RangeError);
    expect(() => calculatePercentile([1], -1)).toThrow(RangeError);
    expect(() => calculatePercentile([1], 101)).toThrow(RangeError);
    expect(() => calculatePercentile([1, Number.NaN], 95)).toThrow(TypeError);
  });

  it("accepte les mesures exactement égales aux seuils", () => {
    const evaluation = evaluatePerformanceThresholds({
      serverStartupMs: 15_000,
      health: {
        successCount: 30,
        requestCount: 30,
        latenciesMs: Array.from({ length: 30 }, () => 250),
      },
      socket: {
        successCount: 20,
        roundTripCount: 20,
        latenciesMs: Array.from({ length: 20 }, () => 500),
      },
    }, THRESHOLDS);

    expect(evaluation.passed).toBe(true);
    expect(evaluation.checks.every(({ passed }) => passed)).toBe(true);
  });

  it("échoue pour un seul appel perdu ou une p95 supérieure au seuil", () => {
    const evaluation = evaluatePerformanceThresholds({
      serverStartupMs: 15_001,
      health: {
        successCount: 29,
        requestCount: 30,
        latenciesMs: [...Array.from({ length: 27 }, () => 1), 251, 251],
      },
      socket: {
        successCount: 19,
        roundTripCount: 20,
        latenciesMs: [...Array.from({ length: 18 }, () => 1), 501],
      },
    }, THRESHOLDS);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.checks.filter(({ passed }) => !passed).map(({ name }) => name))
      .toEqual([
        "server-startup",
        "health-success-rate",
        "health-p95",
        "socket-success-rate",
        "socket-p95",
      ]);
  });

  it("exige au moins 30 mesures HTTP et 20 mesures Socket.IO", () => {
    const evaluation = evaluatePerformanceThresholds({
      serverStartupMs: 1,
      health: { successCount: 1, requestCount: 1, latenciesMs: [1] },
      socket: { successCount: 1, roundTripCount: 1, latenciesMs: [1] },
    }, THRESHOLDS);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.checks.filter(({ passed }) => !passed).map(({ name }) => name))
      .toEqual(["health-measurement-count", "socket-measurement-count"]);
  });

  it("produit des contrôles p95 échoués lorsqu’aucune latence ne réussit", () => {
    const evaluation = evaluatePerformanceThresholds({
      serverStartupMs: 1,
      health: { successCount: 0, requestCount: 30, latenciesMs: [] },
      socket: { successCount: 0, roundTripCount: 20, latenciesMs: [] },
    }, THRESHOLDS);

    expect(evaluation.healthP95Ms).toBeNull();
    expect(evaluation.socketP95Ms).toBeNull();
    expect(evaluation.passed).toBe(false);
  });

  it("agrège récursivement les catégories de fichiers déjà collectées", () => {
    const summary = summarizeFrontendFiles([
      { path: "index.html", sizeBytes: 100 },
      { path: "assets/app.js", sizeBytes: 300 },
      { path: "assets/app.css", sizeBytes: 200 },
      { path: "mascots/pig.png", sizeBytes: 400 },
    ]);

    expect(summary).toMatchObject({
      fileCount: 4,
      totalBytes: 1_000,
      javascriptBytes: 300,
      cssBytes: 200,
      imageBytes: 400,
      largestFile: { path: "mascots/pig.png", sizeBytes: 400 },
    });
  });

  it("applique un budget statique et refuse son dépassement d’un octet", () => {
    const budget = {
      referenceTotalBytes: 1_000,
      maximumTotalBytes: 1_200,
      maximumGrowthPercent: 20,
    };

    expect(evaluateFrontendBudget({ totalBytes: 1_200 }, budget).passed).toBe(true);
    expect(evaluateFrontendBudget({ totalBytes: 1_201 }, budget).passed).toBe(false);
  });

  it("refuse une configuration de budget dépassant elle-même la marge autorisée", () => {
    const result = evaluateFrontendBudget(
      { totalBytes: 1_000 },
      {
        referenceTotalBytes: 1_000,
        maximumTotalBytes: 1_201,
        maximumGrowthPercent: 20,
      },
    );

    expect(result.configurationValid).toBe(false);
    expect(result.passed).toBe(false);
  });
});
