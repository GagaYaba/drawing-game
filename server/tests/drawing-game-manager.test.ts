import {
  DRAWING_ALLOWED_STROKE_WIDTHS,
  DRAWING_ASPECT_RATIO,
  DRAWING_BACKGROUND_COLOR,
  DRAWING_COLOR_PALETTE,
  DRAWING_DOCUMENT_VERSION,
  DRAWING_MAX_POINTS_PER_STROKE,
  type DrawingDocument,
  type SubmitDrawingPayload,
} from "@drawing-game/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GameManager } from "../src/game/game-manager.js";
import type { GameManagerOptions } from "../src/game/game-types.js";
import { RoomManager, RoomManagerError } from "../src/rooms/room-manager.js";

const ROOM_CODE = "7KXMP";
const STARTED_AT = 20_000;
const SUBMITTED_AT = 25_000;
const TEST_PROMPT = {
  id: "drawing-test-prompt",
  text: "Un monstre plus ou moins effrayant",
  category: "test",
} as const;

interface PreparedRoom {
  roomManager: RoomManager;
  roomCode: string;
  socketIds: string[];
  playerIds: string[];
}

interface DrawingGameHarness extends PreparedRoom {
  gameManager: GameManager;
  setTime: (timestamp: number) => void;
  enterDrawing: () => void;
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

function prepareDrawingGame(
  enterDrawingImmediately = true,
): DrawingGameHarness {
  const prepared = prepareRoom();
  for (const socketId of prepared.socketIds) {
    prepared.roomManager.setPlayerReady(socketId, true);
  }

  let now = STARTED_AT;
  let drawingTransition: (() => void) | undefined;
  const gameManager = createGameManager(prepared.roomManager, {
    clock: () => now,
    scheduleTimer: (callback) => {
      drawingTransition = callback;
      return Symbol("drawing-transition");
    },
  });
  gameManager.startGame(prepared.socketIds[0]!);

  const enterDrawing = (): void => {
    if (drawingTransition === undefined) {
      throw new Error("La transition vers DRAWING n'a pas été planifiée.");
    }
    drawingTransition();
  };

  if (enterDrawingImmediately) {
    enterDrawing();
  }

  return {
    ...prepared,
    gameManager,
    setTime: (timestamp) => {
      now = timestamp;
    },
    enterDrawing,
  };
}

function createDrawingDocument(): DrawingDocument {
  return {
    version: DRAWING_DOCUMENT_VERSION,
    aspectRatio: DRAWING_ASPECT_RATIO,
    backgroundColor: DRAWING_BACKGROUND_COLOR,
    strokes: [
      {
        tool: "pen",
        color: DRAWING_COLOR_PALETTE[2],
        width: DRAWING_ALLOWED_STROKE_WIDTHS[1],
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.4, y: 0.6 },
        ],
      },
      {
        tool: "eraser",
        color: DRAWING_COLOR_PALETTE[0],
        width: DRAWING_ALLOWED_STROKE_WIDTHS[2],
        points: [{ x: 0.3, y: 0.7 }],
      },
    ],
  };
}

function createPayload(): SubmitDrawingPayload {
  return { drawing: createDrawingDocument() };
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

  throw new Error(`L'action aurait dû échouer avec le code ${expectedCode}.`);
}

afterEach(() => {
  for (const gameManager of createdGameManagers.splice(0)) {
    gameManager.dispose();
  }
  vi.restoreAllMocks();
});

describe("GameManager drawing submission", () => {
  it("initialise le tour sans dessin ni date de soumission", () => {
    const harness = prepareDrawingGame(false);
    const internalTurn = harness.roomManager.getRoomByCode(harness.roomCode)
      ?.game?.currentTurn;
    const publicGame = harness.roomManager.getPublicRoomState(
      harness.roomCode,
    ).game;

    expect(internalTurn?.drawing).toBeNull();
    expect(internalTurn?.drawingSubmittedAt).toBeNull();
    expect(publicGame?.phase).toBe("ROUND_INTRO");
    expect(publicGame?.submittedDrawing).toBeNull();
  });

  it("n'expose aucun dessin pendant DRAWING", () => {
    const harness = prepareDrawingGame();
    const publicGame = harness.roomManager.getPublicRoomState(
      harness.roomCode,
    ).game;

    expect(publicGame?.phase).toBe("DRAWING");
    expect(publicGame?.phaseEndsAt).toBeNull();
    expect(publicGame?.submittedDrawing).toBeNull();
  });

  it("refuse d'abord un socket qui n'appartient à aucun salon", () => {
    const roomManager = createRoomManager();
    const gameManager = createGameManager(roomManager);

    expectRoomError(
      () => gameManager.submitDrawing("socket-inconnu", null),
      "NOT_IN_ROOM",
    );
  });

  it("refuse une soumission lorsqu'aucune partie n'est lancée", () => {
    const prepared = prepareRoom();
    const gameManager = createGameManager(prepared.roomManager);

    expectRoomError(
      () => gameManager.submitDrawing(prepared.socketIds[0]!, createPayload()),
      "GAME_NOT_STARTED",
    );
  });

  it("refuse le dessinateur pendant ROUND_INTRO", () => {
    const harness = prepareDrawingGame(false);

    expectRoomError(
      () =>
        harness.gameManager.submitDrawing(
          harness.socketIds[0]!,
          createPayload(),
        ),
      "NOT_DRAWING_PHASE",
    );
  });

  it("refuse un joueur qui n'est pas le dessinateur avant de valider son payload", () => {
    const harness = prepareDrawingGame();

    expectRoomError(
      () => harness.gameManager.submitDrawing(harness.socketIds[1]!, null),
      "NOT_CURRENT_DRAWER",
    );
    expect(
      harness.roomManager.getPublicRoomState(harness.roomCode).game?.phase,
    ).toBe("DRAWING");
  });

  it("propage l'erreur EMPTY_DRAWING du validateur", () => {
    const harness = prepareDrawingGame();
    const emptyPayload = createPayload();
    emptyPayload.drawing.strokes = [];

    expectRoomError(
      () =>
        harness.gameManager.submitDrawing(
          harness.socketIds[0]!,
          emptyPayload,
        ),
      "EMPTY_DRAWING",
    );
  });

  it("propage l'erreur INVALID_DRAWING du validateur", () => {
    const harness = prepareDrawingGame();

    expectRoomError(
      () =>
        harness.gameManager.submitDrawing(harness.socketIds[0]!, {
          drawing: { dataUrl: "data:image/png;base64,interdit" },
        }),
      "INVALID_DRAWING",
    );
  });

  it("propage l'erreur DRAWING_TOO_LARGE du validateur", () => {
    const harness = prepareDrawingGame();
    const payload = createPayload();
    payload.drawing.strokes[0]!.points = Array.from(
      { length: DRAWING_MAX_POINTS_PER_STROKE + 1 },
      () => ({ x: 0.5, y: 0.5 }),
    );

    expectRoomError(
      () =>
        harness.gameManager.submitDrawing(harness.socketIds[0]!, payload),
      "DRAWING_TOO_LARGE",
    );
  });

  it("stocke le dessin et sa date puis passe autoritairement à VOTING", () => {
    const harness = prepareDrawingGame();
    harness.setTime(SUBMITTED_AT);
    const payload = createPayload();

    const result = harness.gameManager.submitDrawing(
      harness.socketIds[0]!,
      payload,
    );
    const internalGame = harness.roomManager.getRoomByCode(harness.roomCode)
      ?.game;

    expect(internalGame?.phase).toBe("VOTING");
    expect(internalGame?.phaseEndsAt).toBeNull();
    expect(internalGame?.currentTurn.drawingSubmittedAt).toBe(SUBMITTED_AT);
    expect(internalGame?.currentTurn.drawing).toEqual({
      ...payload.drawing,
      strokes: [
        payload.drawing.strokes[0],
        {
          ...payload.drawing.strokes[1],
          color: DRAWING_BACKGROUND_COLOR,
        },
      ],
    });
    expect(result.room.game?.phase).toBe("VOTING");
    expect(result.room.game?.phaseEndsAt).toBeNull();
    expect(result.room.game?.submittedDrawing).toEqual({
      document: internalGame?.currentTurn.drawing,
      submittedAt: SUBMITTED_AT,
    });
  });

  it("n'expose jamais le niveau secret avec le dessin public", () => {
    const harness = prepareDrawingGame();
    harness.setTime(SUBMITTED_AT);

    const result = harness.gameManager.submitDrawing(
      harness.socketIds[0]!,
      createPayload(),
    );
    const serialized = JSON.stringify(result.room);

    expect(result.room.game?.submittedDrawing).not.toBeNull();
    expect(serialized).not.toContain("secretLevel");
    expect(serialized).not.toContain("socketId");
    expect(serialized).not.toContain("turnOrder");
    expect(serialized).not.toContain("drawerSocketId");
  });

  it("ne conserve aucune référence mutable provenant du payload", () => {
    const harness = prepareDrawingGame();
    harness.setTime(SUBMITTED_AT);
    const payload = createPayload();
    const originalX = payload.drawing.strokes[0]!.points[0]!.x;

    harness.gameManager.submitDrawing(harness.socketIds[0]!, payload);
    payload.drawing.strokes[0]!.points[0]!.x = 0.99;
    payload.drawing.strokes.push({
      tool: "pen",
      color: DRAWING_COLOR_PALETTE[0],
      width: DRAWING_ALLOWED_STROKE_WIDTHS[0],
      points: [{ x: 1, y: 1 }],
    });

    const stored = harness.roomManager.getRoomByCode(harness.roomCode)?.game
      ?.currentTurn.drawing;
    expect(stored?.strokes).toHaveLength(2);
    expect(stored?.strokes[0]?.points[0]?.x).toBe(originalX);
    expect(stored).not.toBe(payload.drawing);
  });

  it("protège aussi l'état interne contre la mutation d'une projection publique", () => {
    const harness = prepareDrawingGame();
    harness.setTime(SUBMITTED_AT);
    const result = harness.gameManager.submitDrawing(
      harness.socketIds[0]!,
      createPayload(),
    );
    const publicDocument = result.room.game?.submittedDrawing?.document;
    if (publicDocument === undefined) {
      throw new Error("Le dessin public aurait dû être présent.");
    }

    publicDocument.strokes[0]!.points[0]!.x = 0.99;
    publicDocument.strokes.push({
      tool: "pen",
      color: DRAWING_COLOR_PALETTE[0],
      width: DRAWING_ALLOWED_STROKE_WIDTHS[0],
      points: [{ x: 1, y: 1 }],
    });

    const stored = harness.roomManager.getRoomByCode(harness.roomCode)?.game
      ?.currentTurn.drawing;
    const freshProjection = harness.roomManager.getPublicRoomState(
      harness.roomCode,
    ).game?.submittedDrawing?.document;
    expect(stored?.strokes).toHaveLength(2);
    expect(stored?.strokes[0]?.points[0]?.x).toBe(0.1);
    expect(freshProjection).toEqual(stored);
  });

  it("refuse une nouvelle soumission après le passage à VOTING", () => {
    const harness = prepareDrawingGame();
    harness.setTime(SUBMITTED_AT);
    harness.gameManager.submitDrawing(harness.socketIds[0]!, createPayload());

    expectRoomError(
      () =>
        harness.gameManager.submitDrawing(
          harness.socketIds[0]!,
          createPayload(),
        ),
      "NOT_DRAWING_PHASE",
    );
  });

  it("refuse explicitement un état DRAWING qui contient déjà un dessin", () => {
    const harness = prepareDrawingGame();
    const internalGame = harness.roomManager.getRoomByCode(harness.roomCode)
      ?.game;
    if (internalGame === null || internalGame === undefined) {
      throw new Error("La partie interne aurait dû exister.");
    }
    internalGame.currentTurn.drawing = createDrawingDocument();
    internalGame.currentTurn.drawingSubmittedAt = SUBMITTED_AT;

    expectRoomError(
      () =>
        harness.gameManager.submitDrawing(
          harness.socketIds[0]!,
          createPayload(),
        ),
      "DRAWING_ALREADY_SUBMITTED",
    );
  });

  it("restaure DRAWING sans dessin si l'horloge de soumission est invalide", () => {
    const harness = prepareDrawingGame();
    harness.setTime(Number.POSITIVE_INFINITY);

    expectRoomError(
      () =>
        harness.gameManager.submitDrawing(
          harness.socketIds[0]!,
          createPayload(),
        ),
      "INTERNAL_ERROR",
    );

    const internalGame = harness.roomManager.getRoomByCode(harness.roomCode)
      ?.game;
    expect(internalGame?.phase).toBe("DRAWING");
    expect(internalGame?.currentTurn.drawing).toBeNull();
    expect(internalGame?.currentTurn.drawingSubmittedAt).toBeNull();
  });

  it("supprime le dessin public et interne lorsque la partie est annulée", () => {
    const harness = prepareDrawingGame();
    harness.setTime(SUBMITTED_AT);
    harness.gameManager.submitDrawing(harness.socketIds[0]!, createPayload());

    expect(harness.gameManager.cancelGame(harness.roomCode)).toBe(true);

    const internalRoom = harness.roomManager.getRoomByCode(harness.roomCode);
    const publicRoom = harness.roomManager.getPublicRoomState(harness.roomCode);
    expect(internalRoom?.game).toBeNull();
    expect(publicRoom.game).toBeNull();
    expect(publicRoom.players.every((player) => !player.isReady)).toBe(true);
    expect(JSON.stringify(publicRoom)).not.toContain("submittedDrawing");
  });
});
