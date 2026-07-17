import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  closeHttpServer,
  closeSocketServer,
  createGracefulShutdown,
  installShutdownSignalHandlers,
  type ShutdownSignal,
} from "../src/shutdown/graceful-shutdown.js";
import { createDrawingGameServer } from "../src/create-server.js";
import { TEST_CLIENT_INSTANCE_ID } from "./test-client-instance.js";

const FORCE_SHUTDOWN_DELAY_MS = 25_000;

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function createWatchdog() {
  const handle = Symbol("force-shutdown-timeout");
  let callback: (() => void) | undefined;
  const scheduleTimeout = vi.fn(
    (scheduledCallback: () => void, _delay: number): unknown => {
      callback = scheduledCallback;
      return handle;
    },
  );
  const clearScheduledTimeout = vi.fn((_handle: unknown): void => undefined);

  return {
    handle,
    scheduleTimeout,
    clearScheduledTimeout,
    run(): void {
      if (callback === undefined) {
        throw new Error("Le watchdog n’a pas été planifié.");
      }

      callback();
    },
  };
}

function createShutdownHarness() {
  const closeSocketServerSpy = vi.fn(
    async (): Promise<void> => undefined,
  );
  const closeHttpServerSpy = vi.fn(
    async (): Promise<void> => undefined,
  );
  const dispose = vi.fn((): void => undefined);
  const exit = vi.fn((_code: number): void => undefined);
  const logger = {
    info: vi.fn((_message: string): void => undefined),
    error: vi.fn((_message: string): void => undefined),
  };
  const watchdog = createWatchdog();
  const controller = createGracefulShutdown({
    closeSocketServer: closeSocketServerSpy,
    closeHttpServer: closeHttpServerSpy,
    dispose,
    exit,
    logger,
    forceShutdownDelayMs: FORCE_SHUTDOWN_DELAY_MS,
    scheduleTimeout: watchdog.scheduleTimeout,
    clearScheduledTimeout: watchdog.clearScheduledTimeout,
  });

  return {
    controller,
    closeSocketServerSpy,
    closeHttpServerSpy,
    dispose,
    exit,
    logger,
    watchdog,
  };
}

function serverNotRunningError(): Error & { code: string } {
  return Object.assign(new Error("Server is not running."), {
    code: "ERR_SERVER_NOT_RUNNING",
  });
}

describe("installShutdownSignalHandlers", () => {
  it.each<ShutdownSignal>(["SIGTERM", "SIGINT"])(
    "transmet %s une seule fois et détache les deux listeners",
    (signal) => {
      const signalSource = new EventEmitter();
      const shutdown = vi.fn(
        async (_receivedSignal: ShutdownSignal): Promise<void> => undefined,
      );

      installShutdownSignalHandlers(signalSource, shutdown);
      expect(signalSource.listenerCount("SIGTERM")).toBe(1);
      expect(signalSource.listenerCount("SIGINT")).toBe(1);

      signalSource.emit(signal);

      expect(shutdown).toHaveBeenCalledOnce();
      expect(shutdown).toHaveBeenCalledWith(signal);
      expect(signalSource.listenerCount("SIGTERM")).toBe(0);
      expect(signalSource.listenerCount("SIGINT")).toBe(0);
    },
  );

  it("désinstalle les listeners de façon idempotente", () => {
    const signalSource = new EventEmitter();
    const off = vi.spyOn(signalSource, "off");
    const shutdown = vi.fn(
      async (_signal: ShutdownSignal): Promise<void> => undefined,
    );
    const uninstall = installShutdownSignalHandlers(
      signalSource,
      shutdown,
    );

    uninstall();
    uninstall();

    expect(off).toHaveBeenCalledTimes(2);
    expect(signalSource.listenerCount("SIGTERM")).toBe(0);
    expect(signalSource.listenerCount("SIGINT")).toBe(0);
    signalSource.emit("SIGTERM");
    expect(shutdown).not.toHaveBeenCalled();
  });
});

describe("createGracefulShutdown", () => {
  it("ferme Socket.IO puis HTTP, nettoie les timers et sort avec succès", async () => {
    const harness = createShutdownHarness();

    await harness.controller.shutdown("SIGTERM");

    expect(harness.controller.isShuttingDown).toBe(true);
    expect(harness.closeSocketServerSpy).toHaveBeenCalledOnce();
    expect(harness.closeHttpServerSpy).toHaveBeenCalledOnce();
    expect(harness.dispose).toHaveBeenCalledOnce();
    expect(harness.watchdog.scheduleTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      FORCE_SHUTDOWN_DELAY_MS,
    );
    expect(harness.watchdog.clearScheduledTimeout).toHaveBeenCalledWith(
      harness.watchdog.handle,
    );
    expect(harness.exit).toHaveBeenCalledOnce();
    expect(harness.exit).toHaveBeenCalledWith(0);
    expect(harness.logger.info).toHaveBeenCalledWith(
      "[shutdown] Complete.",
    );
  });

  it("continue les autres nettoyages après une erreur et sort avec le code 1", async () => {
    const harness = createShutdownHarness();
    harness.closeSocketServerSpy.mockRejectedValueOnce(
      new Error("Socket.IO close failed"),
    );

    await harness.controller.shutdown("SIGINT");

    expect(harness.closeSocketServerSpy).toHaveBeenCalledOnce();
    expect(harness.closeHttpServerSpy).toHaveBeenCalledOnce();
    expect(harness.dispose).toHaveBeenCalledOnce();
    expect(harness.watchdog.clearScheduledTimeout).toHaveBeenCalledOnce();
    expect(harness.exit).toHaveBeenCalledOnce();
    expect(harness.exit).toHaveBeenCalledWith(1);
    expect(harness.logger.error).toHaveBeenCalledWith(
      "[shutdown] Failed while closing resources.",
    );
  });

  it("force une sortie en erreur lorsque le watchdog expire", async () => {
    const harness = createShutdownHarness();
    const socketClose = createDeferred();
    harness.closeSocketServerSpy.mockReturnValueOnce(socketClose.promise);

    const shutdown = harness.controller.shutdown("SIGTERM");
    harness.watchdog.run();

    expect(harness.dispose).toHaveBeenCalledOnce();
    expect(harness.exit).toHaveBeenCalledOnce();
    expect(harness.exit).toHaveBeenCalledWith(1);
    expect(harness.logger.error).toHaveBeenCalledWith(
      `[shutdown] Forced after ${FORCE_SHUTDOWN_DELAY_MS} ms.`,
    );

    socketClose.resolve();
    await shutdown;
  });

  it("ne demande pas une seconde sortie après une fermeture tardive", async () => {
    const harness = createShutdownHarness();
    const socketClose = createDeferred();
    harness.closeSocketServerSpy.mockReturnValueOnce(socketClose.promise);
    const shutdown = harness.controller.shutdown("SIGTERM");

    harness.watchdog.run();
    socketClose.resolve();
    await shutdown;

    expect(harness.closeHttpServerSpy).toHaveBeenCalledOnce();
    expect(harness.dispose).toHaveBeenCalledTimes(2);
    expect(harness.exit).toHaveBeenCalledOnce();
    expect(harness.exit).toHaveBeenCalledWith(1);
    expect(harness.exit).not.toHaveBeenCalledWith(0);
  });

  it("deux signaux successifs ne lancent qu’une seule fermeture", async () => {
    const harness = createShutdownHarness();
    const socketClose = createDeferred();
    harness.closeSocketServerSpy.mockReturnValueOnce(socketClose.promise);
    const signalSource = new EventEmitter();

    installShutdownSignalHandlers(
      signalSource,
      harness.controller.shutdown,
    );
    signalSource.emit("SIGTERM");
    signalSource.emit("SIGINT");

    expect(harness.closeSocketServerSpy).toHaveBeenCalledOnce();
    expect(harness.watchdog.scheduleTimeout).toHaveBeenCalledOnce();

    socketClose.resolve();
    await harness.controller.shutdown("SIGINT");

    expect(harness.closeSocketServerSpy).toHaveBeenCalledOnce();
    expect(harness.closeHttpServerSpy).toHaveBeenCalledOnce();
    expect(harness.dispose).toHaveBeenCalledOnce();
    expect(harness.exit).toHaveBeenCalledOnce();
  });
});

describe("closeSocketServer", () => {
  it("attend la fermeture Socket.IO", async () => {
    const close = vi.fn(
      (callback: (error?: Error) => void): void => callback(),
    );

    await expect(closeSocketServer({ close })).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });

  it("ignore ERR_SERVER_NOT_RUNNING renvoyée par Socket.IO", async () => {
    const close = vi.fn(
      (callback: (error?: Error) => void): void => {
        callback(serverNotRunningError());
      },
    );

    await expect(closeSocketServer({ close })).resolves.toBeUndefined();
  });

  it("propage une autre erreur de fermeture Socket.IO", async () => {
    const error = new Error("Socket.IO close failed");
    const close = vi.fn(
      (callback: (error?: Error) => void): void => callback(error),
    );

    await expect(closeSocketServer({ close })).rejects.toBe(error);
  });
});

describe("closeHttpServer", () => {
  it("ne rappelle pas close lorsque Socket.IO a déjà arrêté HTTP", async () => {
    const close = vi.fn(
      (_callback: (error?: Error) => void): void => undefined,
    );

    await expect(
      closeHttpServer({ listening: false, close }),
    ).resolves.toBeUndefined();
    expect(close).not.toHaveBeenCalled();
  });

  it("ferme un serveur HTTP encore à l’écoute", async () => {
    const close = vi.fn(
      (callback: (error?: Error) => void): void => callback(),
    );

    await expect(
      closeHttpServer({ listening: true, close }),
    ).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });

  it("ignore ERR_SERVER_NOT_RUNNING pendant le fallback HTTP", async () => {
    const close = vi.fn(
      (callback: (error?: Error) => void): void => {
        callback(serverNotRunningError());
      },
    );

    await expect(
      closeHttpServer({ listening: true, close }),
    ).resolves.toBeUndefined();
  });

  it("propage une autre erreur de fermeture HTTP", async () => {
    const error = new Error("HTTP close failed");
    const close = vi.fn(
      (callback: (error?: Error) => void): void => callback(error),
    );

    await expect(
      closeHttpServer({ listening: true, close }),
    ).rejects.toBe(error);
  });
});

describe("drawing game server disposal", () => {
  it("nettoie une transition de partie et un timer de reconnexion une seule fois", async () => {
    const gameTimer = Symbol("game-timer");
    const reconnectTimer = Symbol("reconnect-timer");
    const clearGameTimer = vi.fn((_handle: unknown): void => undefined);
    const clearReconnectTimer = vi.fn(
      (_handle: unknown): void => undefined,
    );
    let nextGameId = 0;
    let nextTurnId = 0;
    const server = createDrawingGameServer({
      serveClient: false,
      gameManagerOptions: {
        clock: () => 1_000,
        generateGameId: () => `game-${++nextGameId}`,
        generateTurnId: () => `turn-${++nextTurnId}`,
        shufflePlayerIds: (playerIds) => [...playerIds],
        selectPrompt: (prompts) => prompts[0]!,
        generateSecretLevel: () => 7,
        scheduleTimer: () => gameTimer,
        clearTimer: clearGameTimer,
      },
      reconnectManagerOptions: {
        clock: () => 1_000,
        scheduleTimer: () => reconnectTimer,
        clearTimer: clearReconnectTimer,
      },
    });

    const created = server.roomManager.createRoom(
      "socket-1",
      "J1",
      TEST_CLIENT_INSTANCE_ID,
    );
    const roomCode = created.session.roomCode;
    server.roomManager.joinRoom(
      "socket-2",
      "J2",
      roomCode,
      TEST_CLIENT_INSTANCE_ID,
    );
    server.roomManager.joinRoom(
      "socket-3",
      "J3",
      roomCode,
      TEST_CLIENT_INSTANCE_ID,
    );
    server.roomManager.setPlayerReady("socket-1", true);
    server.roomManager.setPlayerReady("socket-2", true);
    server.roomManager.setPlayerReady("socket-3", true);
    server.gameManager.startGame("socket-1");
    server.reconnectManager.markPlayerDisconnected("socket-2");

    expect(server.reconnectManager.getPendingTimerCount()).toBe(1);

    server.dispose();
    server.dispose();

    expect(clearGameTimer).toHaveBeenCalledOnce();
    expect(clearGameTimer).toHaveBeenCalledWith(gameTimer);
    expect(clearReconnectTimer).toHaveBeenCalledOnce();
    expect(clearReconnectTimer).toHaveBeenCalledWith(reconnectTimer);
    expect(server.reconnectManager.getPendingTimerCount()).toBe(0);

    await expect(closeSocketServer(server.io)).resolves.toBeUndefined();
  });
});
