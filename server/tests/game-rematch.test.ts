import {
  DRAWING_ALLOWED_STROKE_WIDTHS,
  DRAWING_ASPECT_RATIO,
  DRAWING_BACKGROUND_COLOR,
  DRAWING_COLOR_PALETTE,
  DRAWING_DOCUMENT_VERSION,
  type DrawingDocument,
  type PublicFinishedState,
} from "@drawing-game/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  createGameId,
  GameManager,
} from "../src/game/game-manager.js";
import type {
  DrawingPrompt,
  InternalGame,
  StartGameInternalResult,
} from "../src/game/game-types.js";
import {
  RoomManager,
  RoomManagerError,
} from "../src/rooms/room-manager.js";
import { TEST_CLIENT_INSTANCE_ID } from "./test-client-instance.js";

const ROOM_CODE = "7KXMP";
const PLAYER_COUNT = 3;

function requireSocketId(player: { socketId: string | null }): string {
  if (player.socketId === null) {
    throw new Error("Le joueur de test devrait être connecté.");
  }

  return player.socketId;
}

const TEST_PROMPTS: DrawingPrompt[] = Array.from(
  { length: PLAYER_COUNT * 2 },
  (_value, index) => ({
    id: `rematch-prompt-${index + 1}`,
    statement: `Représente le sujet ${index + 1} du niveau 10 au niveau 1.`,
    lowLabel: `Niveau bas ${index + 1}`,
    highLabel: `Niveau haut ${index + 1}`,
    category: "rematch-test",
  }),
);

interface RematchHarness {
  roomManager: RoomManager;
  gameManager: GameManager;
  roomCode: string;
  socketIds: string[];
  playerIds: string[];
  firstStart: StartGameInternalResult | null;
  gameIds: string[];
  turnIds: string[];
  secrets: number[];
  shuffledOrders: string[][];
  runNextIntroTransition: () => void;
  scheduledTransitionCount: () => number;
}

interface HarnessOptions {
  startImmediately?: boolean;
}

const gameManagers: GameManager[] = [];

function createDrawing(): DrawingDocument {
  return {
    version: DRAWING_DOCUMENT_VERSION,
    aspectRatio: DRAWING_ASPECT_RATIO,
    backgroundColor: DRAWING_BACKGROUND_COLOR,
    strokes: [
      {
        tool: "pen",
        color: DRAWING_COLOR_PALETTE[1],
        width: DRAWING_ALLOWED_STROKE_WIDTHS[1],
        points: [
          { x: 0.2, y: 0.3 },
          { x: 0.8, y: 0.7 },
        ],
      },
    ],
  };
}

function createHarness(
  options: HarnessOptions = {},
): RematchHarness {
  let nextPlayerId = 1;
  let joinedAt = 1_000;
  const roomManager = new RoomManager({
    codeGenerator: () => ROOM_CODE,
    idGenerator: () => `player-${nextPlayerId++}`,
    clock: () => joinedAt++,
  });
  const socketIds = Array.from(
    { length: PLAYER_COUNT },
    (_value, index) => `socket-${index + 1}`,
  );
  const host = roomManager.createRoom(
    socketIds[0]!,
    "J1",
    TEST_CLIENT_INSTANCE_ID,
  );
  const playerIds = [host.session.playerId];

  for (let index = 1; index < PLAYER_COUNT; index += 1) {
    playerIds.push(
      roomManager.joinRoom(
        socketIds[index]!,
        `J${index + 1}`,
        host.session.roomCode,
        TEST_CLIENT_INSTANCE_ID,
      ).session.playerId,
    );
  }
  for (const socketId of socketIds) {
    roomManager.setPlayerReady(socketId, true);
  }

  let now = 10_000;
  let nextGameId = 1;
  let nextTurnId = 1;
  let nextSecret = 1;
  let nextTimerId = 1;
  let shuffleCallCount = 0;
  const gameIds: string[] = [];
  const turnIds: string[] = [];
  const secrets: number[] = [];
  const shuffledOrders: string[][] = [];
  const scheduledTransitions = new Map<number, () => void>();

  const gameManager = new GameManager(roomManager, {
    clock: () => now++,
    generateGameId: () => {
      const gameId = `game-${nextGameId++}`;
      gameIds.push(gameId);
      return gameId;
    },
    generateTurnId: () => {
      const turnId = `turn-${nextTurnId++}`;
      turnIds.push(turnId);
      return turnId;
    },
    generateSecretLevel: () => {
      const secret = nextSecret;
      nextSecret = nextSecret === 10 ? 1 : nextSecret + 1;
      secrets.push(secret);
      return secret;
    },
    prompts: TEST_PROMPTS,
    selectPrompt: (availablePrompts) => availablePrompts[0]!,
    shufflePlayerIds: (ids) => {
      const order =
        shuffleCallCount++ === 0
          ? [...ids]
          : [...ids.slice(1), ids[0]!];
      shuffledOrders.push(order);
      return order;
    },
    introDurationMs: 25,
    scheduleTimer: (callback) => {
      const timerId = nextTimerId++;
      scheduledTransitions.set(timerId, callback);
      return timerId;
    },
    clearTimer: (timerId) => {
      scheduledTransitions.delete(timerId as number);
    },
  });
  gameManagers.push(gameManager);

  const firstStart =
    options.startImmediately === false
      ? null
      : gameManager.startGame(socketIds[0]!);

  return {
    roomManager,
    gameManager,
    roomCode: host.session.roomCode,
    socketIds,
    playerIds,
    firstStart,
    gameIds,
    turnIds,
    secrets,
    shuffledOrders,
    runNextIntroTransition: () => {
      const nextTransition = scheduledTransitions.entries().next().value as
        | [number, () => void]
        | undefined;
      if (nextTransition === undefined) {
        throw new Error("La transition ROUND_INTRO → DRAWING est absente.");
      }
      scheduledTransitions.delete(nextTransition[0]);
      nextTransition[1]();
    },
    scheduledTransitionCount: () => scheduledTransitions.size,
  };
}

function getInternalGame(harness: RematchHarness): InternalGame {
  const game = harness.roomManager.getRoomByCode(harness.roomCode)?.game;
  if (game === null || game === undefined) {
    throw new Error("Une partie interne était attendue.");
  }
  return game;
}

function expectRoomError(
  action: () => unknown,
  expectedCode: RoomManagerError["code"],
): RoomManagerError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(RoomManagerError);
    const roomError = error as RoomManagerError;
    expect(roomError.code).toBe(expectedCode);
    expect(roomError.message.length).toBeGreaterThan(0);
    return roomError;
  }

  throw new Error(`L’action aurait dû échouer avec ${expectedCode}.`);
}

function finishGame(harness: RematchHarness): PublicFinishedState {
  while (getInternalGame(harness).phase !== "FINISHED") {
    const introGame = getInternalGame(harness);
    expect(introGame.phase).toBe("ROUND_INTRO");
    harness.runNextIntroTransition();

    const drawingGame = getInternalGame(harness);
    expect(drawingGame.phase).toBe("DRAWING");
    const room = harness.roomManager.getRoomByCode(harness.roomCode);
    const drawer = room?.players.find(
      (player) => player.id === drawingGame.currentTurn.drawerPlayerId,
    );
    if (room === undefined || drawer === undefined) {
      throw new Error("Le salon et son dessinateur devraient exister.");
    }

    harness.gameManager.submitDrawing(requireSocketId(drawer), {
      drawing: createDrawing(),
    });
    for (const voter of room.players.filter(
      (player) => player.id !== drawer.id,
    )) {
      harness.gameManager.submitGuess(requireSocketId(voter), {
        turnId: drawingGame.currentTurn.turnId,
        value: drawingGame.currentTurn.secretLevel,
      });
    }

    expect(getInternalGame(harness).phase).toBe("REVEAL");
    harness.gameManager.continueGame(harness.socketIds[0]!);
  }

  const finished =
    harness.roomManager.getPublicRoomState(harness.roomCode).game?.finished;
  if (finished === null || finished === undefined) {
    throw new Error("Le classement final devrait être public.");
  }
  return structuredClone(finished);
}

afterEach(() => {
  for (const gameManager of gameManagers.splice(0)) {
    gameManager.dispose();
  }
});

describe("GameManager rematch", () => {
  it("ramène autoritairement le même groupe au lobby et remet scores et statuts prêts à zéro", () => {
    const harness = createHarness();
    const historicalFinished = finishGame(harness);
    const roomBefore =
      harness.roomManager.getPublicRoomState(harness.roomCode);
    const playerIdsBefore = roomBefore.players.map((player) => player.id);
    const hostIdBefore = roomBefore.players.find((player) => player.isHost)?.id;
    const joinedAtBefore = harness.roomManager
      .getRoomByCode(harness.roomCode)
      ?.players.map((player) => player.joinedAt);

    expect(roomBefore.players.every((player) => player.score > 0)).toBe(true);
    expect(historicalFinished.leaderboard).toHaveLength(PLAYER_COUNT);

    const result = harness.gameManager.requestRematch(
      harness.socketIds[0]!,
    );
    const internalRoom = harness.roomManager.getRoomByCode(harness.roomCode);

    expect(result.room.code).toBe(harness.roomCode);
    expect(result.room.game).toBeNull();
    expect(result.room.players.map((player) => player.id)).toEqual(
      playerIdsBefore,
    );
    expect(result.room.players.find((player) => player.isHost)?.id).toBe(
      hostIdBefore,
    );
    expect(result.room.players.every((player) => player.score === 0)).toBe(
      true,
    );
    expect(result.room.players.every((player) => !player.isReady)).toBe(true);
    expect(result.room.allPlayersReady).toBe(false);
    expect(result.room.canStart).toBe(false);
    expect(internalRoom?.game).toBeNull();
    expect(internalRoom?.players.map((player) => player.id)).toEqual(
      playerIdsBefore,
    );
    expect(internalRoom?.players.map((player) => player.joinedAt)).toEqual(
      joinedAtBefore,
    );
    expect(harness.scheduledTransitionCount()).toBe(0);
  });

  it("refuse les sockets extérieurs, l'absence de partie, les phases actives et les non-hôtes", () => {
    const harness = createHarness({ startImmediately: false });

    expectRoomError(
      () => harness.gameManager.requestRematch("socket-outsider"),
      "NOT_IN_ROOM",
    );
    expectRoomError(
      () => harness.gameManager.requestRematch(harness.socketIds[0]!),
      "GAME_NOT_STARTED",
    );

    harness.gameManager.startGame(harness.socketIds[0]!);
    expectRoomError(
      () => harness.gameManager.requestRematch(harness.socketIds[0]!),
      "GAME_NOT_FINISHED",
    );
    expectRoomError(
      () => harness.gameManager.requestRematch(harness.socketIds[1]!),
      "NOT_HOST",
    );

    finishGame(harness);
    expectRoomError(
      () => harness.gameManager.requestRematch(harness.socketIds[1]!),
      "NOT_HOST",
    );
    expect(getInternalGame(harness).phase).toBe("FINISHED");
  });

  it("n'accepte qu'une seule demande de revanche", () => {
    const harness = createHarness();
    finishGame(harness);

    const first = harness.gameManager.requestRematch(
      harness.socketIds[0]!,
    );
    const snapshot = structuredClone(first.room);

    expectRoomError(
      () => harness.gameManager.requestRematch(harness.socketIds[0]!),
      "GAME_NOT_STARTED",
    );
    expect(
      harness.roomManager.getPublicRoomState(harness.roomCode),
    ).toEqual(snapshot);
  });

  it("crée une partie, un tour, un secret et un ordre distincts après la revanche tout en réouvrant les consignes", () => {
    const harness = createHarness();
    if (harness.firstStart === null) {
      throw new Error("Le premier lancement devrait être disponible.");
    }
    const firstGameId = harness.firstStart.room.game?.gameId;
    const firstTurnId = harness.firstStart.room.game?.turnId;
    const firstSecret = harness.firstStart.secret.secretLevel;
    const firstOrder = [...getInternalGame(harness).turnOrder];

    finishGame(harness);
    expect(getInternalGame(harness).usedPromptIds).toEqual(
      TEST_PROMPTS.map((prompt) => prompt.id),
    );
    harness.gameManager.requestRematch(harness.socketIds[0]!);
    for (const socketId of harness.socketIds) {
      harness.roomManager.setPlayerReady(socketId, true);
    }

    const secondStart = harness.gameManager.startGame(
      harness.socketIds[0]!,
    );
    const secondGame = getInternalGame(harness);

    expect(firstGameId).toBe("game-1");
    expect(secondStart.room.game?.gameId).toBe("game-2");
    expect(secondStart.room.game?.gameId).not.toBe(firstGameId);
    expect(secondStart.room.game?.turnId).not.toBe(firstTurnId);
    expect(secondStart.secret).toMatchObject({
      roomCode: harness.roomCode,
      gameId: "game-2",
      turnId: secondStart.room.game?.turnId,
    });
    expect(secondStart.secret.secretLevel).not.toBe(firstSecret);
    expect(secondGame.turnOrder).not.toEqual(firstOrder);
    expect(harness.shuffledOrders).toEqual([
      firstOrder,
      secondGame.turnOrder,
    ]);
    expect(secondGame.usedPromptIds).toEqual([TEST_PROMPTS[0]!.id]);
    expect(secondGame.currentTurn.prompt.id).toBe(TEST_PROMPTS[0]!.id);
    expect(secondGame.usedTurnIds).toEqual([
      secondGame.currentTurn.turnId,
    ]);
    expect(secondStart.room.game?.reveal).toBeNull();
    expect(secondStart.room.game?.finished).toBeNull();
    expect(secondStart.room.players.every((player) => player.score === 0)).toBe(
      true,
    );
    expect(harness.gameIds).toEqual(["game-1", "game-2"]);
  });
});

describe("createGameId", () => {
  it.each(["", "   ", " game-with-spaces "])(
    "refuse l'identifiant injecté invalide %j",
    (invalidGameId) => {
      expectRoomError(
        () => createGameId(() => invalidGameId),
        "INTERNAL_ERROR",
      );
    },
  );

  it("convertit une exception du générateur injecté en erreur métier stable", () => {
    expectRoomError(
      () =>
        createGameId(() => {
          throw new Error("Échec simulé du générateur.");
        }),
      "INTERNAL_ERROR",
    );
  });
});

describe("finished departures and rematch", () => {
  it("conserve FINISHED, les scores et la photographie historique lorsqu'un non-hôte part", () => {
    const harness = createHarness();
    const historicalFinished = finishGame(harness);
    const roomBefore =
      harness.roomManager.getPublicRoomState(harness.roomCode);
    const departingPlayer = roomBefore.players[1]!;
    const remainingScores = roomBefore.players
      .filter((player) => player.id !== departingPlayer.id)
      .map(({ id, score }) => ({ id, score }));

    expect(harness.gameManager.cancelGame(harness.roomCode)).toBe(false);
    const departure = harness.roomManager.leaveRoom(harness.socketIds[1]!);

    expect(departure.roomDeleted).toBe(false);
    expect(departure.playerId).toBe(departingPlayer.id);
    expect(departure.room?.game?.phase).toBe("FINISHED");
    expect(departure.room?.game?.finished).toEqual(historicalFinished);
    expect(
      departure.room?.players.map(({ id, score }) => ({ id, score })),
    ).toEqual(remainingScores);
    expect(
      departure.room?.game?.finished?.leaderboard.some(
        (entry) => entry.player.id === departingPlayer.id,
      ),
    ).toBe(true);
  });

  it("conserve le dessinateur final public depuis la photographie lorsque ce joueur quitte FINISHED", () => {
    const harness = createHarness();
    const historicalFinished = finishGame(harness);
    const roomBefore =
      harness.roomManager.getPublicRoomState(harness.roomCode);
    const finalDrawer = roomBefore.game?.currentDrawer;

    expect(finalDrawer?.id).toBe(harness.playerIds[2]);
    expect(harness.gameManager.cancelGame(harness.roomCode)).toBe(false);
    const departure = harness.roomManager.leaveRoom(harness.socketIds[2]!);

    expect(departure.room?.game?.phase).toBe("FINISHED");
    expect(departure.room?.game?.currentDrawer).toEqual(finalDrawer);
    expect(departure.room?.game?.finished).toEqual(historicalFinished);
    expect(
      departure.room?.game?.finished?.leaderboard.some(
        (entry) => entry.player.id === finalDrawer?.id,
      ),
    ).toBe(true);
  });

  it("transfère l'hôte pendant FINISHED et autorise le nouvel hôte à demander la revanche", () => {
    const harness = createHarness();
    const historicalFinished = finishGame(harness);
    const expectedNewHostId = harness.playerIds[1]!;

    expect(harness.gameManager.cancelGame(harness.roomCode)).toBe(false);
    const departure = harness.roomManager.leaveRoom(harness.socketIds[0]!);

    expect(departure.room?.game?.phase).toBe("FINISHED");
    expect(departure.room?.game?.finished).toEqual(historicalFinished);
    expect(
      departure.room?.players.filter((player) => player.isHost),
    ).toEqual([
      expect.objectContaining({
        id: expectedNewHostId,
      }),
    ]);

    const rematch = harness.gameManager.requestRematch(
      harness.socketIds[1]!,
    );
    expect(rematch.room.game).toBeNull();
    expect(rematch.room.players.find((player) => player.isHost)?.id).toBe(
      expectedNewHostId,
    );
  });

  it("supprime le salon quand le dernier joueur part après FINISHED", () => {
    const harness = createHarness();
    finishGame(harness);

    expect(harness.gameManager.cancelGame(harness.roomCode)).toBe(false);
    harness.roomManager.leaveRoom(harness.socketIds[1]!);
    expect(harness.gameManager.cancelGame(harness.roomCode)).toBe(false);
    harness.roomManager.leaveRoom(harness.socketIds[0]!);
    expect(harness.gameManager.cancelGame(harness.roomCode)).toBe(false);
    const lastDeparture = harness.roomManager.leaveRoom(
      harness.socketIds[2]!,
    );

    expect(lastDeparture.roomDeleted).toBe(true);
    expect(lastDeparture.room).toBeNull();
    expect(harness.roomManager.getRoomByCode(harness.roomCode)).toBeUndefined();
    expect(harness.scheduledTransitionCount()).toBe(0);
  });

  it("conserve l'annulation et le reset historiques lors d'un départ en phase active", () => {
    const harness = createHarness();
    const room = harness.roomManager.getRoomByCode(harness.roomCode);
    if (room === undefined) {
      throw new Error("Le salon interne devrait exister.");
    }
    room.players.forEach((player, index) => {
      player.score = index + 4;
      player.isReady = true;
    });

    expect(getInternalGame(harness).phase).toBe("ROUND_INTRO");
    expect(harness.scheduledTransitionCount()).toBe(1);
    expect(harness.gameManager.cancelGame(harness.roomCode)).toBe(true);
    const departure = harness.roomManager.leaveRoom(harness.socketIds[2]!);

    expect(departure.room?.game).toBeNull();
    expect(departure.room?.players.every((player) => player.score === 0)).toBe(
      true,
    );
    expect(departure.room?.players.every((player) => !player.isReady)).toBe(
      true,
    );
    expect(harness.scheduledTransitionCount()).toBe(0);
  });
});
