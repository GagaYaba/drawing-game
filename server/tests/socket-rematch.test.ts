import type { AddressInfo } from "node:net";

import {
  DRAWING_ALLOWED_STROKE_WIDTHS,
  DRAWING_ASPECT_RATIO,
  DRAWING_BACKGROUND_COLOR,
  DRAWING_COLOR_PALETTE,
  DRAWING_DOCUMENT_VERSION,
  SOCKET_EVENTS,
  type ActionAcknowledgement,
  type ActionResult,
  type ClientToServerEvents,
  type ContinueGameSuccessData,
  type DrawingDocument,
  type GameCancelledPayload,
  type PlayerSessionCredentials,
  type PublicGameState,
  type PublicRoomState,
  type RequestRematchSuccessData,
  type RoomErrorCode,
  type RoomSessionData,
  type ServerPongPayload,
  type ServerToClientEvents,
  type StartGameSuccessData,
  type SubmitDrawingSuccessData,
  type SubmitGuessSuccessData,
  type TurnSecretPayload,
} from "@drawing-game/shared";
import { io as createSocketClient, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDrawingGameServer } from "../src/create-server.js";
import { TEST_CLIENT_INSTANCE_ID } from "./test-client-instance.js";

type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;
type DrawingGameServer = ReturnType<typeof createDrawingGameServer>;

interface PreparedRoom {
  sockets: TestClient[];
  sessions: PlayerSessionCredentials[];
  roomCode: string;
}

const ASYNC_TIMEOUT_MS = 8_000;
const TEST_TIMEOUT_MS = 45_000;
const INTRO_DURATION_MS = 20;
const SECRET_LEVELS = [7, 4, 9, 2, 6, 8, 3, 5, 1, 10] as const;
const TEST_PROMPTS = Array.from({ length: 6 }, (_value, index) => ({
  id: `rematch-integration-prompt-${index + 1}`,
  statement: `Représente le sujet ${index + 1} du niveau 10 au niveau 1.`,
  lowLabel: `Niveau bas ${index + 1}`,
  highLabel: `Niveau haut ${index + 1}`,
  category: "rematch-integration",
}));

let server: DrawingGameServer | undefined;
let serverUrl = "";
let clients: TestClient[] = [];

function createDrawing(): DrawingDocument {
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
          { x: 0.5, y: 0.6 },
          { x: 0.9, y: 0.8 },
        ],
      },
    ],
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
    socket.emit(
      SOCKET_EVENTS.ROOM_CREATE,
      { nickname, clientInstanceId: TEST_CLIENT_INSTANCE_ID },
      acknowledge,
    );
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
      {
        nickname,
        roomCode,
        clientInstanceId: TEST_CLIENT_INSTANCE_ID,
      },
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

function continueGame(
  socket: TestClient,
): Promise<ActionResult<ContinueGameSuccessData>> {
  return waitForAcknowledgement((acknowledge) => {
    socket.emit(SOCKET_EVENTS.GAME_CONTINUE, acknowledge);
  });
}

function requestRematch(
  socket: TestClient,
): Promise<ActionResult<RequestRematchSuccessData>> {
  return waitForAcknowledgement((acknowledge) => {
    socket.emit(SOCKET_EVENTS.GAME_REQUEST_REMATCH, acknowledge);
  });
}

function requestRematchWithArguments(
  socket: TestClient,
  ...payloadArguments: unknown[]
): Promise<ActionResult<RequestRematchSuccessData>> {
  return waitForAcknowledgement((acknowledge) => {
    Reflect.apply(socket.emit, socket, [
      SOCKET_EVENTS.GAME_REQUEST_REMATCH,
      ...payloadArguments,
      acknowledge,
    ]);
  });
}

function leaveRoom(socket: TestClient): Promise<ActionResult<null>> {
  return waitForAcknowledgement((acknowledge) => {
    socket.emit(SOCKET_EVENTS.ROOM_LEAVE, acknowledge);
  });
}

function submitDrawing(
  socket: TestClient,
): Promise<ActionResult<SubmitDrawingSuccessData>> {
  return waitForAcknowledgement((acknowledge) => {
    socket.emit(
      SOCKET_EVENTS.DRAWING_SUBMIT,
      { drawing: createDrawing() },
      acknowledge,
    );
  });
}

function submitGuess(
  socket: TestClient,
  turnId: string,
  value: number,
): Promise<ActionResult<SubmitGuessSuccessData>> {
  return waitForAcknowledgement((acknowledge) => {
    socket.emit(
      SOCKET_EVENTS.GUESS_SUBMIT,
      { turnId, value },
      acknowledge,
    );
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

function collectTurnSecrets(socket: TestClient): {
  secrets: TurnSecretPayload[];
  stop: () => void;
} {
  const secrets: TurnSecretPayload[] = [];
  const handleSecret = (secret: TurnSecretPayload): void => {
    secrets.push(secret);
  };
  socket.on(SOCKET_EVENTS.TURN_SECRET, handleSecret);

  return {
    secrets,
    stop: () => socket.off(SOCKET_EVENTS.TURN_SECRET, handleSecret),
  };
}

function collectRoomStates(socket: TestClient): {
  states: PublicRoomState[];
  stop: () => void;
} {
  const states: PublicRoomState[] = [];
  const handleState = (state: PublicRoomState): void => {
    states.push(state);
  };
  socket.on(SOCKET_EVENTS.ROOM_STATE, handleState);

  return {
    states,
    stop: () => socket.off(SOCKET_EVENTS.ROOM_STATE, handleState),
  };
}

function collectCancellations(socket: TestClient): {
  cancellations: GameCancelledPayload[];
  stop: () => void;
} {
  const cancellations: GameCancelledPayload[] = [];
  const handleCancellation = (payload: GameCancelledPayload): void => {
    cancellations.push(payload);
  };
  socket.on(SOCKET_EVENTS.GAME_CANCELLED, handleCancellation);

  return {
    cancellations,
    stop: () =>
      socket.off(SOCKET_EVENTS.GAME_CANCELLED, handleCancellation),
  };
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
    throw new Error("Une partie publique était attendue.");
  }
  expect(room.game.phase).toBe(expectedPhase);
  return room.game;
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
  const sessions = [
    hostSession.session,
    expectSuccess(
      await joinRoom(
        sockets[1]!,
        `${nicknamePrefix}2`,
        hostSession.session.roomCode,
      ),
    ).session,
    expectSuccess(
      await joinRoom(
        sockets[2]!,
        `${nicknamePrefix}3`,
        hostSession.session.roomCode,
      ),
    ).session,
  ];

  for (const socket of sockets) {
    expectSuccess(await setReady(socket));
  }

  return {
    sockets,
    sessions,
    roomCode: hostSession.session.roomCode,
  };
}

async function waitForDrawingTurn(
  room: PreparedRoom,
  startTurn: () => Promise<ActionResult<StartGameSuccessData | ContinueGameSuccessData>>,
  turnNumber: number,
): Promise<PublicRoomState[]> {
  const drawingStates = room.sockets.map((socket) =>
    waitForRoomState(
      socket,
      (state) =>
        state.code === room.roomCode &&
        state.game?.phase === "DRAWING" &&
        state.game.currentTurnNumber === turnNumber,
    ),
  );
  expectSuccess(await startTurn());
  return Promise.all(drawingStates);
}

async function revealDrawingTurn(
  room: PreparedRoom,
  drawingState: PublicRoomState,
): Promise<PublicRoomState[]> {
  const drawingGame = expectGame(drawingState, "DRAWING");
  const internalTurn = server?.roomManager.getRoomByCode(room.roomCode)?.game
    ?.currentTurn;
  if (
    internalTurn === undefined ||
    internalTurn.turnId !== drawingGame.turnId
  ) {
    throw new Error("Le secret interne du tour devrait être disponible.");
  }
  const drawerIndex = room.sessions.findIndex(
    (session) => session.playerId === drawingGame.currentDrawer.id,
  );
  if (drawerIndex < 0) {
    throw new Error("Le dessinateur devrait appartenir au salon.");
  }

  const revealStates = room.sockets.map((socket) =>
    waitForRoomState(
      socket,
      (state) =>
        state.code === room.roomCode &&
        state.game?.phase === "REVEAL" &&
        state.game.turnId === drawingGame.turnId,
    ),
  );
  expectSuccess(await submitDrawing(room.sockets[drawerIndex]!));

  for (let index = 0; index < room.sockets.length; index += 1) {
    if (index === drawerIndex) {
      continue;
    }
    expectSuccess(
      await submitGuess(
        room.sockets[index]!,
        drawingGame.turnId,
        internalTurn.secretLevel,
      ),
    );
  }

  return Promise.all(revealStates);
}

async function finishRemainingGame(
  room: PreparedRoom,
  alreadyRevealedTurns = 0,
): Promise<PublicRoomState[]> {
  for (
    let turnNumber = alreadyRevealedTurns + 1;
    turnNumber <= room.sessions.length * 2;
    turnNumber += 1
  ) {
    const drawingStates = await waitForDrawingTurn(
      room,
      () =>
        turnNumber === 1
          ? startGame(room.sockets[0]!)
          : continueGame(room.sockets[0]!),
      turnNumber,
    );
    await revealDrawingTurn(room, drawingStates[0]!);
  }

  const finishedStates = room.sockets.map((socket) =>
    waitForRoomState(
      socket,
      (state) =>
        state.code === room.roomCode &&
        state.game?.phase === "FINISHED",
    ),
  );
  expectSuccess(await continueGame(room.sockets[0]!));
  return Promise.all(finishedStates);
}

beforeEach(async () => {
  clients = [];
  let gameIdIndex = 0;
  let turnIdIndex = 0;
  let secretIndex = 0;
  let shuffleCallIndex = 0;
  const createdServer = createDrawingGameServer({
    serveClient: false,
    reconnectGraceMs: 0,
    gameManagerOptions: {
      introDurationMs: INTRO_DURATION_MS,
      prompts: TEST_PROMPTS,
      generateGameId: () => `game-${++gameIdIndex}`,
      generateTurnId: () => `turn-${++turnIdIndex}`,
      generateSecretLevel: () =>
        SECRET_LEVELS[secretIndex++ % SECRET_LEVELS.length]!,
      selectPrompt: (prompts) => prompts[0]!,
      shufflePlayerIds: (playerIds) => {
        const shift = shuffleCallIndex++ % playerIds.length;
        return [...playerIds.slice(shift), ...playerIds.slice(0, shift)];
      },
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

describe("Socket.IO rematch integration", () => {
  it(
    "termine une partie, remet le même salon au lobby puis relance avec de nouveaux identifiants et un seul secret privé",
    async () => {
      const room = await prepareRoom("Revanche");
      const originalPlayerIds = room.sessions.map((session) => session.playerId);
      const firstSecretCollectors = room.sockets.map(collectTurnSecrets);
      const finishedStates = await finishRemainingGame(room);
      await Promise.all(room.sockets.map(passSocketBarrier));
      firstSecretCollectors.forEach((collector) => collector.stop());

      const finishedRoom = finishedStates[0]!;
      const finishedGame = expectGame(finishedRoom, "FINISHED");
      const firstGameId = finishedGame.gameId;
      const firstGameSecrets = firstSecretCollectors
        .flatMap((collector) => collector.secrets)
        .filter((secret) => secret.gameId === firstGameId);
      const firstTurnId = firstGameSecrets[0]?.turnId;
      const firstSecretLevel = firstGameSecrets[0]?.secretLevel;

      for (const state of finishedStates) {
        expect(state).toEqual(finishedRoom);
      }
      expect(finishedRoom.players.every((player) => player.score > 0)).toBe(
        true,
      );
      expect(firstGameSecrets).toHaveLength(room.sessions.length * 2);
      expect(new Set(firstGameSecrets.map((secret) => secret.turnId)).size).toBe(
        room.sessions.length * 2,
      );
      expect(firstTurnId).toBeDefined();
      expect(firstSecretLevel).toBeDefined();

      const lobbyStates = room.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === room.roomCode &&
            state.game === null &&
            state.players.every(
              (player) => player.score === 0 && !player.isReady,
            ),
        ),
      );
      const rematch = expectSuccess(
        await requestRematch(room.sockets[0]!),
      );
      const receivedLobbyStates = await Promise.all(lobbyStates);

      expect(rematch.room.code).toBe(room.roomCode);
      expect(rematch.room.players.map((player) => player.id)).toEqual(
        originalPlayerIds,
      );
      expect(rematch.room.game).toBeNull();
      expect(rematch.room.allPlayersReady).toBe(false);
      expect(rematch.room.canStart).toBe(false);
      for (const state of receivedLobbyStates) {
        expect(state).toEqual(rematch.room);
      }

      for (const socket of room.sockets) {
        expectSuccess(await setReady(socket));
      }

      const secondSecretCollectors = room.sockets.map(collectTurnSecrets);
      const introStates = room.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === room.roomCode &&
            state.game?.phase === "ROUND_INTRO",
        ),
      );
      const secondStart = expectSuccess(await startGame(room.sockets[0]!));
      const receivedIntroStates = await Promise.all(introStates);
      await Promise.all(room.sockets.map(passSocketBarrier));
      secondSecretCollectors.forEach((collector) => collector.stop());

      const secondGame = expectGame(secondStart.room, "ROUND_INTRO");
      expect(secondGame.gameId).not.toBe(firstGameId);
      expect(secondGame.turnId).not.toBe(firstTurnId);
      expect(secondGame.reveal).toBeNull();
      expect(secondGame.finished).toBeNull();
      expect(secondGame.submittedDrawing).toBeNull();
      expect(secondStart.room.players.map((player) => player.id)).toEqual(
        originalPlayerIds,
      );
      expect(
        secondStart.room.players.every((player) => player.score === 0),
      ).toBe(true);
      for (const state of receivedIntroStates) {
        expect(state).toEqual(secondStart.room);
      }

      const receivedSecrets = secondSecretCollectors.flatMap(
        (collector, index) =>
          collector.secrets.map((secret) => ({ index, secret })),
      );
      expect(receivedSecrets).toHaveLength(1);
      expect(receivedSecrets[0]?.secret).toMatchObject({
        roomCode: room.roomCode,
        gameId: secondGame.gameId,
        turnId: secondGame.turnId,
        drawerPlayerId: secondGame.currentDrawer.id,
      });
      expect(receivedSecrets[0]?.secret.secretLevel).not.toBe(
        firstSecretLevel,
      );
      expect(room.sessions[receivedSecrets[0]!.index]!.playerId).toBe(
        secondGame.currentDrawer.id,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "acknowledge les refus d'autorisation, de phase, de payload et la double demande sans casser les sockets",
    async () => {
      const outsider = await connectClient();
      expectError(await requestRematch(outsider), "NOT_IN_ROOM");

      const room = await prepareRoom("Refus");
      expectError(
        await requestRematch(room.sockets[0]!),
        "GAME_NOT_STARTED",
      );

      const firstDrawingStates = await waitForDrawingTurn(
        room,
        () => startGame(room.sockets[0]!),
        1,
      );
      const firstRevealStates = await revealDrawingTurn(
        room,
        firstDrawingStates[0]!,
      );
      expectGame(firstRevealStates[0]!, "REVEAL");

      expectError(
        await requestRematch(room.sockets[0]!),
        "GAME_NOT_FINISHED",
      );
      expectError(
        await requestRematch(room.sockets[1]!),
        "NOT_HOST",
      );
      expectError(
        await requestRematchWithArguments(room.sockets[0]!, {
          gameId: "client-controlled",
        }),
        "INVALID_GAME_REMATCH_REQUEST",
      );

      await finishRemainingGame(room, 1);
      expectError(
        await requestRematch(room.sockets[1]!),
        "NOT_HOST",
      );

      const results = await Promise.all([
        requestRematch(room.sockets[0]!),
        requestRematch(room.sockets[0]!),
      ]);
      const success = results.find((result) => result.success);
      const failure = results.find((result) => !result.success);
      if (success === undefined || failure === undefined) {
        throw new Error(
          "Une demande devait réussir et la seconde être refusée.",
        );
      }
      expectSuccess(success).room.players.forEach((player) => {
        expect(player.score).toBe(0);
        expect(player.isReady).toBe(false);
      });
      expectError(failure, "GAME_NOT_STARTED");
      expect(room.sockets.every((socket) => socket.connected)).toBe(true);
      expect(outsider.connected).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "conserve FINISHED, les scores et le classement historique après la déconnexion d'un non-hôte",
    async () => {
      const room = await prepareRoom("Départ");
      const finishedRoom = (await finishRemainingGame(room))[0]!;
      const finishedGame = expectGame(finishedRoom, "FINISHED");
      const historicalFinished = structuredClone(finishedGame.finished);
      const departingPlayerId = room.sessions[1]!.playerId;
      const remainingScores = finishedRoom.players
        .filter((player) => player.id !== departingPlayerId)
        .map(({ id, score }) => ({ id, score }));
      const remainingSockets = [room.sockets[0]!, room.sockets[2]!];
      const cancellationCollectors =
        remainingSockets.map(collectCancellations);
      const remainingStates = remainingSockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === room.roomCode &&
            state.playerCount === 2 &&
            state.game?.phase === "FINISHED",
        ),
      );

      room.sockets[1]!.disconnect();
      const receivedStates = await Promise.all(remainingStates);
      await Promise.all(remainingSockets.map(passSocketBarrier));
      cancellationCollectors.forEach((collector) => collector.stop());

      for (const state of receivedStates) {
        expect(state.game?.finished).toEqual(historicalFinished);
        expect(
          state.players.map(({ id, score }) => ({ id, score })),
        ).toEqual(remainingScores);
        expect(
          state.game?.finished?.leaderboard.some(
            (entry) => entry.player.id === departingPlayerId,
          ),
        ).toBe(true);
      }
      expect(
        cancellationCollectors.every(
          (collector) => collector.cancellations.length === 0,
        ),
      ).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "transfère l'hôte pendant FINISHED, autorise sa revanche et supprime ensuite le salon au départ du dernier joueur",
    async () => {
      const room = await prepareRoom("Hôte");
      await finishRemainingGame(room);
      const remainingSockets = [room.sockets[1]!, room.sockets[2]!];
      const transferredStates = remainingSockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === room.roomCode &&
            state.playerCount === 2 &&
            state.game?.phase === "FINISHED" &&
            state.players.some(
              (player) =>
                player.id === room.sessions[1]!.playerId && player.isHost,
            ),
        ),
      );

      room.sockets[0]!.disconnect();
      const receivedTransferredStates = await Promise.all(transferredStates);
      for (const state of receivedTransferredStates) {
        expect(state.players.filter((player) => player.isHost)).toEqual([
          expect.objectContaining({
            id: room.sessions[1]!.playerId,
          }),
        ]);
      }

      const lobbyStates = remainingSockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === room.roomCode &&
            state.playerCount === 2 &&
            state.game === null,
        ),
      );
      const rematch = expectSuccess(
        await requestRematch(room.sockets[1]!),
      );
      await Promise.all(lobbyStates);
      expect(rematch.room.players.find((player) => player.isHost)?.id).toBe(
        room.sessions[1]!.playerId,
      );

      const lastPlayerState = waitForRoomState(
        room.sockets[2]!,
        (state) =>
          state.code === room.roomCode &&
          state.playerCount === 1 &&
          state.players[0]?.id === room.sessions[2]!.playerId,
      );
      expectSuccess(await leaveRoom(room.sockets[1]!));
      await lastPlayerState;
      expectSuccess(await leaveRoom(room.sockets[2]!));
      expect(server?.roomManager.getRoomByCode(room.roomCode)).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "isole la revanche d'un salon et laisse un second salon terminé strictement inchangé",
    async () => {
      const firstRoom = await prepareRoom("Alpha");
      const firstFinished = (await finishRemainingGame(firstRoom))[0]!;
      const secondRoom = await prepareRoom("Beta");
      const secondFinished = (await finishRemainingGame(secondRoom))[0]!;
      await Promise.all(
        [...firstRoom.sockets, ...secondRoom.sockets].map(passSocketBarrier),
      );
      const secondCollectors =
        secondRoom.sockets.map(collectRoomStates);
      const firstLobbyStates = firstRoom.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === firstRoom.roomCode && state.game === null,
        ),
      );

      const rematch = expectSuccess(
        await requestRematch(firstRoom.sockets[0]!),
      );
      await Promise.all(firstLobbyStates);
      await Promise.all(secondRoom.sockets.map(passSocketBarrier));
      secondCollectors.forEach((collector) => collector.stop());

      expect(rematch.room.code).toBe(firstRoom.roomCode);
      expect(rematch.room.game).toBeNull();
      expect(rematch.room.players.map((player) => player.id)).toEqual(
        firstFinished.players.map((player) => player.id),
      );
      expect(
        secondCollectors.every((collector) => collector.states.length === 0),
      ).toBe(true);
      expect(
        server?.roomManager.getPublicRoomState(secondRoom.roomCode),
      ).toEqual(secondFinished);
    },
    TEST_TIMEOUT_MS,
  );
});
