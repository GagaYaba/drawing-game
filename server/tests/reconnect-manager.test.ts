import { describe, expect, it, vi } from "vitest";

import { GameManager } from "../src/game/game-manager.js";
import { RoomManager, RoomManagerError } from "../src/rooms/room-manager.js";
import {
  MAX_RECONNECT_TIMER_DELAY_MS,
  ReconnectManager,
  isValidReconnectGraceMs,
} from "../src/sessions/reconnect-manager.js";
import { SessionRestorationManager } from "../src/sessions/session-restoration.js";

const ROOM_CODE = "7KXMP";

interface ManualTimers {
  scheduleTimer: (callback: () => void, delay: number) => number;
  clearTimer: (handle: unknown) => void;
  runNext: () => void;
  pendingCount: () => number;
  delays: number[];
}

function createManualTimers(): ManualTimers {
  let nextHandle = 0;
  const callbacks = new Map<number, () => void>();
  const delays: number[] = [];

  return {
    scheduleTimer: (callback, delay) => {
      const handle = ++nextHandle;
      callbacks.set(handle, callback);
      delays.push(delay);
      return handle;
    },
    clearTimer: (handle) => {
      if (typeof handle === "number") {
        callbacks.delete(handle);
      }
    },
    runNext: () => {
      const entry = callbacks.entries().next().value as
        | [number, () => void]
        | undefined;
      if (entry === undefined) {
        throw new Error("Aucun timer manuel n’est planifié.");
      }
      callbacks.delete(entry[0]);
      entry[1]();
    },
    pendingCount: () => callbacks.size,
    delays,
  };
}

function createManagers(playerCount = 1) {
  let nextPlayerId = 0;
  const roomManager = new RoomManager({
    codeGenerator: () => ROOM_CODE,
    idGenerator: () => `player-${++nextPlayerId}`,
    clock: () => 100,
  });
  const host = roomManager.createRoom("socket-1", "J1");

  for (let index = 2; index <= playerCount; index += 1) {
    roomManager.joinRoom(`socket-${index}`, `J${index}`, ROOM_CODE);
  }

  const gameManager = new GameManager(roomManager, {
    generateGameId: () => "game-1",
    generateTurnId: () => "turn-1",
    shufflePlayerIds: (playerIds) => [...playerIds],
    selectPrompt: (prompts) => prompts[0]!,
    generateSecretLevel: () => 7,
    scheduleTimer: () => Symbol("phase-timer"),
    clearTimer: () => undefined,
  });

  return { roomManager, gameManager, host };
}

function expectRoomError(
  action: () => unknown,
  code: RoomManagerError["code"],
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(RoomManagerError);
    expect((error as RoomManagerError).code).toBe(code);
    return;
  }

  throw new Error(`Une erreur ${code} était attendue.`);
}

describe("ReconnectManager", () => {
  it("borne le délai à la limite fiable de setTimeout", () => {
    const { roomManager, gameManager } = createManagers();
    const reconnectManager = new ReconnectManager(
      roomManager,
      gameManager,
      { graceMs: MAX_RECONNECT_TIMER_DELAY_MS },
    );

    expect(isValidReconnectGraceMs(MAX_RECONNECT_TIMER_DELAY_MS)).toBe(true);
    expect(
      isValidReconnectGraceMs(MAX_RECONNECT_TIMER_DELAY_MS + 1),
    ).toBe(false);
    expect(
      () =>
        new ReconnectManager(roomManager, gameManager, {
          graceMs: MAX_RECONNECT_TIMER_DELAY_MS + 1,
        }),
    ).toThrow(RangeError);

    reconnectManager.dispose();
  });

  it("conserve le joueur, reprogramme un callback précoce puis expire au deadline", () => {
    let now = 1_000;
    const timers = createManualTimers();
    const { roomManager, gameManager, host } = createManagers();
    const onPlayerExpired = vi.fn();
    const reconnectManager = new ReconnectManager(
      roomManager,
      gameManager,
      {
        graceMs: 60,
        clock: () => now,
        scheduleTimer: timers.scheduleTimer,
        clearTimer: timers.clearTimer,
        onPlayerExpired,
      },
    );

    const disconnected =
      reconnectManager.markPlayerDisconnected("socket-1");

    expect(disconnected).toMatchObject({
      roomCode: ROOM_CODE,
      playerId: host.session.playerId,
      reconnectDeadline: 1_060,
    });
    expect(disconnected?.room.players[0]).toMatchObject({
      id: host.session.playerId,
      isConnected: false,
      reconnectDeadline: 1_060,
    });
    expect(roomManager.getRoomByCode(ROOM_CODE)?.players).toHaveLength(1);
    expect(reconnectManager.getPendingTimerCount()).toBe(1);

    now = 1_059;
    timers.runNext();
    expect(roomManager.getRoomByCode(ROOM_CODE)?.players).toHaveLength(1);
    expect(reconnectManager.getPendingTimerCount()).toBe(1);
    expect(timers.delays.at(-1)).toBe(1);

    now = 1_060;
    timers.runNext();
    expect(roomManager.getRoomByCode(ROOM_CODE)).toBeUndefined();
    expect(reconnectManager.getPendingTimerCount()).toBe(0);
    expect(onPlayerExpired).toHaveBeenCalledWith({
      departure: expect.objectContaining({
        playerId: host.session.playerId,
        roomDeleted: true,
      }),
      gameWasCancelled: false,
    });
  });

  it("restaure le même joueur avant expiration et nettoie son timer", () => {
    let now = 2_000;
    const timers = createManualTimers();
    const { roomManager, gameManager, host } = createManagers(2);
    const reconnectManager = new ReconnectManager(
      roomManager,
      gameManager,
      {
        graceMs: 60,
        clock: () => now,
        scheduleTimer: timers.scheduleTimer,
        clearTimer: timers.clearTimer,
      },
    );
    const restorationManager = new SessionRestorationManager(
      roomManager,
      reconnectManager,
      { clock: () => now },
    );
    const internalHost = roomManager
      .getRoomByCode(ROOM_CODE)
      ?.players.find((player) => player.id === host.session.playerId);
    if (internalHost === undefined) {
      throw new Error("L’hôte interne est introuvable.");
    }
    internalHost.score = 12;

    reconnectManager.markPlayerDisconnected("socket-1");
    now = 2_030;
    const restored = restorationManager.restoreSession(
      "socket-restored",
      host.session,
    );

    expect(restored.session).toEqual(host.session);
    expect(restored.room.players[0]).toMatchObject({
      id: host.session.playerId,
      isHost: true,
      isConnected: true,
      reconnectDeadline: null,
      score: 12,
    });
    expect(
      roomManager.getPlayerRoomBySocketId("socket-restored")?.code,
    ).toBe(ROOM_CODE);
    expect(reconnectManager.getPendingTimerCount()).toBe(0);
    expect(timers.pendingCount()).toBe(0);

    expectRoomError(
      () =>
        restorationManager.prepareSessionRestore(
          "socket-attacker",
          {
            ...host.session,
            token: `${host.session.token.startsWith("A") ? "B" : "A"}${host.session.token.slice(1)}`,
          },
        ),
      "INVALID_SESSION",
    );
  });

  it("annule une phase active uniquement à l’expiration", () => {
    let now = 3_000;
    const timers = createManualTimers();
    const { roomManager, gameManager } = createManagers(3);
    for (let index = 1; index <= 3; index += 1) {
      roomManager.setPlayerReady(`socket-${index}`, true);
    }
    gameManager.startGame("socket-1");
    const onPlayerExpired = vi.fn();
    const reconnectManager = new ReconnectManager(
      roomManager,
      gameManager,
      {
        graceMs: 50,
        clock: () => now,
        scheduleTimer: timers.scheduleTimer,
        clearTimer: timers.clearTimer,
        onPlayerExpired,
      },
    );

    reconnectManager.markPlayerDisconnected("socket-3");
    expect(roomManager.getPublicRoomState(ROOM_CODE).game).not.toBeNull();

    now = 3_050;
    timers.runNext();
    const lobby = roomManager.getPublicRoomState(ROOM_CODE);

    expect(lobby.game).toBeNull();
    expect(lobby.playerCount).toBe(2);
    expect(lobby.players.every((player) => !player.isReady)).toBe(true);
    expect(lobby.players.every((player) => player.score === 0)).toBe(true);
    expect(onPlayerExpired).toHaveBeenCalledWith({
      departure: expect.objectContaining({
        roomCode: ROOM_CODE,
        roomDeleted: false,
      }),
      gameWasCancelled: true,
    });
  });

  it("expire de façon déterministe si le planificateur est indisponible", () => {
    const { roomManager, gameManager, host } = createManagers();
    const onPlayerExpired = vi.fn();
    const onError = vi.fn();
    const reconnectManager = new ReconnectManager(
      roomManager,
      gameManager,
      {
        graceMs: 60,
        clock: () => 4_000,
        scheduleTimer: () => {
          throw new Error("scheduler indisponible");
        },
        onPlayerExpired,
        onError,
      },
    );

    expect(
      reconnectManager.markPlayerDisconnected("socket-1"),
    ).toBeNull();
    expect(roomManager.getRoomByCode(ROOM_CODE)).toBeUndefined();
    expect(reconnectManager.getPendingTimerCount()).toBe(0);
    expect(onError).toHaveBeenCalledOnce();
    expect(onPlayerExpired).toHaveBeenCalledWith({
      departure: expect.objectContaining({
        playerId: host.session.playerId,
        roomDeleted: true,
      }),
      gameWasCancelled: false,
    });
  });
});
