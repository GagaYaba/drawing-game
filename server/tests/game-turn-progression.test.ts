import {
  DRAWING_ALLOWED_STROKE_WIDTHS,
  DRAWING_ASPECT_RATIO,
  DRAWING_BACKGROUND_COLOR,
  DRAWING_COLOR_PALETTE,
  DRAWING_DOCUMENT_VERSION,
  type DrawingDocument,
  type GuessValue,
} from "@drawing-game/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  GameManager,
  getNextTurnPosition,
  hasNextTurn,
} from "../src/game/game-manager.js";
import type {
  DrawingPrompt,
  InternalGame,
} from "../src/game/game-types.js";
import {
  RoomManager,
  RoomManagerError,
} from "../src/rooms/room-manager.js";

const ROOM_CODE = "7KXMP";
const INTRO_DURATION_MS = 3_000;

function requireSocketId(player: { socketId: string | null }): string {
  if (player.socketId === null) {
    throw new Error("Le joueur de test devrait être connecté.");
  }

  return player.socketId;
}

interface PreparedRoom {
  roomManager: RoomManager;
  roomCode: string;
  socketIds: string[];
  playerIds: string[];
}

interface ProgressionHarness extends PreparedRoom {
  gameManager: GameManager;
  transitionQueue: Array<() => void>;
  promptCandidateSets: string[][];
  generatedTurnIds: string[];
  generatedSecrets: GuessValue[];
  scheduleCallCount: () => number;
  advanceClock: () => void;
}

interface HarnessOptions {
  prompts?: readonly DrawingPrompt[];
  turnIdSequence?: readonly string[];
  failScheduleAtCall?: number;
  initialScores?: readonly number[];
}

const createdGameManagers: GameManager[] = [];

function createPrompts(count: number): DrawingPrompt[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `prompt-${index + 1}`,
    statement: `Représente le sujet ${index + 1} du niveau 10 au niveau 1.`,
    lowLabel: "Niveau 1",
    highLabel: "Niveau 10",
    category: "test",
  }));
}

function prepareRoom(playerCount: number): PreparedRoom {
  let nextPlayerId = 1;
  let joinedAt = 1_000;
  const roomManager = new RoomManager({
    codeGenerator: () => ROOM_CODE,
    idGenerator: () => `player-${nextPlayerId++}`,
    clock: () => joinedAt++,
  });
  const socketIds = Array.from(
    { length: playerCount },
    (_, index) => `socket-${index + 1}`,
  );
  const host = roomManager.createRoom(socketIds[0]!, "J1");
  const playerIds = [host.session.playerId];

  for (let index = 1; index < playerCount; index += 1) {
    const joined = roomManager.joinRoom(
      socketIds[index]!,
      `J${index + 1}`,
      host.session.roomCode,
    );
    playerIds.push(joined.session.playerId);
  }

  return {
    roomManager,
    roomCode: host.session.roomCode,
    socketIds,
    playerIds,
  };
}

function createHarness(
  playerCount: number,
  options: HarnessOptions = {},
): ProgressionHarness {
  const prepared = prepareRoom(playerCount);
  const room = prepared.roomManager.getRoomByCode(prepared.roomCode);
  if (room === undefined) {
    throw new Error("Le salon interne de test est introuvable.");
  }

  options.initialScores?.forEach((score, index) => {
    const player = room.players[index];
    if (player !== undefined) {
      player.score = score;
    }
  });

  for (const socketId of prepared.socketIds) {
    prepared.roomManager.setPlayerReady(socketId, true);
  }

  const prompts = options.prompts ?? createPrompts(playerCount * 2);
  const transitionQueue: Array<() => void> = [];
  const promptCandidateSets: string[][] = [];
  const generatedTurnIds: string[] = [];
  const generatedSecrets: GuessValue[] = [];
  let now = 10_000;
  let nextTurnId = 1;
  let nextSecret = 1;
  let scheduleCalls = 0;
  let turnIdSequenceIndex = 0;

  const gameManager = new GameManager(prepared.roomManager, {
    clock: () => now,
    generateGameId: () => "game-1",
    introDurationMs: INTRO_DURATION_MS,
    prompts,
    shufflePlayerIds: (playerIds) => [...playerIds],
    selectPrompt: (availablePrompts) => {
      promptCandidateSets.push(
        availablePrompts.map((prompt) => prompt.id),
      );
      const selected = availablePrompts[0];
      if (selected === undefined) {
        throw new Error("Une consigne disponible était attendue.");
      }
      return selected;
    },
    generateTurnId: () => {
      const turnId =
        options.turnIdSequence?.[turnIdSequenceIndex++] ??
        `turn-${nextTurnId++}`;
      generatedTurnIds.push(turnId);
      return turnId;
    },
    generateSecretLevel: () => {
      const secret = nextSecret as GuessValue;
      nextSecret = nextSecret === 10 ? 1 : nextSecret + 1;
      generatedSecrets.push(secret);
      return secret;
    },
    scheduleTimer: (callback) => {
      scheduleCalls += 1;
      if (scheduleCalls === options.failScheduleAtCall) {
        throw new Error("Échec simulé du planificateur.");
      }
      transitionQueue.push(callback);
      return Symbol(`transition-${scheduleCalls}`);
    },
    clearTimer: () => undefined,
  });
  createdGameManagers.push(gameManager);
  gameManager.startGame(prepared.socketIds[0]!);

  return {
    ...prepared,
    gameManager,
    transitionQueue,
    promptCandidateSets,
    generatedTurnIds,
    generatedSecrets,
    scheduleCallCount: () => scheduleCalls,
    advanceClock: () => {
      now += 100;
    },
  };
}

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

function getInternalGame(harness: ProgressionHarness): InternalGame {
  const game = harness.roomManager.getRoomByCode(harness.roomCode)?.game;
  if (game === null || game === undefined) {
    throw new Error("Une partie interne était attendue.");
  }
  return game;
}

function enterDrawing(harness: ProgressionHarness): void {
  const transition = harness.transitionQueue.shift();
  if (transition === undefined) {
    throw new Error("La transition ROUND_INTRO → DRAWING est absente.");
  }
  harness.advanceClock();
  transition();
}

function completeCurrentTurn(harness: ProgressionHarness): InternalGame {
  enterDrawing(harness);
  const drawingGame = getInternalGame(harness);
  expect(drawingGame.phase).toBe("DRAWING");

  const drawer = harness.roomManager
    .getRoomByCode(harness.roomCode)
    ?.players.find(
      (player) => player.id === drawingGame.currentTurn.drawerPlayerId,
    );
  if (drawer === undefined) {
    throw new Error("Le dessinateur interne est introuvable.");
  }

  harness.advanceClock();
  harness.gameManager.submitDrawing(requireSocketId(drawer), {
    drawing: createDrawing(),
  });

  const votingGame = getInternalGame(harness);
  expect(votingGame.phase).toBe("VOTING");
  const voters = harness.roomManager
    .getRoomByCode(harness.roomCode)
    ?.players.filter((player) => player.id !== drawer.id);
  if (voters === undefined) {
    throw new Error("Les votants internes sont introuvables.");
  }

  for (const voter of voters) {
    harness.advanceClock();
    harness.gameManager.submitGuess(requireSocketId(voter), {
      turnId: votingGame.currentTurn.turnId,
      value: votingGame.currentTurn.secretLevel,
    });
  }

  const revealGame = getInternalGame(harness);
  expect(revealGame.phase).toBe("REVEAL");
  expect(revealGame.currentTurn.scoresAppliedAt).not.toBeNull();
  expect(revealGame.currentTurn.scoreResult).not.toBeNull();
  return revealGame;
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
    return roomError;
  }

  throw new Error(`L’action aurait dû échouer avec ${expectedCode}.`);
}

function collectRotation(playerCount: number): {
  drawerIds: string[];
  rounds: number[];
  turnNumbers: number[];
} {
  const turnOrder = Array.from(
    { length: playerCount },
    (_, index) => `player-${index + 1}`,
  );
  let position = {
    currentRound: 1,
    currentDrawerIndex: 0,
    totalRounds: 2,
    turnOrder,
  };
  const drawerIds: string[] = [];
  const rounds: number[] = [];
  const turnNumbers: number[] = [];

  while (true) {
    const drawerId = turnOrder[position.currentDrawerIndex];
    if (drawerId === undefined) {
      throw new Error("La rotation de test pointe hors de l’ordre.");
    }
    drawerIds.push(drawerId);
    rounds.push(position.currentRound);
    turnNumbers.push(
      (position.currentRound - 1) * playerCount +
        position.currentDrawerIndex +
        1,
    );

    const next = getNextTurnPosition(position);
    if (next === null) {
      break;
    }
    position = {
      ...position,
      currentRound: next.currentRound,
      currentDrawerIndex: next.currentDrawerIndex,
    };
  }

  return { drawerIds, rounds, turnNumbers };
}

afterEach(() => {
  for (const gameManager of createdGameManagers.splice(0)) {
    gameManager.dispose();
  }
});

describe("fixed two-round rotation", () => {
  it.each([3, 4, 8])(
    "fait dessiner %i joueurs exactement une fois par manche",
    (playerCount) => {
      const playerIds = Array.from(
        { length: playerCount },
        (_, index) => `player-${index + 1}`,
      );
      const rotation = collectRotation(playerCount);

      expect(rotation.drawerIds).toEqual([...playerIds, ...playerIds]);
      expect(rotation.rounds).toEqual([
        ...Array<number>(playerCount).fill(1),
        ...Array<number>(playerCount).fill(2),
      ]);
      expect(rotation.turnNumbers).toEqual(
        Array.from(
          { length: playerCount * 2 },
          (_, index) => index + 1,
        ),
      );

      const finalPosition = {
        currentRound: 2,
        currentDrawerIndex: playerCount - 1,
        totalRounds: 2,
        turnOrder: playerIds,
      };
      expect(getNextTurnPosition(finalPosition)).toBeNull();
      expect(hasNextTurn(finalPosition)).toBe(false);
    },
  );
});

describe("GameManager turn progression", () => {
  it("joue une partie complète à 3 joueurs, conserve les scores et publie FINISHED", () => {
    const harness = createHarness(3, {
      initialScores: [20, 30, 40],
    });
    const observedDrawers: string[] = [];
    const observedPromptIds: string[] = [];
    const observedTurnIds: string[] = [];

    expect(
      harness.roomManager
        .getRoomByCode(harness.roomCode)
        ?.players.map((player) => player.score),
    ).toEqual([0, 0, 0]);

    for (let turnIndex = 0; turnIndex < 6; turnIndex += 1) {
      const introGame = getInternalGame(harness);
      observedDrawers.push(introGame.currentTurn.drawerPlayerId);
      observedPromptIds.push(introGame.currentTurn.prompt.id);
      observedTurnIds.push(introGame.currentTurn.turnId);

      expect(introGame.phase).toBe("ROUND_INTRO");
      expect(introGame.currentTurn.drawing).toBeNull();
      expect(introGame.currentTurn.drawingSubmittedAt).toBeNull();
      expect(introGame.currentTurn.guesses).toEqual({});
      expect(introGame.currentTurn.scoresAppliedAt).toBeNull();
      expect(introGame.currentTurn.scoreResult).toBeNull();

      const revealGame = completeCurrentTurn(harness);
      const scoresAfterReveal = harness.roomManager
        .getRoomByCode(harness.roomCode)
        ?.players.map((player) => player.score);
      if (scoresAfterReveal === undefined) {
        throw new Error("Les scores cumulés sont introuvables.");
      }

      const result = harness.gameManager.continueGame(
        harness.socketIds[0]!,
      );

      if (turnIndex < 5) {
        const nextGame = getInternalGame(harness);
        expect(result.nextTurn).toEqual({
          drawerSocketId: harness.roomManager
            .getRoomByCode(harness.roomCode)
            ?.players.find(
              (player) =>
                player.id === nextGame.currentTurn.drawerPlayerId,
            )?.socketId,
          secret: {
            roomCode: harness.roomCode,
            gameId: nextGame.gameId,
            turnId: nextGame.currentTurn.turnId,
            drawerPlayerId: nextGame.currentTurn.drawerPlayerId,
            secretLevel: nextGame.currentTurn.secretLevel,
          },
        });
        expect(nextGame.phase).toBe("ROUND_INTRO");
        expect(
          harness.roomManager
            .getRoomByCode(harness.roomCode)
            ?.players.map((player) => player.score),
        ).toEqual(scoresAfterReveal);
        expect(JSON.stringify(result.room)).not.toContain(
          '"secretLevel"',
        );
      } else {
        expect(result.nextTurn).toBeUndefined();
        expect(revealGame.currentRound).toBe(2);
        expect(revealGame.currentDrawerIndex).toBe(2);
      }
    }

    const finalGame = getInternalGame(harness);
    const publicGame =
      harness.roomManager.getPublicRoomState(harness.roomCode).game;

    expect(observedDrawers).toEqual([
      ...harness.playerIds,
      ...harness.playerIds,
    ]);
    expect(new Set(observedPromptIds).size).toBe(6);
    expect(new Set(observedTurnIds).size).toBe(6);
    expect(finalGame.phase).toBe("FINISHED");
    expect(finalGame.usedPromptIds).toEqual(observedPromptIds);
    expect(finalGame.usedTurnIds).toEqual(observedTurnIds);
    expect(publicGame).toMatchObject({
      phase: "FINISHED",
      currentRound: 2,
      currentTurnNumber: 6,
      totalTurns: 6,
      reveal: null,
      finished: {
        completedRounds: 2,
        completedTurns: 6,
        winners: harness.playerIds.map((id, index) => ({
          id,
          nickname: `J${index + 1}`,
          score: 24,
        })),
      },
    });
    expect(publicGame?.finished?.leaderboard.map((entry) => entry.score)).toEqual(
      [24, 24, 24],
    );
    expectRoomError(
      () => harness.gameManager.continueGame(harness.socketIds[0]!),
      "GAME_ALREADY_FINISHED",
    );
  });

  it("utilise 16 consignes et 16 turnId uniques pour 8 joueurs", () => {
    const prompts = createPrompts(16);
    const harness = createHarness(8, { prompts });
    const observedDrawers: string[] = [];
    const observedPromptIds: string[] = [];
    const observedTurnIds: string[] = [];

    for (let turnIndex = 0; turnIndex < 16; turnIndex += 1) {
      const introGame = getInternalGame(harness);
      observedDrawers.push(introGame.currentTurn.drawerPlayerId);
      observedPromptIds.push(introGame.currentTurn.prompt.id);
      observedTurnIds.push(introGame.currentTurn.turnId);
      completeCurrentTurn(harness);

      const result = harness.gameManager.continueGame(
        harness.socketIds[0]!,
      );
      expect(result.nextTurn === undefined).toBe(turnIndex === 15);
    }

    expect(observedDrawers).toEqual([
      ...harness.playerIds,
      ...harness.playerIds,
    ]);
    expect(observedPromptIds).toEqual(prompts.map((prompt) => prompt.id));
    expect(new Set(observedPromptIds).size).toBe(16);
    expect(new Set(observedTurnIds).size).toBe(16);
    expect(harness.generatedSecrets).toHaveLength(16);
    expect(harness.promptCandidateSets).toHaveLength(16);

    harness.promptCandidateSets.forEach((candidateIds, index) => {
      expect(candidateIds).toHaveLength(16 - index);
      for (const previouslySelectedId of observedPromptIds.slice(0, index)) {
        expect(candidateIds).not.toContain(previouslySelectedId);
      }
    });
    expect(getInternalGame(harness).phase).toBe("FINISHED");
  });

  it("refuse un turnId déjà utilisé plus tôt et conserve la révélation intacte", () => {
    const harness = createHarness(3, {
      turnIdSequence: ["turn-1", "turn-2", "turn-1"],
    });

    completeCurrentTurn(harness);
    harness.gameManager.continueGame(harness.socketIds[0]!);
    completeCurrentTurn(harness);

    const snapshot = structuredClone(getInternalGame(harness));
    const scoreSnapshot = harness.roomManager
      .getRoomByCode(harness.roomCode)
      ?.players.map((player) => player.score);

    expectRoomError(
      () => harness.gameManager.continueGame(harness.socketIds[0]!),
      "INTERNAL_ERROR",
    );

    expect(getInternalGame(harness)).toEqual(snapshot);
    expect(getInternalGame(harness).usedTurnIds).toEqual([
      "turn-1",
      "turn-2",
    ]);
    expect(
      harness.roomManager
        .getRoomByCode(harness.roomCode)
        ?.players.map((player) => player.score),
    ).toEqual(scoreSnapshot);
  });

  it("échoue proprement si les consignes sont épuisées sans altérer le tour révélé", () => {
    const harness = createHarness(3, { prompts: createPrompts(1) });
    completeCurrentTurn(harness);
    const snapshot = structuredClone(getInternalGame(harness));

    expectRoomError(
      () => harness.gameManager.continueGame(harness.socketIds[0]!),
      "INTERNAL_ERROR",
    );

    expect(getInternalGame(harness)).toEqual(snapshot);
    expect(harness.generatedTurnIds).toEqual(["turn-1"]);
    expect(harness.generatedSecrets).toEqual([1]);
  });

  it("restaure intégralement REVEAL si la programmation du tour suivant échoue", () => {
    const harness = createHarness(3, { failScheduleAtCall: 2 });
    completeCurrentTurn(harness);
    const snapshot = structuredClone(getInternalGame(harness));
    const scoreSnapshot = harness.roomManager
      .getRoomByCode(harness.roomCode)
      ?.players.map((player) => player.score);

    expectRoomError(
      () => harness.gameManager.continueGame(harness.socketIds[0]!),
      "INTERNAL_ERROR",
    );

    expect(harness.scheduleCallCount()).toBe(2);
    expect(getInternalGame(harness)).toEqual(snapshot);
    expect(
      harness.roomManager
        .getRoomByCode(harness.roomCode)
        ?.players.map((player) => player.score),
    ).toEqual(scoreSnapshot);
  });

  it("annule atomiquement les scores si la projection du dernier vote échoue", () => {
    const harness = createHarness(3);
    enterDrawing(harness);
    const drawingGame = getInternalGame(harness);
    const room = harness.roomManager.getRoomByCode(harness.roomCode);
    const drawer = room?.players.find(
      (player) => player.id === drawingGame.currentTurn.drawerPlayerId,
    );
    const voters = room?.players.filter(
      (player) => player.id !== drawingGame.currentTurn.drawerPlayerId,
    );
    if (drawer === undefined || voters === undefined || voters.length !== 2) {
      throw new Error("Le dessinateur et deux votants sont requis.");
    }

    harness.advanceClock();
    harness.gameManager.submitDrawing(requireSocketId(drawer), {
      drawing: createDrawing(),
    });
    harness.advanceClock();
    harness.gameManager.submitGuess(requireSocketId(voters[0]!), {
      turnId: drawingGame.currentTurn.turnId,
      value: 1,
    });

    const votingGame = getInternalGame(harness);
    votingGame.currentTurn.drawing = null;
    const scoreSnapshot = room?.players.map((player) => player.score);

    harness.advanceClock();
    expectRoomError(
      () =>
        harness.gameManager.submitGuess(requireSocketId(voters[1]!), {
          turnId: votingGame.currentTurn.turnId,
          value: 1,
        }),
      "INTERNAL_ERROR",
    );

    expect(votingGame.phase).toBe("VOTING");
    expect(votingGame.currentTurn.guesses[voters[0]!.id]).toBeDefined();
    expect(votingGame.currentTurn.guesses[voters[1]!.id]).toBeUndefined();
    expect(votingGame.currentTurn.scoresAppliedAt).toBeNull();
    expect(votingGame.currentTurn.scoreResult).toBeNull();
    expect(room?.players.map((player) => player.score)).toEqual(
      scoreSnapshot,
    );
  });

  it("réinitialise scores et statuts de préparation lors de l’annulation", () => {
    const harness = createHarness(3);
    completeCurrentTurn(harness);
    expect(
      harness.roomManager
        .getRoomByCode(harness.roomCode)
        ?.players.some((player) => player.score > 0),
    ).toBe(true);

    expect(harness.gameManager.cancelGame(harness.roomCode)).toBe(true);

    const room = harness.roomManager.getRoomByCode(harness.roomCode);
    expect(room?.game).toBeNull();
    expect(room?.players.map((player) => player.score)).toEqual([0, 0, 0]);
    expect(room?.players.map((player) => player.isReady)).toEqual([
      false,
      false,
      false,
    ]);
    expect(harness.gameManager.cancelGame(harness.roomCode)).toBe(false);
  });
});

describe("GameManager continuation authorization", () => {
  it("restaure les scores résiduels si le lancement de partie échoue", () => {
    const prepared = prepareRoom(3);
    const room = prepared.roomManager.getRoomByCode(prepared.roomCode);
    if (room === undefined) {
      throw new Error("Le salon interne de test est introuvable.");
    }
    room.players.forEach((player, index) => {
      player.score = 10 + index;
      prepared.roomManager.setPlayerReady(requireSocketId(player), true);
    });

    const prompts = createPrompts(6);
    const gameManager = new GameManager(prepared.roomManager, {
      prompts,
      shufflePlayerIds: (playerIds) => [...playerIds],
      selectPrompt: (availablePrompts) => availablePrompts[0]!,
      generateTurnId: () => "turn-1",
      generateSecretLevel: () => 7,
      scheduleTimer: () => {
        throw new Error("Échec simulé du planificateur.");
      },
      clearTimer: () => undefined,
    });
    createdGameManagers.push(gameManager);

    expectRoomError(
      () => gameManager.startGame(prepared.socketIds[0]!),
      "INTERNAL_ERROR",
    );
    expect(room.game).toBeNull();
    expect(room.players.map((player) => player.score)).toEqual([
      10, 11, 12,
    ]);
  });

  it("refuse une connexion hors salon et un salon sans partie", () => {
    const prepared = prepareRoom(3);
    const gameManager = new GameManager(prepared.roomManager, {
      prompts: createPrompts(6),
      scheduleTimer: () => Symbol("unused"),
      clearTimer: () => undefined,
    });
    createdGameManagers.push(gameManager);

    expectRoomError(
      () => gameManager.continueGame("socket-inconnu"),
      "NOT_IN_ROOM",
    );
    expectRoomError(
      () => gameManager.continueGame(prepared.socketIds[0]!),
      "GAME_NOT_STARTED",
    );
  });

  it("réserve la continuation à l’hôte et à la phase REVEAL", () => {
    const harness = createHarness(3);

    expectRoomError(
      () => harness.gameManager.continueGame(harness.socketIds[1]!),
      "NOT_HOST",
    );
    expectRoomError(
      () => harness.gameManager.continueGame(harness.socketIds[0]!),
      "NOT_REVEAL_PHASE",
    );
  });
});
