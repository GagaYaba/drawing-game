import type { AddressInfo } from "node:net";

import {
  DRAWING_ALLOWED_STROKE_WIDTHS,
  DRAWING_ASPECT_RATIO,
  DRAWING_BACKGROUND_COLOR,
  DRAWING_COLOR_PALETTE,
  DRAWING_DOCUMENT_VERSION,
  DRAWING_MAX_POINTS_PER_STROKE,
  DRAWING_MAX_TOTAL_POINTS,
  SOCKET_EVENTS,
  type ActionAcknowledgement,
  type ActionResult,
  type ClientToServerEvents,
  type DrawingDocument,
  type GameCancelledPayload,
  type PlayerSessionCredentials,
  type PublicGameState,
  type PublicRoomState,
  type RoomErrorCode,
  type RoomSessionData,
  type ServerPongPayload,
  type ServerToClientEvents,
  type StartGameSuccessData,
  type SubmitDrawingPayload,
  type SubmitDrawingSuccessData,
  type TurnSecretPayload,
} from "@drawing-game/shared";
import { io as createSocketClient, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_SOCKET_MESSAGE_BYTES,
  createDrawingGameServer,
} from "../src/create-server.js";

type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;
type DrawingGameServer = ReturnType<typeof createDrawingGameServer>;

interface PreparedRoom {
  sockets: TestClient[];
  sessions: PlayerSessionCredentials[];
  roomCode: string;
}

const ASYNC_TIMEOUT_MS = 8_000;
const TEST_TIMEOUT_MS = 20_000;
const INTRO_DURATION_MS = 500;
const SECRET_LEVEL = 7;
const TEST_PROMPT = {
  id: "drawing-integration-prompt",
  statement:
    "Représente un phare du plus lumineux (10) au moins lumineux (1).",
  lowLabel: "Moins lumineux",
  highLabel: "Plus lumineux",
  category: "integration",
} as const;

let server: DrawingGameServer | undefined;
let serverUrl = "";
let clients: TestClient[] = [];

function createValidDrawing(): DrawingDocument {
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
          { x: 0.5, y: 0.6 },
          { x: 0.9, y: 0.8 },
        ],
      },
      {
        tool: "eraser",
        color: DRAWING_COLOR_PALETTE[0],
        width: DRAWING_ALLOWED_STROKE_WIDTHS[2],
        points: [{ x: 0.4, y: 0.5 }],
      },
    ],
  };
}

function createMaximumLargeDrawing(): DrawingDocument {
  const strokeCount =
    DRAWING_MAX_TOTAL_POINTS / DRAWING_MAX_POINTS_PER_STROKE;

  if (!Number.isInteger(strokeCount)) {
    throw new Error("Les limites de dessin ne permettent pas une fixture exacte.");
  }

  return {
    version: DRAWING_DOCUMENT_VERSION,
    aspectRatio: DRAWING_ASPECT_RATIO,
    backgroundColor: DRAWING_BACKGROUND_COLOR,
    strokes: Array.from({ length: strokeCount }, (_, strokeIndex) => ({
      tool: "pen",
      color: DRAWING_COLOR_PALETTE[strokeIndex % DRAWING_COLOR_PALETTE.length]!,
      width:
        DRAWING_ALLOWED_STROKE_WIDTHS[
          strokeIndex % DRAWING_ALLOWED_STROKE_WIDTHS.length
        ]!,
      points: Array.from(
        { length: DRAWING_MAX_POINTS_PER_STROKE },
        (_, pointIndex) => {
          const absoluteIndex =
            strokeIndex * DRAWING_MAX_POINTS_PER_STROKE + pointIndex;

          return {
            x:
              (pointIndex + 0.123_456_789_012_345_6) /
              DRAWING_MAX_POINTS_PER_STROKE,
            y:
              (absoluteIndex + 0.987_654_321_098_765_4) /
              DRAWING_MAX_TOTAL_POINTS,
          };
        },
      ),
    })),
  };
}

function waitForAcknowledgement<T>(
  emitAction: (acknowledge: ActionAcknowledgement<T>) => void,
): Promise<ActionResult<T>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Socket.IO acknowledgement timed out"));
    }, ASYNC_TIMEOUT_MS);

    emitAction((result) => {
      clearTimeout(timeout);
      resolve(result);
    });
  });
}

function createRoom(
  socket: TestClient,
  nickname: string,
): Promise<ActionResult<RoomSessionData>> {
  return waitForAcknowledgement((acknowledge) => {
    socket.emit(SOCKET_EVENTS.ROOM_CREATE, { nickname }, acknowledge);
  });
}

function joinRoom(
  socket: TestClient,
  nickname: string,
  roomCode: string,
): Promise<ActionResult<RoomSessionData>> {
  return waitForAcknowledgement((acknowledge) => {
    socket.emit(
      SOCKET_EVENTS.ROOM_JOIN,
      { nickname, roomCode },
      acknowledge,
    );
  });
}

function setReady(
  socket: TestClient,
): Promise<ActionResult<PublicRoomState>> {
  return waitForAcknowledgement((acknowledge) => {
    socket.emit(
      SOCKET_EVENTS.PLAYER_SET_READY,
      { isReady: true },
      acknowledge,
    );
  });
}

function startGame(
  socket: TestClient,
): Promise<ActionResult<StartGameSuccessData>> {
  return waitForAcknowledgement((acknowledge) => {
    socket.emit(SOCKET_EVENTS.GAME_START, acknowledge);
  });
}

function submitDrawing(
  socket: TestClient,
  drawing: DrawingDocument,
): Promise<ActionResult<SubmitDrawingSuccessData>> {
  return waitForAcknowledgement((acknowledge) => {
    socket.emit(SOCKET_EVENTS.DRAWING_SUBMIT, { drawing }, acknowledge);
  });
}

function submitDrawingWithArguments(
  socket: TestClient,
  ...payloadArguments: unknown[]
): Promise<ActionResult<SubmitDrawingSuccessData>> {
  return waitForAcknowledgement((acknowledge) => {
    Reflect.apply(socket.emit, socket, [
      SOCKET_EVENTS.DRAWING_SUBMIT,
      ...payloadArguments,
      acknowledge,
    ]);
  });
}

function waitForRoomState(
  socket: TestClient,
  predicate: (state: PublicRoomState) => boolean,
): Promise<PublicRoomState> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off(SOCKET_EVENTS.ROOM_STATE, handleState);
    };
    const handleState = (state: PublicRoomState): void => {
      if (!predicate(state)) {
        return;
      }

      cleanup();
      resolve(state);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for room:state"));
    }, ASYNC_TIMEOUT_MS);

    socket.on(SOCKET_EVENTS.ROOM_STATE, handleState);
  });
}

function waitForGameCancellation(
  socket: TestClient,
): Promise<GameCancelledPayload> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off(SOCKET_EVENTS.GAME_CANCELLED, handleCancellation);
    };
    const handleCancellation = (payload: GameCancelledPayload): void => {
      cleanup();
      resolve(payload);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for game:cancelled"));
    }, ASYNC_TIMEOUT_MS);

    socket.on(SOCKET_EVENTS.GAME_CANCELLED, handleCancellation);
  });
}

function waitForPong(socket: TestClient): Promise<ServerPongPayload> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off(SOCKET_EVENTS.SERVER_PONG, handlePong);
    };
    const handlePong = (payload: ServerPongPayload): void => {
      cleanup();
      resolve(payload);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for server:pong"));
    }, ASYNC_TIMEOUT_MS);

    socket.on(SOCKET_EVENTS.SERVER_PONG, handlePong);
  });
}

async function passSocketBarrier(socket: TestClient): Promise<void> {
  const sentAt = Date.now();
  const pong = waitForPong(socket);
  socket.emit(SOCKET_EVENTS.CLIENT_PING, { sentAt });
  await expect(pong).resolves.toMatchObject({ sentAt });
}

function collectSecrets(socket: TestClient): TurnSecretPayload[] {
  const secrets: TurnSecretPayload[] = [];
  socket.on(SOCKET_EVENTS.TURN_SECRET, (payload) => {
    secrets.push(payload);
  });
  return secrets;
}

function expectSuccess<T>(result: ActionResult<T>): T {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error(`Succès attendu, erreur ${result.error.code} reçue.`);
  }
  return result.data;
}

function expectError<T>(
  result: ActionResult<T>,
  expectedCode: RoomErrorCode,
): void {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Une erreur d'action était attendue.");
  }
  expect(result.error.code).toBe(expectedCode);
  expect(result.error.message.length).toBeGreaterThan(0);
}

function expectGame(
  room: PublicRoomState,
  expectedPhase: PublicGameState["phase"],
): PublicGameState {
  expect(room.game).not.toBeNull();
  if (room.game === null) {
    throw new Error("Un état public de partie était attendu.");
  }
  expect(room.game.phase).toBe(expectedPhase);
  return room.game;
}

function expectNoSecret(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("secretLevel");
  expect(serialized).not.toContain("socketId");
  expect(serialized).not.toContain("drawerSocketId");
  expect(serialized).not.toContain("turnOrder");
}

async function connectClient(): Promise<TestClient> {
  const socket: TestClient = createSocketClient(serverUrl, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    timeout: ASYNC_TIMEOUT_MS,
    transports: ["websocket"],
  });
  clients.push(socket);

  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleConnectError);
    };
    const handleConnect = (): void => {
      cleanup();
      resolve();
    };
    const handleConnectError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out connecting the Socket.IO client"));
    }, ASYNC_TIMEOUT_MS);

    socket.on("connect", handleConnect);
    socket.on("connect_error", handleConnectError);
    socket.connect();
  });

  return socket;
}

async function prepareRoom(nicknamePrefix: string): Promise<PreparedRoom> {
  const sockets = await Promise.all([
    connectClient(),
    connectClient(),
    connectClient(),
  ]);
  const hostSession = expectSuccess(
    await createRoom(sockets[0]!, `${nicknamePrefix}1`),
  );
  const sessions = [hostSession.session];

  for (let index = 1; index < sockets.length; index += 1) {
    sessions.push(
      expectSuccess(
        await joinRoom(
          sockets[index]!,
          `${nicknamePrefix}${index + 1}`,
          hostSession.session.roomCode,
        ),
      ).session,
    );
  }

  for (const socket of sockets) {
    expectSuccess(await setReady(socket));
  }

  return {
    sockets,
    sessions,
    roomCode: hostSession.session.roomCode,
  };
}

async function startAndWaitForDrawing(
  room: PreparedRoom,
): Promise<PublicRoomState[]> {
  const drawingStates = room.sockets.map((socket) =>
    waitForRoomState(
      socket,
      (state) =>
        state.code === room.roomCode && state.game?.phase === "DRAWING",
    ),
  );

  expectSuccess(await startGame(room.sockets[0]!));
  return Promise.all(drawingStates);
}

beforeEach(async () => {
  clients = [];
  const createdServer = createDrawingGameServer({
    serveClient: false,
    reconnectGraceMs: 0,
    gameManagerOptions: {
      introDurationMs: INTRO_DURATION_MS,
      prompts: [TEST_PROMPT],
      shufflePlayerIds: (playerIds) => [...playerIds],
      selectPrompt: (prompts) => prompts[0]!,
      generateSecretLevel: () => SECRET_LEVEL,
    },
  });
  server = createdServer;

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error): void => {
      createdServer.httpServer.off("listening", handleListening);
      reject(error);
    };
    const handleListening = (): void => {
      createdServer.httpServer.off("error", handleError);
      resolve();
    };

    createdServer.httpServer.once("error", handleError);
    createdServer.httpServer.once("listening", handleListening);
    createdServer.httpServer.listen(0, "127.0.0.1");
  });

  const address = createdServer.httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("The test server did not expose a TCP address");
  }
  serverUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
});

afterEach(async () => {
  for (const socket of clients) {
    socket.removeAllListeners();
    socket.disconnect();
  }
  clients = [];

  if (server !== undefined) {
    const activeServer = server;
    await new Promise<void>((resolve, reject) => {
      activeServer.io.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server = undefined;
  }
});

describe("Socket.IO drawing submission integration", () => {
  it(
    "publie le même dessin aux trois joueurs et conserve le secret chez le seul dessinateur",
    async () => {
      const room = await prepareRoom("Success");
      const receivedSecrets = room.sockets.map(collectSecrets);
      const drawingStates = await startAndWaitForDrawing(room);
      await Promise.all(room.sockets.map(passSocketBarrier));

      for (const state of drawingStates) {
        const game = expectGame(state, "DRAWING");
        expect(game.submittedDrawing).toBeNull();
        expectNoSecret(state);
      }

      const drawingGame = expectGame(drawingStates[0]!, "DRAWING");
      const drawerIndex = room.sessions.findIndex(
        (session) => session.playerId === drawingGame.currentDrawer.id,
      );
      expect(drawerIndex).toBeGreaterThanOrEqual(0);

      const votingStates = room.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === room.roomCode && state.game?.phase === "VOTING",
        ),
      );
      const acknowledgement = expectSuccess(
        await submitDrawing(room.sockets[drawerIndex]!, createValidDrawing()),
      );
      const receivedVotingStates = await Promise.all(votingStates);

      const acknowledgedGame = expectGame(acknowledgement.room, "VOTING");
      expect(acknowledgedGame.phaseEndsAt).toBeNull();
      expect(acknowledgedGame.submittedDrawing?.submittedAt).toEqual(
        expect.any(Number),
      );
      expect(
        acknowledgedGame.submittedDrawing?.document.strokes[1]?.color,
      ).toBe(DRAWING_BACKGROUND_COLOR);

      for (const state of receivedVotingStates) {
        expect(state).toEqual(acknowledgement.room);
        expect(state.game?.submittedDrawing).toEqual(
          acknowledgedGame.submittedDrawing,
        );
        expectNoSecret(state);
      }
      expectNoSecret(acknowledgement);

      for (const [index, secrets] of receivedSecrets.entries()) {
        if (index === drawerIndex) {
          expect(secrets).toEqual([
            {
              roomCode: room.roomCode,
              gameId: drawingGame.gameId,
              turnId: drawingGame.turnId,
              drawerPlayerId: drawingGame.currentDrawer.id,
              secretLevel: SECRET_LEVEL,
            },
          ]);
        } else {
          expect(secrets).toEqual([]);
        }
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "accepte par WebSocket exactement 30 000 points dans un payload supérieur à 1 Mo",
    async () => {
      const room = await prepareRoom("Large");
      room.sockets.map(collectSecrets);
      const drawingStates = await startAndWaitForDrawing(room);
      const drawingGame = expectGame(drawingStates[0]!, "DRAWING");
      const drawerIndex = room.sessions.findIndex(
        (session) => session.playerId === drawingGame.currentDrawer.id,
      );
      expect(drawerIndex).toBeGreaterThanOrEqual(0);

      const drawing = createMaximumLargeDrawing();
      const totalPointCount = drawing.strokes.reduce(
        (total, stroke) => total + stroke.points.length,
        0,
      );
      const serializedPayloadBytes = Buffer.byteLength(
        JSON.stringify({ drawing }),
        "utf8",
      );

      expect(totalPointCount).toBe(DRAWING_MAX_TOTAL_POINTS);
      expect(serializedPayloadBytes).toBeGreaterThan(1_000_000);
      expect(serializedPayloadBytes).toBeLessThan(MAX_SOCKET_MESSAGE_BYTES);

      const votingStates = room.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === room.roomCode && state.game?.phase === "VOTING",
        ),
      );
      const acknowledgement = expectSuccess(
        await submitDrawing(room.sockets[drawerIndex]!, drawing),
      );
      const receivedVotingStates = await Promise.all(votingStates);

      const acknowledgedDrawing = expectGame(
        acknowledgement.room,
        "VOTING",
      ).submittedDrawing?.document;
      expect(acknowledgedDrawing).not.toBeNull();
      expect(
        acknowledgedDrawing?.strokes.reduce(
          (total, stroke) => total + stroke.points.length,
          0,
        ),
      ).toBe(DRAWING_MAX_TOTAL_POINTS);

      for (const state of receivedVotingStates) {
        const submittedDrawing = expectGame(state, "VOTING").submittedDrawing;
        expect(submittedDrawing).not.toBeNull();
        expect(
          submittedDrawing?.document.strokes.reduce(
            (total, stroke) => total + stroke.points.length,
            0,
          ),
        ).toBe(DRAWING_MAX_TOTAL_POINTS);
      }

      await Promise.all(room.sockets.map(passSocketBarrier));
      expect(room.sockets.every((socket) => socket.connected)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuse un socket hors salon avant même d'inspecter son payload",
    async () => {
      const outsider = await connectClient();

      expectError(
        await submitDrawingWithArguments(outsider, null),
        "NOT_IN_ROOM",
      );
      expect(outsider.connected).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuse une soumission avant le lancement de la partie",
    async () => {
      const room = await prepareRoom("Lobby");

      expectError(
        await submitDrawing(room.sockets[0]!, createValidDrawing()),
        "GAME_NOT_STARTED",
      );
      expect(server?.roomManager.getPublicRoomState(room.roomCode).game).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuse une soumission pendant ROUND_INTRO",
    async () => {
      const room = await prepareRoom("Intro");
      room.sockets.map(collectSecrets);
      expectSuccess(await startGame(room.sockets[0]!));

      expectError(
        await submitDrawing(room.sockets[0]!, createValidDrawing()),
        "NOT_DRAWING_PHASE",
      );
      expect(
        server?.roomManager.getPublicRoomState(room.roomCode).game?.phase,
      ).toBe("ROUND_INTRO");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuse un non-dessinateur et conserve DRAWING sans dessin",
    async () => {
      const room = await prepareRoom("Permission");
      room.sockets.map(collectSecrets);
      const states = await startAndWaitForDrawing(room);
      const game = expectGame(states[0]!, "DRAWING");
      const drawerIndex = room.sessions.findIndex(
        (session) => session.playerId === game.currentDrawer.id,
      );
      const nonDrawerIndex = drawerIndex === 0 ? 1 : 0;

      expectError(
        await submitDrawing(
          room.sockets[nonDrawerIndex]!,
          createValidDrawing(),
        ),
        "NOT_CURRENT_DRAWER",
      );

      const publicGame = server?.roomManager.getPublicRoomState(room.roomCode).game;
      expect(publicGame?.phase).toBe("DRAWING");
      expect(publicGame?.submittedDrawing).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "acknowledge les dessins invalides et les arguments malformés sans casser le socket",
    async () => {
      const room = await prepareRoom("Validation");
      room.sockets.map(collectSecrets);
      await startAndWaitForDrawing(room);
      const drawer = room.sockets[0]!;
      const emptyDrawing = createValidDrawing();
      emptyDrawing.strokes = [];
      const invalidColor = createValidDrawing();
      invalidColor.strokes[0]!.color = "#000000";
      const invalidCoordinate = createValidDrawing();
      invalidCoordinate.strokes[0]!.points[0]!.x = -0.01;
      const nonFiniteCoordinate = createValidDrawing();
      nonFiniteCoordinate.strokes[0]!.points[0]!.x = Number.NaN;
      const oversizedStroke = createValidDrawing();
      oversizedStroke.strokes[0]!.points = Array.from(
        { length: DRAWING_MAX_POINTS_PER_STROKE + 1 },
        () => ({ x: 0.5, y: 0.5 }),
      );

      expectError(await submitDrawing(drawer, emptyDrawing), "EMPTY_DRAWING");
      expectError(await submitDrawing(drawer, invalidColor), "INVALID_DRAWING");
      expectError(
        await submitDrawing(drawer, invalidCoordinate),
        "INVALID_DRAWING",
      );
      expectError(
        await submitDrawing(drawer, nonFiniteCoordinate),
        "INVALID_DRAWING",
      );
      expectError(
        await submitDrawing(drawer, oversizedStroke),
        "DRAWING_TOO_LARGE",
      );
      expectError(
        await submitDrawingWithArguments(drawer, null),
        "INVALID_DRAWING",
      );
      expectError(
        await submitDrawingWithArguments(drawer),
        "INVALID_DRAWING",
      );
      expectError(
        await submitDrawingWithArguments(
          drawer,
          { drawing: createValidDrawing() },
          { playerId: room.sessions[0]!.playerId },
        ),
        "INVALID_DRAWING",
      );

      expect(drawer.connected).toBe(true);
      expect(
        server?.roomManager.getPublicRoomState(room.roomCode).game,
      ).toMatchObject({ phase: "DRAWING", submittedDrawing: null });

      const validResult = expectSuccess(
        await submitDrawing(drawer, createValidDrawing()),
      );
      expect(validResult.room.game?.phase).toBe("VOTING");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "n'accepte qu'une soumission concurrente puis refuse toute soumission en VOTING",
    async () => {
      const room = await prepareRoom("Double");
      room.sockets.map(collectSecrets);
      await startAndWaitForDrawing(room);
      const votingStates = room.sockets.map((socket) =>
        waitForRoomState(socket, (state) => state.game?.phase === "VOTING"),
      );

      const concurrentResults = await Promise.all([
        submitDrawing(room.sockets[0]!, createValidDrawing()),
        submitDrawing(room.sockets[0]!, createValidDrawing()),
      ]);
      const states = await Promise.all(votingStates);

      expect(concurrentResults.filter((result) => result.success)).toHaveLength(1);
      const rejected = concurrentResults.find((result) => !result.success);
      if (rejected === undefined) {
        throw new Error("Une des soumissions concurrentes aurait dû échouer.");
      }
      expectError(rejected, "NOT_DRAWING_PHASE");

      const officialDrawing = states[0]?.game?.submittedDrawing;
      expect(officialDrawing).not.toBeNull();
      for (const state of states) {
        expect(state.game?.submittedDrawing).toEqual(officialDrawing);
      }

      expectError(
        await submitDrawing(room.sockets[0]!, createValidDrawing()),
        "NOT_DRAWING_PHASE",
      );
      expect(
        server?.roomManager.getPublicRoomState(room.roomCode).game
          ?.submittedDrawing,
      ).toEqual(officialDrawing);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "isole le dessin et les états VOTING entre deux salons",
    async () => {
      const firstRoom = await prepareRoom("Alpha");
      const secondRoom = await prepareRoom("Beta");
      [...firstRoom.sockets, ...secondRoom.sockets].map(collectSecrets);
      await Promise.all([
        startAndWaitForDrawing(firstRoom),
        startAndWaitForDrawing(secondRoom),
      ]);
      expect(firstRoom.roomCode).not.toBe(secondRoom.roomCode);

      const leakedStates: PublicRoomState[] = [];
      for (const socket of secondRoom.sockets) {
        socket.on(SOCKET_EVENTS.ROOM_STATE, (state) => {
          if (state.code === firstRoom.roomCode) {
            leakedStates.push(state);
          }
        });
      }
      const firstVotingStates = firstRoom.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === firstRoom.roomCode && state.game?.phase === "VOTING",
        ),
      );

      expectSuccess(
        await submitDrawing(firstRoom.sockets[0]!, createValidDrawing()),
      );
      await Promise.all(firstVotingStates);
      await Promise.all(secondRoom.sockets.map(passSocketBarrier));

      expect(leakedStates).toEqual([]);
      const untouchedSecondRoom = server?.roomManager.getPublicRoomState(
        secondRoom.roomCode,
      );
      expect(untouchedSecondRoom?.game?.phase).toBe("DRAWING");
      expect(untouchedSecondRoom?.game?.submittedDrawing).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "annule une partie pendant DRAWING sans conserver de dessin public résiduel",
    async () => {
      const room = await prepareRoom("Cancel");
      room.sockets.map(collectSecrets);
      await startAndWaitForDrawing(room);
      const remainingSockets = room.sockets.slice(0, 2);
      const cancellations = remainingSockets.map(waitForGameCancellation);
      const lobbyStates = remainingSockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === room.roomCode &&
            state.playerCount === 2 &&
            state.game === null,
        ),
      );

      room.sockets[2]!.disconnect();
      const [receivedCancellations, receivedLobbyStates] = await Promise.all([
        Promise.all(cancellations),
        Promise.all(lobbyStates),
      ]);

      for (const cancellation of receivedCancellations) {
        expect(cancellation.reason).toBe("RECONNECT_TIMEOUT");
      }
      for (const state of receivedLobbyStates) {
        expect(state.game).toBeNull();
        expect(state.players.every((player) => !player.isReady)).toBe(true);
        expect(JSON.stringify(state)).not.toContain("submittedDrawing");
      }
      expect(
        server?.roomManager.getRoomByCode(room.roomCode)?.game,
      ).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );
});
