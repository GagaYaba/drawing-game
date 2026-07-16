import {
  DRAWING_ALLOWED_STROKE_WIDTHS,
  DRAWING_ASPECT_RATIO,
  DRAWING_BACKGROUND_COLOR,
  DRAWING_COLOR_PALETTE,
  DRAWING_DOCUMENT_VERSION,
  type DrawingDocument,
  type GuessValue,
  type PublicGameState,
} from "@drawing-game/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GameManager } from "../src/game/game-manager.js";
import type {
  GameManagerOptions,
  InternalGame,
} from "../src/game/game-types.js";
import {
  RoomManager,
  RoomManagerError,
} from "../src/rooms/room-manager.js";

const ROOM_CODE = "7KXMP";
const STARTED_AT = 20_000;
const DRAWING_SUBMITTED_AT = 25_000;
const TEST_PROMPT = {
  id: "guess-test-prompt",
  statement:
    "Représente un robot du plus perfectionné (10) au moins perfectionné (1).",
  lowLabel: "Moins perfectionné",
  highLabel: "Plus perfectionné",
  category: "test",
} as const;

interface PreparedRoom {
  roomManager: RoomManager;
  roomCode: string;
  socketIds: string[];
  playerIds: string[];
}

interface VotingGameHarness extends PreparedRoom {
  gameManager: GameManager;
  setTime: (timestamp: number) => void;
}

const createdGameManagers: GameManager[] = [];

function createRoomManager(): RoomManager {
  let nextPlayerId = 1;
  let timestamp = 1_000;

  return new RoomManager({
    codeGenerator: () => ROOM_CODE,
    idGenerator: () => `player-${nextPlayerId++}`,
    clock: () => timestamp++,
  });
}

function prepareRoom(playerCount = 3): PreparedRoom {
  const roomManager = createRoomManager();
  const socketIds = Array.from(
    { length: playerCount },
    (_, index) => `socket-${index + 1}`,
  );
  const host = roomManager.createRoom(socketIds[0]!, "J1");
  const playerIds = [host.playerId];

  for (let index = 1; index < socketIds.length; index += 1) {
    const session = roomManager.joinRoom(
      socketIds[index]!,
      `J${index + 1}`,
      host.roomCode,
    );
    playerIds.push(session.playerId);
  }

  return {
    roomManager,
    roomCode: host.roomCode,
    socketIds,
    playerIds,
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
          { x: 0.1, y: 0.2 },
          { x: 0.8, y: 0.7 },
        ],
      },
    ],
  };
}

function createGameManager(
  roomManager: RoomManager,
  overrides: GameManagerOptions = {},
): GameManager {
  const gameManager = new GameManager(roomManager, {
    clock: () => STARTED_AT,
    prompts: [TEST_PROMPT],
    shufflePlayerIds: (playerIds) => [...playerIds],
    selectPrompt: () => TEST_PROMPT,
    generateSecretLevel: () => 7,
    scheduleTimer: () => Symbol("drawing-transition"),
    clearTimer: () => undefined,
    ...overrides,
  });
  createdGameManagers.push(gameManager);
  return gameManager;
}

function prepareVotingGame(
  playerCount = 3,
  secretLevel: GuessValue = 7,
): VotingGameHarness {
  const prepared = prepareRoom(playerCount);
  for (const socketId of prepared.socketIds) {
    prepared.roomManager.setPlayerReady(socketId, true);
  }

  let now = STARTED_AT;
  let enterDrawing: (() => void) | undefined;
  const gameManager = createGameManager(prepared.roomManager, {
    clock: () => now,
    generateSecretLevel: () => secretLevel,
    scheduleTimer: (callback) => {
      enterDrawing = callback;
      return Symbol("drawing-transition");
    },
  });

  gameManager.startGame(prepared.socketIds[0]!);
  if (enterDrawing === undefined) {
    throw new Error("La transition vers DRAWING aurait dû être planifiée.");
  }
  enterDrawing();
  now = DRAWING_SUBMITTED_AT;
  gameManager.submitDrawing(prepared.socketIds[0]!, {
    drawing: createDrawing(),
  });

  return {
    ...prepared,
    gameManager,
    setTime: (timestamp) => {
      now = timestamp;
    },
  };
}

function getInternalGame(harness: VotingGameHarness): InternalGame {
  const game = harness.roomManager.getRoomByCode(harness.roomCode)?.game;
  if (game === null || game === undefined) {
    throw new Error("Une partie interne était attendue.");
  }
  return game;
}

function getPublicGame(harness: VotingGameHarness): PublicGameState {
  const game = harness.roomManager.getPublicRoomState(harness.roomCode).game;
  if (game === null) {
    throw new Error("Une partie publique était attendue.");
  }
  return game;
}

function createGuessPayload(harness: VotingGameHarness, value: number) {
  return {
    turnId: getInternalGame(harness).currentTurn.turnId,
    value,
  };
}

const INVALID_GUESS_PAYLOADS: Array<
  [label: string, createPayload: (turnId: string) => unknown]
> = [
  ["zéro", (turnId) => ({ turnId, value: 0 })],
  ["onze", (turnId) => ({ turnId, value: 11 })],
  ["un décimal", (turnId) => ({ turnId, value: 5.5 })],
  ["NaN", (turnId) => ({ turnId, value: Number.NaN })],
  ["Infinity", (turnId) => ({ turnId, value: Number.POSITIVE_INFINITY })],
  ["une chaîne", (turnId) => ({ turnId, value: "5" })],
  ["un turnId absent", () => ({ value: 5 })],
  ["un turnId vide", () => ({ turnId: "", value: 5 })],
  ["un turnId entouré d'espaces", () => ({ turnId: " turn-1 ", value: 5 })],
  ["un turnId non textuel", () => ({ turnId: 1, value: 5 })],
  ["null", () => null],
  ["un payload absent", () => undefined],
  ["un tableau", (turnId) => [{ turnId, value: 5 }]],
  [
    "une propriété supplémentaire",
    (turnId) => ({ turnId, value: 5, playerId: "player-2" }),
  ],
  ["un objet Date", () => new Date()],
  ["une valeur imbriquée", (turnId) => ({ turnId, value: { nested: 5 } })],
];

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

  throw new Error(`L'action aurait dû échouer avec le code ${expectedCode}.`);
}

afterEach(() => {
  for (const gameManager of createdGameManagers.splice(0)) {
    gameManager.dispose();
  }
  vi.restoreAllMocks();
});

describe("GameManager authoritative guesses", () => {
  it("initialise chaque nouveau tour avec un stockage d'estimations vide", () => {
    const harness = prepareVotingGame();

    expect(getInternalGame(harness).currentTurn.guesses).toEqual({});
    expect(getPublicGame(harness).voting).toEqual({
      eligibleVoterCount: 2,
      submittedGuessCount: 0,
    });
  });

  it("refuse d'abord un socket extérieur au salon", () => {
    const roomManager = createRoomManager();
    const gameManager = createGameManager(roomManager);

    expectRoomError(
      () => gameManager.submitGuess("socket-inconnu", { value: 0 }),
      "NOT_IN_ROOM",
    );
  });

  it("refuse une estimation lorsqu'aucune partie n'est en cours", () => {
    const prepared = prepareRoom();
    const gameManager = createGameManager(prepared.roomManager);

    expectRoomError(
      () => gameManager.submitGuess(prepared.socketIds[1]!, { value: 5 }),
      "GAME_NOT_STARTED",
    );
  });

  it("refuse une estimation avant VOTING et après REVEAL", () => {
    const prepared = prepareRoom();
    for (const socketId of prepared.socketIds) {
      prepared.roomManager.setPlayerReady(socketId, true);
    }
    const gameManager = createGameManager(prepared.roomManager);
    gameManager.startGame(prepared.socketIds[0]!);

    expectRoomError(
      () => gameManager.submitGuess(prepared.socketIds[1]!, { value: 5 }),
      "NOT_VOTING_PHASE",
    );

    const harness = prepareVotingGame();
    harness.gameManager.submitGuess(
      harness.socketIds[1]!,
      createGuessPayload(harness, 5),
    );
    harness.gameManager.submitGuess(
      harness.socketIds[2]!,
      createGuessPayload(harness, 7),
    );

    expect(getInternalGame(harness).phase).toBe("REVEAL");
    expectRoomError(
      () => harness.gameManager.submitGuess(harness.socketIds[1]!, { value: 9 }),
      "NOT_VOTING_PHASE",
    );
  });

  it("refuse un socket dont le joueur a disparu du salon", () => {
    const harness = prepareVotingGame();
    const internalRoom = harness.roomManager.getRoomByCode(harness.roomCode);
    if (internalRoom === undefined) {
      throw new Error("Le salon interne était attendu.");
    }
    internalRoom.players.splice(1, 1);

    expectRoomError(
      () => harness.gameManager.submitGuess(harness.socketIds[1]!, { value: 5 }),
      "PLAYER_NOT_FOUND",
    );
  });

  it("refuse toujours le dessinateur, même avec un payload valide", () => {
    const harness = prepareVotingGame();

    expectRoomError(
      () =>
        harness.gameManager.submitGuess(
          harness.socketIds[0]!,
          createGuessPayload(harness, 7),
        ),
      "DRAWER_CANNOT_GUESS",
    );
    expect(getInternalGame(harness).currentTurn.guesses).toEqual({});
  });

  it("refuse un joueur présent mais absent des votants attendus", () => {
    const harness = prepareVotingGame();
    const game = getInternalGame(harness);
    game.turnOrder = game.turnOrder.filter(
      (playerId) => playerId !== harness.playerIds[1],
    );

    expectRoomError(
      () =>
        harness.gameManager.submitGuess(
          harness.socketIds[1]!,
          createGuessPayload(harness, 5),
        ),
      "PLAYER_NOT_ELIGIBLE",
    );
  });

  it.each(INVALID_GUESS_PAYLOADS)(
    "refuse %s sans stocker d'estimation",
    (_label, createPayload) => {
      const harness = prepareVotingGame();
      const payload = createPayload(getInternalGame(harness).currentTurn.turnId);

      expectRoomError(
        () => harness.gameManager.submitGuess(harness.socketIds[1]!, payload),
        "INVALID_GUESS",
      );
      expect(getInternalGame(harness).currentTurn.guesses).toEqual({});
      expect(getPublicGame(harness).voting?.submittedGuessCount).toBe(0);
    },
  );

  it("refuse une estimation liée à un ancien tour sans modifier le vote ni les scores", () => {
    const harness = prepareVotingGame();
    const game = getInternalGame(harness);
    const scoresBefore = harness.roomManager
      .getRoomByCode(harness.roomCode)
      ?.players.map((player) => player.score);

    expectRoomError(
      () =>
        harness.gameManager.submitGuess(harness.socketIds[1]!, {
          turnId: "ancien-tour",
          value: 5,
        }),
      "STALE_TURN",
    );

    expect(game.phase).toBe("VOTING");
    expect(game.currentTurn.guesses).toEqual({});
    expect(game.currentTurn.scoresAppliedAt).toBeNull();
    expect(game.currentTurn.scoreResult).toBeNull();
    expect(getPublicGame(harness).voting?.submittedGuessCount).toBe(0);
    expect(
      harness.roomManager
        .getRoomByCode(harness.roomCode)
        ?.players.map((player) => player.score),
    ).toEqual(scoresBefore);
  });

  it("refuse proprement un payload dont l'introspection lève une erreur", () => {
    const harness = prepareVotingGame();
    const hostilePayload = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("payload hostile");
        },
      },
    );

    expectRoomError(
      () =>
        harness.gameManager.submitGuess(
          harness.socketIds[1]!,
          hostilePayload,
        ),
      "INVALID_GUESS",
    );
    expect(getInternalGame(harness).currentTurn.guesses).toEqual({});
  });

  it("stocke une estimation valide et sa date sans l'exposer pendant VOTING", () => {
    const harness = prepareVotingGame();
    const payload = createGuessPayload(harness, 5);
    harness.setTime(30_000);

    const result = harness.gameManager.submitGuess(
      harness.socketIds[1]!,
      payload,
    );
    payload.value = 9;
    payload.turnId = "ancien-tour";

    const internalGuess =
      getInternalGame(harness).currentTurn.guesses[harness.playerIds[1]!];
    expect(internalGuess).toEqual({
      playerId: harness.playerIds[1],
      value: 5,
      submittedAt: 30_000,
    });
    expect(result.guess).toEqual({ value: 5, submittedAt: 30_000 });
    expect(result.room.game).toMatchObject({
      phase: "VOTING",
      phaseEndsAt: null,
      voting: {
        eligibleVoterCount: 2,
        submittedGuessCount: 1,
      },
      reveal: null,
    });
    expect(result.room.game?.submittedDrawing).not.toBeNull();

    const serializedPublicState = JSON.stringify(result.room.game);
    expect(serializedPublicState).not.toContain("secretLevel");
    expect(serializedPublicState).not.toContain('"guesses"');
    expect(serializedPublicState).not.toContain('"distance"');
    expect(Object.keys(result.room.game?.voting ?? {}).sort()).toEqual([
      "eligibleVoterCount",
      "submittedGuessCount",
    ]);

    const serializedAcknowledgement = JSON.stringify(result.guess);
    expect(serializedAcknowledgement).not.toContain("secretLevel");
    expect(serializedAcknowledgement).not.toContain("distance");
    expect(serializedAcknowledgement).not.toContain("playerId");
  });

  it("refuse définitivement une seconde estimation avant de valider son payload", () => {
    const harness = prepareVotingGame();
    harness.gameManager.submitGuess(
      harness.socketIds[1]!,
      createGuessPayload(harness, 5),
    );

    expectRoomError(
      () =>
        harness.gameManager.submitGuess(
          harness.socketIds[1]!,
          createGuessPayload(harness, 0),
        ),
      "GUESS_ALREADY_SUBMITTED",
    );
    expect(
      getInternalGame(harness).currentTurn.guesses[harness.playerIds[1]!]
        ?.value,
    ).toBe(5);
  });

  it("reste en VOTING jusqu'au dernier vote puis révèle atomiquement les résultats dans l'ordre du salon", () => {
    const harness = prepareVotingGame(4, 7);

    harness.setTime(30_001);
    const first = harness.gameManager.submitGuess(harness.socketIds[3]!, {
      turnId: getInternalGame(harness).currentTurn.turnId,
      value: 10,
    });
    harness.setTime(30_002);
    const second = harness.gameManager.submitGuess(harness.socketIds[1]!, {
      turnId: getInternalGame(harness).currentTurn.turnId,
      value: 5,
    });

    expect(first.room.game).toMatchObject({
      phase: "VOTING",
      voting: { eligibleVoterCount: 3, submittedGuessCount: 1 },
      reveal: null,
    });
    expect(second.room.game).toMatchObject({
      phase: "VOTING",
      voting: { eligibleVoterCount: 3, submittedGuessCount: 2 },
      reveal: null,
    });
    expect(JSON.stringify(second.room.game)).not.toContain("secretLevel");
    expect(JSON.stringify(second.room.game)).not.toContain('"guesses"');

    harness.setTime(30_003);
    const last = harness.gameManager.submitGuess(harness.socketIds[2]!, {
      turnId: getInternalGame(harness).currentTurn.turnId,
      value: 7,
    });

    expect(last.guess).toEqual({ value: 7, submittedAt: 30_003 });
    expect(getInternalGame(harness).phase).toBe("REVEAL");
    expect(last.room.game).toMatchObject({
      phase: "REVEAL",
      phaseEndsAt: null,
      voting: null,
      reveal: {
        secretLevel: 7,
        guesses: [
          {
            player: { id: harness.playerIds[1], nickname: "J2" },
            value: 5,
            distance: 2,
          },
          {
            player: { id: harness.playerIds[2], nickname: "J3" },
            value: 7,
            distance: 0,
          },
          {
            player: { id: harness.playerIds[3], nickname: "J4" },
            value: 10,
            distance: 3,
          },
        ],
      },
    });
    expect(last.room.game?.submittedDrawing).not.toBeNull();
    expect(last.room.game?.reveal?.guesses).toHaveLength(3);
    expect(
      last.room.game?.reveal?.guesses.some(
        ({ player }) => player.id === harness.playerIds[0],
      ),
    ).toBe(false);

    expect(last.room.game).not.toHaveProperty("score");
    expect(last.room.game).not.toHaveProperty("points");
    expect(last.room.game?.reveal).not.toHaveProperty("score");
    expect(last.room.game?.reveal).not.toHaveProperty("points");
    for (const guess of last.room.game?.reveal?.guesses ?? []) {
      expect(guess).not.toHaveProperty("score");
      expect(guess).not.toHaveProperty("points");
      expect(guess).not.toHaveProperty("bonus");
      expect(guess).not.toHaveProperty("penalty");
    }
  });

  it("ne laisse pas une mutation de la révélation publique modifier les votes internes", () => {
    const harness = prepareVotingGame();
    harness.gameManager.submitGuess(
      harness.socketIds[1]!,
      createGuessPayload(harness, 5),
    );
    const revealed = harness.gameManager.submitGuess(harness.socketIds[2]!, {
      turnId: getInternalGame(harness).currentTurn.turnId,
      value: 9,
    });
    const firstPublicGuess = revealed.room.game?.reveal?.guesses[0];
    if (firstPublicGuess === undefined) {
      throw new Error("Un résultat public était attendu.");
    }

    firstPublicGuess.value = 1;
    firstPublicGuess.player.nickname = "Mutation";

    const freshReveal = getPublicGame(harness).reveal;
    expect(freshReveal?.guesses[0]).toEqual({
      player: { id: harness.playerIds[1], nickname: "J2" },
      value: 5,
      distance: 2,
      pointsEarned: 3,
      totalScore: 3,
    });
    expect(
      getInternalGame(harness).currentTurn.guesses[harness.playerIds[1]!]
        ?.value,
    ).toBe(5);
  });

  it("ne stocke rien lorsque l'horloge de soumission est invalide", () => {
    const harness = prepareVotingGame();
    harness.setTime(Number.POSITIVE_INFINITY);

    expectRoomError(
      () =>
        harness.gameManager.submitGuess(
          harness.socketIds[1]!,
          createGuessPayload(harness, 5),
        ),
      "INTERNAL_ERROR",
    );
    expect(getInternalGame(harness).phase).toBe("VOTING");
    expect(getInternalGame(harness).currentTurn.guesses).toEqual({});
  });

  it("restaure le vote et la phase si la projection publique échoue", () => {
    const harness = prepareVotingGame();
    const game = getInternalGame(harness);
    game.currentTurn.drawing = null;

    expectRoomError(
      () =>
        harness.gameManager.submitGuess(
          harness.socketIds[1]!,
          createGuessPayload(harness, 5),
        ),
      "INTERNAL_ERROR",
    );
    expect(game.phase).toBe("VOTING");
    expect(game.currentTurn.guesses).toEqual({});
  });

  it("supprime les estimations internes et publiques lors d'une annulation", () => {
    const harness = prepareVotingGame();
    harness.gameManager.submitGuess(
      harness.socketIds[1]!,
      createGuessPayload(harness, 5),
    );
    expect(getInternalGame(harness).currentTurn.guesses).not.toEqual({});

    expect(harness.gameManager.cancelGame(harness.roomCode)).toBe(true);

    const publicRoom = harness.roomManager.getPublicRoomState(harness.roomCode);
    expect(harness.roomManager.getRoomByCode(harness.roomCode)?.game).toBeNull();
    expect(publicRoom.game).toBeNull();
    expect(publicRoom.players.every((player) => !player.isReady)).toBe(true);
    expect(JSON.stringify(publicRoom)).not.toContain('"voting"');
    expect(JSON.stringify(publicRoom)).not.toContain('"reveal"');
  });

  it("annule aussi proprement une partie déjà passée en REVEAL", () => {
    const harness = prepareVotingGame();
    harness.gameManager.submitGuess(
      harness.socketIds[1]!,
      createGuessPayload(harness, 5),
    );
    harness.gameManager.submitGuess(
      harness.socketIds[2]!,
      createGuessPayload(harness, 9),
    );
    expect(getInternalGame(harness).phase).toBe("REVEAL");

    expect(harness.gameManager.cancelGame(harness.roomCode)).toBe(true);

    const publicRoom = harness.roomManager.getPublicRoomState(harness.roomCode);
    expect(harness.roomManager.getRoomByCode(harness.roomCode)?.game).toBeNull();
    expect(publicRoom.game).toBeNull();
    expect(JSON.stringify(publicRoom)).not.toContain("secretLevel");
    expect(JSON.stringify(publicRoom)).not.toContain('"guesses"');
  });
});
