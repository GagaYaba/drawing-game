import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GameManager,
  ROUND_INTRO_DURATION_MS,
  TOTAL_ROUNDS,
} from "../src/game/game-manager.js";
import {
  generateSecretLevel,
  selectDrawingPrompt,
} from "../src/game/game-random.js";
import type { GameManagerOptions } from "../src/game/game-types.js";
import { DRAWING_PROMPTS } from "../src/game/prompt-bank.js";
import {
  RoomManager,
  RoomManagerError,
} from "../src/rooms/room-manager.js";

const ROOM_CODE = "7KXMP";
const GAME_CLOCK = 20_000;

interface PreparedRoom {
  roomManager: RoomManager;
  roomCode: string;
  socketIds: string[];
  playerIds: string[];
}

function createRoomManager(): RoomManager {
  let nextPlayerId = 1;
  let timestamp = 1_000;

  return new RoomManager({
    codeGenerator: () => ROOM_CODE,
    idGenerator: () => `player-${nextPlayerId++}`,
    clock: () => timestamp++,
  });
}

function prepareRoom(playerCount: number): PreparedRoom {
  if (playerCount < 1) {
    throw new RangeError("Un salon de test doit avoir au moins un joueur.");
  }

  const roomManager = createRoomManager();
  const socketIds = Array.from(
    { length: playerCount },
    (_, index) => `socket-${index + 1}`,
  );
  const host = roomManager.createRoom(socketIds[0] as string, "J1");
  const playerIds = [host.playerId];

  for (let index = 1; index < socketIds.length; index += 1) {
    const joined = roomManager.joinRoom(
      socketIds[index] as string,
      `J${index + 1}`,
      host.roomCode,
    );
    playerIds.push(joined.playerId);
  }

  return {
    roomManager,
    roomCode: host.roomCode,
    socketIds,
    playerIds,
  };
}

function setPlayersReady(
  preparedRoom: PreparedRoom,
  readyPlayerCount = preparedRoom.socketIds.length,
): void {
  for (const socketId of preparedRoom.socketIds.slice(0, readyPlayerCount)) {
    preparedRoom.roomManager.setPlayerReady(socketId, true);
  }
}

function createDeterministicGameManager(
  roomManager: RoomManager,
  overrides: GameManagerOptions = {},
): GameManager {
  return new GameManager(roomManager, {
    clock: () => GAME_CLOCK,
    shufflePlayerIds: (playerIds) => [...playerIds].reverse(),
    selectPrompt: (prompts) => {
      const prompt = prompts[0];

      if (prompt === undefined) {
        throw new Error("La banque de test est vide.");
      }

      return prompt;
    },
    generateTurnId: () => "turn-1",
    generateSecretLevel: () => 7,
    scheduleTimer: () => Symbol("phase-timer"),
    clearTimer: () => undefined,
    ...overrides,
  });
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

  throw new Error(`L'action aurait dû échouer avec le code ${code}.`);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GameManager", () => {
  it("refuse le lancement demandé par un joueur non-hôte", () => {
    const preparedRoom = prepareRoom(3);
    setPlayersReady(preparedRoom);
    const gameManager = createDeterministicGameManager(
      preparedRoom.roomManager,
    );

    expectRoomError(
      () => gameManager.startGame(preparedRoom.socketIds[1] as string),
      "NOT_HOST",
    );
    expect(
      preparedRoom.roomManager.getPublicRoomState(preparedRoom.roomCode).game,
    ).toBeNull();
  });

  it("refuse le lancement avec moins de trois joueurs", () => {
    const preparedRoom = prepareRoom(2);
    setPlayersReady(preparedRoom);
    const gameManager = createDeterministicGameManager(
      preparedRoom.roomManager,
    );

    expectRoomError(
      () => gameManager.startGame(preparedRoom.socketIds[0] as string),
      "NOT_ENOUGH_PLAYERS",
    );
  });

  it("refuse le lancement tant que tous les joueurs ne sont pas prêts", () => {
    const preparedRoom = prepareRoom(3);
    setPlayersReady(preparedRoom, 2);
    const gameManager = createDeterministicGameManager(
      preparedRoom.roomManager,
    );

    expectRoomError(
      () => gameManager.startGame(preparedRoom.socketIds[0] as string),
      "PLAYERS_NOT_READY",
    );
  });

  it("démarre de façon déterministe une partie avec trois joueurs prêts", () => {
    const preparedRoom = prepareRoom(3);
    setPlayersReady(preparedRoom);
    const gameManager = createDeterministicGameManager(
      preparedRoom.roomManager,
    );

    const result = gameManager.startGame(preparedRoom.socketIds[0] as string);

    expect(result.room.canStart).toBe(false);
    expect(result.room.game).toMatchObject({
      phase: "ROUND_INTRO",
      totalRounds: TOTAL_ROUNDS,
      currentRound: 1,
      currentTurnNumber: 1,
      totalTurns: 6,
      currentDrawer: {
        id: preparedRoom.playerIds[2],
        nickname: "J3",
      },
      prompt: {
        id: DRAWING_PROMPTS[0].id,
        statement: DRAWING_PROMPTS[0].statement,
        lowLabel: DRAWING_PROMPTS[0].lowLabel,
        highLabel: DRAWING_PROMPTS[0].highLabel,
      },
      phaseEndsAt: GAME_CLOCK + ROUND_INTRO_DURATION_MS,
    });
    expect(result.drawerSocketId).toBe(preparedRoom.socketIds[2]);
    expect(result.secret).toEqual({
      roomCode: preparedRoom.roomCode,
      turnId: "turn-1",
      drawerPlayerId: preparedRoom.playerIds[2],
      secretLevel: 7,
    });

    gameManager.dispose();
  });

  it("conserve chaque joueur une seule fois dans l'ordre et choisit le premier comme dessinateur", () => {
    const preparedRoom = prepareRoom(3);
    setPlayersReady(preparedRoom);
    const expectedOrder = [
      preparedRoom.playerIds[1] as string,
      preparedRoom.playerIds[2] as string,
      preparedRoom.playerIds[0] as string,
    ];
    const shufflePlayerIds = vi.fn(() => expectedOrder);
    const gameManager = createDeterministicGameManager(
      preparedRoom.roomManager,
      { shufflePlayerIds },
    );

    const result = gameManager.startGame(preparedRoom.socketIds[0] as string);
    const internalGame = preparedRoom.roomManager.getRoomByCode(
      preparedRoom.roomCode,
    )?.game;

    expect(shufflePlayerIds).toHaveBeenCalledOnce();
    expect(internalGame?.turnOrder).toEqual(expectedOrder);
    expect(new Set(internalGame?.turnOrder).size).toBe(
      preparedRoom.playerIds.length,
    );
    expect([...new Set(internalGame?.turnOrder)].sort()).toEqual(
      [...preparedRoom.playerIds].sort(),
    );
    expect(internalGame?.currentTurn.drawerPlayerId).toBe(expectedOrder[0]);
    expect(result.room.game?.currentDrawer.id).toBe(expectedOrder[0]);

    gameManager.dispose();
  });

  it("génère uniquement des niveaux secrets entiers entre 1 et 10", () => {
    const randomValues = [0, 0.01, 0.099, 0.1, 0.499, 0.5, 0.9, 0.999_999];
    const levels = randomValues.map((value) =>
      generateSecretLevel(() => value),
    );

    expect(levels.every(Number.isInteger)).toBe(true);
    expect(levels.every((level) => level >= 1 && level <= 10)).toBe(true);
    expect(levels).toContain(1);
    expect(levels).toContain(10);
  });

  it("utilise le générateur injecté pour imposer le niveau secret 7", () => {
    const preparedRoom = prepareRoom(3);
    setPlayersReady(preparedRoom);
    const generateLevel = vi.fn(() => 7);
    const gameManager = createDeterministicGameManager(
      preparedRoom.roomManager,
      { generateSecretLevel: generateLevel },
    );

    const result = gameManager.startGame(preparedRoom.socketIds[0] as string);

    expect(generateLevel).toHaveBeenCalledOnce();
    expect(result.secret.secretLevel).toBe(7);
    expect(
      preparedRoom.roomManager.getRoomByCode(preparedRoom.roomCode)?.game
        ?.currentTurn.secretLevel,
    ).toBe(7);

    gameManager.dispose();
  });

  it("sélectionne une consigne connue dans la banque", () => {
    const selectedPrompt = selectDrawingPrompt(DRAWING_PROMPTS, () => 0.5);
    expect(DRAWING_PROMPTS).toContain(selectedPrompt);
  });

  it("projette totalTurns sans exposer secret, socket ni ordre interne", () => {
    const preparedRoom = prepareRoom(3);
    setPlayersReady(preparedRoom);
    const gameManager = createDeterministicGameManager(
      preparedRoom.roomManager,
    );

    const result = gameManager.startGame(preparedRoom.socketIds[0] as string);
    const serializedPublicRoom = JSON.stringify(result.room);

    expect(result.room.game?.totalTurns).toBe(3 * TOTAL_ROUNDS);
    expect(result.room.game?.currentTurnNumber).toBe(1);
    expect(result.room.game).not.toHaveProperty("secretLevel");
    expect(result.room.game).not.toHaveProperty("turnOrder");
    expect(result.room.game?.prompt).toEqual({
      id: DRAWING_PROMPTS[0].id,
      statement: DRAWING_PROMPTS[0].statement,
      lowLabel: DRAWING_PROMPTS[0].lowLabel,
      highLabel: DRAWING_PROMPTS[0].highLabel,
    });
    expect(result.room.game?.prompt).not.toHaveProperty("category");
    expect(serializedPublicRoom).not.toContain("secretLevel");
    expect(serializedPublicRoom).not.toContain("socketId");
    expect(serializedPublicRoom).not.toContain("turnOrder");

    gameManager.dispose();
  });

  it("passe automatiquement de ROUND_INTRO à DRAWING avec les timers Vitest", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(GAME_CLOCK);
    const preparedRoom = prepareRoom(3);
    setPlayersReady(preparedRoom);
    const onPublicRoomStateChanged = vi.fn();
    const gameManager = new GameManager(preparedRoom.roomManager, {
      clock: Date.now,
      shufflePlayerIds: (playerIds) => [...playerIds],
      selectPrompt: () => DRAWING_PROMPTS[0],
      generateSecretLevel: () => 7,
      onPublicRoomStateChanged,
    });

    const started = gameManager.startGame(preparedRoom.socketIds[0] as string);
    expect(started.room.game?.phase).toBe("ROUND_INTRO");
    expect(started.room.game?.phaseEndsAt).toBe(
      GAME_CLOCK + ROUND_INTRO_DURATION_MS,
    );

    await vi.advanceTimersByTimeAsync(ROUND_INTRO_DURATION_MS - 1);
    expect(
      preparedRoom.roomManager.getPublicRoomState(preparedRoom.roomCode).game
        ?.phase,
    ).toBe("ROUND_INTRO");
    expect(onPublicRoomStateChanged).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    const drawingState = preparedRoom.roomManager.getPublicRoomState(
      preparedRoom.roomCode,
    );
    expect(drawingState.game?.phase).toBe("DRAWING");
    expect(drawingState.game?.phaseEndsAt).toBeNull();
    expect(onPublicRoomStateChanged).toHaveBeenCalledOnce();
    expect(onPublicRoomStateChanged).toHaveBeenCalledWith(
      preparedRoom.roomCode,
      drawingState,
    );

    gameManager.dispose();
  });

  it("annule la partie, nettoie son timer et remet tous les joueurs non prêts", () => {
    const preparedRoom = prepareRoom(3);
    setPlayersReady(preparedRoom);
    const timerHandle = Symbol("scheduled-transition");
    const clearTimer = vi.fn();
    const gameManager = createDeterministicGameManager(
      preparedRoom.roomManager,
      {
        scheduleTimer: () => timerHandle,
        clearTimer,
      },
    );
    gameManager.startGame(preparedRoom.socketIds[0] as string);

    expect(gameManager.cancelGame(preparedRoom.roomCode)).toBe(true);

    const cancelledRoom = preparedRoom.roomManager.getPublicRoomState(
      preparedRoom.roomCode,
    );
    expect(clearTimer).toHaveBeenCalledOnce();
    expect(clearTimer).toHaveBeenCalledWith(timerHandle);
    expect(cancelledRoom.game).toBeNull();
    expect(cancelledRoom.players.every((player) => !player.isReady)).toBe(true);
    expect(cancelledRoom.allPlayersReady).toBe(false);
    expect(cancelledRoom.canStart).toBe(false);
  });

  it("revient au lobby lorsque le retrait d'un joueur suit l'annulation", () => {
    const preparedRoom = prepareRoom(3);
    setPlayersReady(preparedRoom);
    const gameManager = createDeterministicGameManager(
      preparedRoom.roomManager,
    );
    gameManager.startGame(preparedRoom.socketIds[0] as string);

    expect(gameManager.cancelGame(preparedRoom.roomCode)).toBe(true);
    const departure = preparedRoom.roomManager.leaveRoom(
      preparedRoom.socketIds[1] as string,
    );

    expect(departure.room?.game).toBeNull();
    expect(departure.room?.playerCount).toBe(2);
    expect(
      departure.room?.players.every((player) => player.isReady === false),
    ).toBe(true);
  });

  it("nettoie les transitions encore planifiées lors de dispose", () => {
    const preparedRoom = prepareRoom(3);
    setPlayersReady(preparedRoom);
    const timerHandle = Symbol("scheduled-transition");
    const clearTimer = vi.fn();
    const gameManager = createDeterministicGameManager(
      preparedRoom.roomManager,
      {
        scheduleTimer: () => timerHandle,
        clearTimer,
      },
    );
    gameManager.startGame(preparedRoom.socketIds[0] as string);

    gameManager.dispose();
    gameManager.dispose();

    expect(clearTimer).toHaveBeenCalledOnce();
    expect(clearTimer).toHaveBeenCalledWith(timerHandle);
  });

  it("refuse un nouveau joueur après le lancement", () => {
    const preparedRoom = prepareRoom(3);
    setPlayersReady(preparedRoom);
    const gameManager = createDeterministicGameManager(
      preparedRoom.roomManager,
    );
    gameManager.startGame(preparedRoom.socketIds[0] as string);

    expectRoomError(
      () =>
        preparedRoom.roomManager.joinRoom(
          "socket-4",
          "J4",
          preparedRoom.roomCode,
        ),
      "GAME_ALREADY_STARTED",
    );

    gameManager.dispose();
  });

  it("refuse un deuxième lancement tant que la partie est active", () => {
    const preparedRoom = prepareRoom(3);
    setPlayersReady(preparedRoom);
    const gameManager = createDeterministicGameManager(
      preparedRoom.roomManager,
    );
    gameManager.startGame(preparedRoom.socketIds[0] as string);

    expectRoomError(
      () => gameManager.startGame(preparedRoom.socketIds[0] as string),
      "GAME_ALREADY_STARTED",
    );

    gameManager.dispose();
  });

  it("restaure le lobby intact lorsque la planification de transition échoue", () => {
    const preparedRoom = prepareRoom(3);
    setPlayersReady(preparedRoom);
    const scheduleTimer = vi.fn(() => {
      throw new Error("scheduler indisponible");
    });
    const clearTimer = vi.fn();
    const gameManager = createDeterministicGameManager(
      preparedRoom.roomManager,
      { scheduleTimer, clearTimer },
    );

    expectRoomError(
      () => gameManager.startGame(preparedRoom.socketIds[0] as string),
      "INTERNAL_ERROR",
    );

    const restoredRoom = preparedRoom.roomManager.getPublicRoomState(
      preparedRoom.roomCode,
    );
    expect(scheduleTimer).toHaveBeenCalledOnce();
    expect(clearTimer).not.toHaveBeenCalled();
    expect(restoredRoom.game).toBeNull();
    expect(restoredRoom.players.every((player) => player.isReady)).toBe(true);
    expect(restoredRoom.allPlayersReady).toBe(true);
    expect(restoredRoom.canStart).toBe(true);
  });
});
