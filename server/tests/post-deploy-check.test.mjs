import { describe, expect, it, vi } from "vitest";

import {
  parseArguments,
  runPostDeployCheck,
  waitForHealthyDeployment,
} from "../../scripts/post-deploy-check.mjs";

describe("post-deployment check", () => {
  it("accepte une URL CLI ou la variable d’environnement et normalise la fin", () => {
    expect(parseArguments(["--url", "https://example.test/"]).baseUrl)
      .toBe("https://example.test");
    expect(parseArguments([], { POST_DEPLOY_CHECK_URL: "http://localhost:3000/" }).baseUrl)
      .toBe("http://localhost:3000");
  });

  it("refuse les URL non HTTP et les paramètres hors bornes", () => {
    expect(() => parseArguments(["file:///tmp/index.html"])).toThrow(/http or https/u);
    expect(() => parseArguments(["--url", "https://example.test", "--attempts", "6"]))
      .toThrow(/between 1 and 5/u);
  });

  it("borne les nouvelles tentatives au réveil du health check", async () => {
    const verifyHealthProbe = vi.fn()
      .mockRejectedValueOnce(new Error("sleeping"))
      .mockResolvedValue({ durationMs: 4 });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await waitForHealthyDeployment({
      baseUrl: "https://example.test",
      timeoutMs: 1_000,
      attempts: 3,
      retryDelayMs: 10,
    }, {
      verifyHealthProbe,
      sleep,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.attemptsUsed).toBe(2);
    expect(verifyHealthProbe).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it("ne crée ni salon ni partie pendant les vérifications", async () => {
    const socket = { connected: true };
    const verifyHealthProbe = vi.fn().mockResolvedValue({ durationMs: 1 });
    const verifyFrontendProbe = vi.fn().mockResolvedValue({ durationMs: 2 });
    const connectSocketProbe = vi.fn().mockResolvedValue({
      socket,
      durationMs: 3,
      transport: "websocket",
    });
    const pingSocketProbe = vi.fn().mockResolvedValue({
      sentAt: 1,
      receivedAt: 2,
      durationMs: 4,
    });
    const closeSocketProbe = vi.fn().mockReturnValue({ durationMs: 0.1 });

    const result = await runPostDeployCheck({
      baseUrl: "https://example.test",
      timeoutMs: 1_000,
      attempts: 1,
      retryDelayMs: 0,
    }, {
      verifyHealthProbe,
      verifyFrontendProbe,
      connectSocketProbe,
      pingSocketProbe,
      closeSocketProbe,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.socket.transport).toBe("websocket");
    expect(pingSocketProbe).toHaveBeenCalledTimes(1);
    expect(pingSocketProbe).toHaveBeenCalledWith(socket, { timeoutMs: 1_000 });
    expect(closeSocketProbe).toHaveBeenCalledTimes(1);
    expect(closeSocketProbe).toHaveBeenCalledWith(socket);
  });
});
