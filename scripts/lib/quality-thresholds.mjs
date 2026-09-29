export const QUALITY_THRESHOLDS = Object.freeze({
  serverStartupMs: 15_000,
  health: Object.freeze({
    warmupRequests: 5,
    measuredRequests: 30,
    requiredSuccessRate: 1,
    p95Ms: 250,
    requestTimeoutMs: 5_000,
  }),
  socket: Object.freeze({
    warmupRoundTrips: 3,
    measuredRoundTrips: 20,
    requiredSuccessRate: 1,
    p95Ms: 500,
    connectTimeoutMs: 10_000,
    pingTimeoutMs: 5_000,
  }),
  frontend: Object.freeze({
    referenceTotalBytes: 1_796_460,
    maximumTotalBytes: 2_150_000,
    maximumGrowthPercent: 20,
  }),
});

