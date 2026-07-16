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
  type PublicRoomState,
  type RequestRematchSuccessData,
  type RestoreSessionPayload,
  type RestoreSessionSuccessData,
  type RoomErrorCode,
  type RoomSessionData,
  type ServerToClientEvents,
  type StartGameSuccessData,
  type SubmitDrawingSuccessData,
  type SubmitGuessSuccessData,
} from "@drawing-game/shared";
import { io as createSocketClient, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDrawingGameServer } from "../src/create-server.js";

type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;
type DrawingGameServer = ReturnType<typeof createDrawingGameServer>;

interface PreparedRoom {
  roomCode: string;
  sockets: TestClient[];
  sessions: RoomSessionData["session"][];
}

const ASYNC_TIMEOUT_MS = 3_000;
const TEST_TIMEOUT_MS = 20_000;
const RECONNECT_GRACE_MS = 500;
const INTRO_DURATION_MS = 250;
const DRAWING: DrawingDocument = {
  version: DRAWING_DOCUMENT_VERSION,
  aspectRatio: DRAWING_ASPECT_RATIO,
  backgroundColor: DRAWING_BACKGROUND_COLOR,
  strokes: [
    {
      tool: "pen",
      color: DRAWING_COLOR_PALETTE[0]!,
      width: DRAWING_ALLOWED_STROKE_WIDTHS[0]!,
      points: [
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.8 },
      ],
    },
  ],
};

let server: DrawingGameServer | undefined;
let serverUrl = "";
let clients: TestClient[] = [];

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

function expectSuccess<T>(result: ActionResult<T>): T {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error(`Expected success, received ${result.error.code}`);
  }
  return result.data;
}

function expectError<T>(
  result: ActionResult<T>,
  expectedCode: RoomErrorCode,
): void {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected an error acknowledgement");
  }
  expect(result.error.code).toBe(expectedCode);
  expect(result.error.message.length).toBeGreaterThan(0);
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

function restoreSession(
  socket: TestClient,
  session: RestoreSessionPayload,
): Promise<ActionResult<RestoreSessionSuccessData>> {
  return waitForAcknowledgement((acknowledge) => {
    socket.emit(SOCKET_EVENTS.SESSION_RESTORE, session, acknowledge);
  });
}

function setReady(
  socket: TestClient,
  isReady: boolean,
): Promise<ActionResult<PublicRoomState>> {
  return waitForAcknowledgement((acknowledge) => {
    socket.emit(
      SOCKET_EVENTS.PLAYER_SET_READY,
      { isReady },
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
): Promise<ActionResult<SubmitDrawingSuccessData>> {
  return waitForAcknowledgement((acknowledge) => {
    socket.emit(
      SOCKET_EVENTS.DRAWING_SUBMIT,
      { drawing: DRAWING },
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

function leaveRoom(socket: TestClient): Promise<ActionResult<null>> {
  return waitForAcknowledgement((acknowledge) => {
    socket.emit(SOCKET_EVENTS.ROOM_LEAVE, acknowledge);
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

function waitForCancellation(
  socket: TestClient,
): Promise<GameCancelledPayload> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off(SOCKET_EVENTS.GAME_CANCELLED, handleCancellation);
    };
    const handleCancellation = (
      payload: GameCancelledPayload,
    ): void => {
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
      socket.off("connect_error", handleError);
    };
    const handleConnect = (): void => {
      cleanup();
      resolve();
    };
    const handleError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out connecting Socket.IO client"));
    }, ASYNC_TIMEOUT_MS);

    socket.on("connect", handleConnect);
    socket.on("connect_error", handleError);
    socket.connect();
  });

  return socket;
}

async function prepareRoom(playerCount = 3): Promise<PreparedRoom> {
  const sockets: TestClient[] = [];
  for (let index = 0; index < playerCount; index += 1) {
    sockets.push(await connectClient());
  }

  const host = expectSuccess(await createRoom(sockets[0]!, "J1"));
  const sessions = [host.session];

  for (let index = 1; index < playerCount; index += 1) {
    sessions.push(
      expectSuccess(
        await joinRoom(
          sockets[index]!,
          `J${index + 1}`,
          host.session.roomCode,
        ),
      ).session,
    );
  }

  return {
    roomCode: host.session.roomCode,
    sockets,
    sessions,
  };
}

async function readyAndStart(room: PreparedRoom): Promise<PublicRoomState> {
  for (const socket of room.sockets) {
    expectSuccess(await setReady(socket, true));
  }
  expectSuccess(await startGame(room.sockets[0]!));
  return waitForPhase(room, "DRAWING");
}

async function waitForPhase(
  room: PreparedRoom,
  phase: NonNullable<PublicRoomState["game"]>["phase"],
): Promise<PublicRoomState> {
  if (server === undefined) {
    throw new Error("Le serveur de test est absent.");
  }

  const current = server.roomManager.getPublicRoomState(room.roomCode);
  if (current.game?.phase === phase) {
    return current;
  }

  const observer = room.sockets.find((socket) => socket.connected);
  if (observer === undefined) {
    throw new Error("Aucun observateur connecté n’est disponible.");
  }

  return waitForRoomState(
    observer,
    (state) =>
      state.code === room.roomCode && state.game?.phase === phase,
  );
}

function socketForPlayer(
  room: PreparedRoom,
  playerId: string,
): TestClient {
  const playerIndex = room.sessions.findIndex(
    (session) => session.playerId === playerId,
  );
  const socket = room.sockets[playerIndex];

  if (socket === undefined) {
    throw new Error("Le socket du joueur est introuvable.");
  }

  return socket;
}

async function enterVoting(
  room: PreparedRoom,
): Promise<PublicRoomState> {
  const drawing = await readyAndStart(room);
  const drawerId = drawing.game?.currentDrawer.id;
  if (drawerId === undefined) {
    throw new Error("Le dessinateur est introuvable.");
  }
  return expectSuccess(
    await submitDrawing(socketForPlayer(room, drawerId)),
  ).room;
}

async function finishGame(room: PreparedRoom): Promise<PublicRoomState> {
  let state = await readyAndStart(room);

  while (state.game?.phase !== "FINISHED") {
    if (state.game?.phase === "ROUND_INTRO") {
      state = await waitForPhase(room, "DRAWING");
      continue;
    }

    if (state.game?.phase === "DRAWING") {
      state = expectSuccess(
        await submitDrawing(
          socketForPlayer(room, state.game.currentDrawer.id),
        ),
      ).room;
      continue;
    }

    if (state.game?.phase === "VOTING") {
      const drawerId = state.game.currentDrawer.id;
      for (let index = 0; index < room.sessions.length; index += 1) {
        if (room.sessions[index]!.playerId === drawerId) {
          continue;
        }
        expectSuccess(
          await submitGuess(
            room.sockets[index]!,
            state.game.turnId,
            7,
          ),
        );
      }
      if (server === undefined) {
        throw new Error("Le serveur de test est absent.");
      }
      state = server.roomManager.getPublicRoomState(room.roomCode);
      continue;
    }

    if (state.game?.phase === "REVEAL") {
      state = expectSuccess(await continueGame(room.sockets[0]!)).room;
      continue;
    }

    throw new Error(`Phase inattendue: ${state.game?.phase ?? "LOBBY"}`);
  }

  return state;
}

async function waitForDisconnectedPlayer(
  observer: TestClient,
  roomCode: string,
  playerId: string,
): Promise<PublicRoomState> {
  return waitForRoomState(
    observer,
    (state) =>
      state.code === roomCode &&
      state.players.some(
        (player) =>
          player.id === playerId && !player.isConnected,
      ),
  );
}

beforeEach(async () => {
  clients = [];
  let gameId = 0;
  let turnId = 0;
  const createdServer = createDrawingGameServer({
    serveClient: false,
    reconnectGraceMs: RECONNECT_GRACE_MS,
    gameManagerOptions: {
      introDurationMs: INTRO_DURATION_MS,
      generateGameId: () => `game-${++gameId}`,
      generateTurnId: () => `turn-${++turnId}`,
      shufflePlayerIds: (playerIds) => [...playerIds],
      selectPrompt: (prompts) => prompts[0]!,
      generateSecretLevel: () => 7,
    },
  });
  server = createdServer;

  await new Promise<void>((resolve, reject) => {
    createdServer.httpServer.once("error", reject);
    createdServer.httpServer.once("listening", resolve);
    createdServer.httpServer.listen(0, "127.0.0.1");
  });

  const address = createdServer.httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("Le serveur n’a pas exposé de port TCP.");
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

describe("Socket.IO session restoration", () => {
  it(
    "restaure le lobby, refuse le multi-onglet actif et isole les salons",
    async () => {
      const room = await prepareRoom(2);
      const otherRoom = await prepareRoom(1);
      const secondTab = await connectClient();
      const otherRoomBefore = structuredClone(
        server?.roomManager.getPublicRoomState(otherRoom.roomCode),
      );

      const activeResult = await restoreSession(
        secondTab,
        room.sessions[0]!,
      );
      expectError(activeResult, "SESSION_ALREADY_ACTIVE");
      if (!activeResult.success) {
        expect(activeResult.error.message).toBe(
          "Cette session est déjà ouverte dans un autre onglet.",
        );
      }

      const unrelatedStates: PublicRoomState[] = [];
      otherRoom.sockets[0]!.on(SOCKET_EVENTS.ROOM_STATE, (state) => {
        unrelatedStates.push(state);
      });
      const disconnectedState = waitForDisconnectedPlayer(
        room.sockets[1]!,
        room.roomCode,
        room.sessions[0]!.playerId,
      );
      room.sockets[0]!.disconnect();
      await disconnectedState;

      const restoredSocket = await connectClient();
      const restored = expectSuccess(
        await restoreSession(restoredSocket, room.sessions[0]!),
      );

      expect(restored.session).toEqual(room.sessions[0]);
      expect(restored.room.players[0]).toMatchObject({
        id: room.sessions[0]!.playerId,
        isHost: true,
        isConnected: true,
        reconnectDeadline: null,
      });
      expect(JSON.stringify(restored.room)).not.toContain(
        room.sessions[0]!.token,
      );
      expect(unrelatedStates).toEqual([]);
      expect(
        server?.roomManager.getPublicRoomState(otherRoom.roomCode),
      ).toEqual(otherRoomBefore);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "restaure le dessinateur pendant ROUND_INTRO sans interrompre la transition",
    async () => {
      const room = await prepareRoom();
      for (const socket of room.sockets) {
        expectSuccess(await setReady(socket, true));
      }
      const intro = expectSuccess(
        await startGame(room.sockets[0]!),
      ).room;
      expect(intro.game?.phase).toBe("ROUND_INTRO");

      const drawerId = intro.game!.currentDrawer.id;
      const drawerIndex = room.sessions.findIndex(
        (session) => session.playerId === drawerId,
      );
      const observer = room.sockets[(drawerIndex + 1) % room.sockets.length]!;
      const disconnectedState = waitForDisconnectedPlayer(
        observer,
        room.roomCode,
        drawerId,
      );
      room.sockets[drawerIndex]!.disconnect();
      await disconnectedState;

      const restoredSocket = await connectClient();
      const restored = expectSuccess(
        await restoreSession(
          restoredSocket,
          room.sessions[drawerIndex]!,
        ),
      );

      expect(restored.room.game?.phase).toBe("ROUND_INTRO");
      expect(restored.privateState).toMatchObject({
        gameId: intro.game!.gameId,
        turnId: intro.game!.turnId,
        secretLevel: 7,
        isCurrentDrawer: true,
      });
      const drawing = await waitForPhase(room, "DRAWING");
      expect(drawing.game?.turnId).toBe(intro.game?.turnId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "restaure le dessinateur, son secret et autorise le nouveau socket à soumettre",
    async () => {
      const room = await prepareRoom();
      const drawing = await readyAndStart(room);
      const drawerId = drawing.game!.currentDrawer.id;
      const drawerIndex = room.sessions.findIndex(
        (session) => session.playerId === drawerId,
      );
      const observer = room.sockets[(drawerIndex + 1) % room.sockets.length]!;
      const disconnectedState = waitForDisconnectedPlayer(
        observer,
        room.roomCode,
        drawerId,
      );
      room.sockets[drawerIndex]!.disconnect();
      await disconnectedState;

      const restoredSocket = await connectClient();
      const restored = expectSuccess(
        await restoreSession(
          restoredSocket,
          room.sessions[drawerIndex]!,
        ),
      );

      expect(restored.privateState).toMatchObject({
        gameId: drawing.game!.gameId,
        turnId: drawing.game!.turnId,
        secretLevel: 7,
        isCurrentDrawer: true,
      });
      const voting = expectSuccess(
        await submitDrawing(restoredSocket),
      ).room;
      expect(voting.game?.phase).toBe("VOTING");
      expect(voting.game?.turnId).toBe(drawing.game?.turnId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "restaure un votant avant puis après validation de son estimation",
    async () => {
      const room = await prepareRoom();
      const voting = await enterVoting(room);
      const voterIndex = 1;
      const observer = room.sockets[2]!;
      const disconnectedBeforeGuess = waitForDisconnectedPlayer(
        observer,
        room.roomCode,
        room.sessions[voterIndex]!.playerId,
      );
      room.sockets[voterIndex]!.disconnect();
      await disconnectedBeforeGuess;

      const firstRestoredSocket = await connectClient();
      const restoredBeforeGuess = expectSuccess(
        await restoreSession(
          firstRestoredSocket,
          room.sessions[voterIndex]!,
        ),
      );
      expect(restoredBeforeGuess.room.game?.phase).toBe("VOTING");
      expect(restoredBeforeGuess.privateState).toMatchObject({
        gameId: voting.game!.gameId,
        turnId: voting.game!.turnId,
        secretLevel: null,
        submittedGuess: null,
        isCurrentDrawer: false,
      });

      const submitted = expectSuccess(
        await submitGuess(
          firstRestoredSocket,
          voting.game!.turnId,
          5,
        ),
      );
      const disconnectedAfterGuess = waitForDisconnectedPlayer(
        observer,
        room.roomCode,
        room.sessions[voterIndex]!.playerId,
      );
      firstRestoredSocket.disconnect();
      await disconnectedAfterGuess;

      const secondRestoredSocket = await connectClient();
      const restoredAfterGuess = expectSuccess(
        await restoreSession(
          secondRestoredSocket,
          room.sessions[voterIndex]!,
        ),
      );

      expect(restoredAfterGuess.privateState.submittedGuess).toEqual(
        submitted,
      );
      expectError(
        await submitGuess(
          secondRestoredSocket,
          voting.game!.turnId,
          6,
        ),
        "GUESS_ALREADY_SUBMITTED",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "restaure l’hôte en REVEAL puis en FINISHED pour continuer et demander une revanche",
    async () => {
      const revealRoom = await prepareRoom();
      const voting = await enterVoting(revealRoom);
      const revealState = waitForRoomState(
        revealRoom.sockets[1]!,
        (state) => state.game?.phase === "REVEAL",
      );
      expectSuccess(
        await submitGuess(
          revealRoom.sockets[1]!,
          voting.game!.turnId,
          6,
        ),
      );
      expectSuccess(
        await submitGuess(
          revealRoom.sockets[2]!,
          voting.game!.turnId,
          8,
        ),
      );
      await revealState;
      const hostDisconnected = waitForDisconnectedPlayer(
        revealRoom.sockets[1]!,
        revealRoom.roomCode,
        revealRoom.sessions[0]!.playerId,
      );
      revealRoom.sockets[0]!.disconnect();
      await hostDisconnected;
      const restoredRevealHost = await connectClient();
      expectSuccess(
        await restoreSession(
          restoredRevealHost,
          revealRoom.sessions[0]!,
        ),
      );
      expect(
        expectSuccess(await continueGame(restoredRevealHost)).room.game
          ?.phase,
      ).toBe("ROUND_INTRO");

      const finishedRoom = await prepareRoom();
      const finished = await finishGame(finishedRoom);
      expect(finished.game?.phase).toBe("FINISHED");
      const finishedHostDisconnected = waitForDisconnectedPlayer(
        finishedRoom.sockets[1]!,
        finishedRoom.roomCode,
        finishedRoom.sessions[0]!.playerId,
      );
      finishedRoom.sockets[0]!.disconnect();
      await finishedHostDisconnected;
      const restoredFinishedHost = await connectClient();
      expectSuccess(
        await restoreSession(
          restoredFinishedHost,
          finishedRoom.sessions[0]!,
        ),
      );
      const rematch = expectSuccess(
        await requestRematch(restoredFinishedHost),
      );
      expect(rematch.room.game).toBeNull();
      expect(rematch.room.players.map((player) => player.id)).toEqual(
        finishedRoom.sessions.map((session) => session.playerId),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "expire l’hôte en FINISHED sans perdre le classement et transfère son rôle",
    async () => {
      const room = await prepareRoom();
      const finished = await finishGame(room);
      const historicalFinished = structuredClone(finished.game?.finished);
      const expiredHostId = room.sessions[0]!.playerId;
      const nextHostId = room.sessions[1]!.playerId;
      const expiredState = waitForRoomState(
        room.sockets[1]!,
        (state) =>
          state.code === room.roomCode &&
          state.playerCount === 2 &&
          state.game?.phase === "FINISHED",
      );

      room.sockets[0]!.disconnect();
      const afterExpiration = await expiredState;

      expect(afterExpiration.game?.finished).toEqual(historicalFinished);
      expect(
        afterExpiration.players.some(
          (player) => player.id === expiredHostId,
        ),
      ).toBe(false);
      expect(
        afterExpiration.players.find(
          (player) => player.id === nextHostId,
        ),
      ).toMatchObject({
        isHost: true,
        isConnected: true,
      });
      expect(afterExpiration.game?.finished?.leaderboard).toContainEqual(
        expect.objectContaining({
          player: expect.objectContaining({ id: expiredHostId }),
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "expire avec RECONNECT_TIMEOUT et invalide immédiatement un départ volontaire",
    async () => {
      const activeRoom = await prepareRoom();
      await readyAndStart(activeRoom);
      const remainingSockets = activeRoom.sockets.slice(0, 2);
      const cancellations = remainingSockets.map(waitForCancellation);
      const lobbyStates = remainingSockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === activeRoom.roomCode &&
            state.playerCount === 2 &&
            state.game === null,
        ),
      );
      activeRoom.sockets[2]!.disconnect();

      const receivedCancellations = await Promise.all(cancellations);
      const receivedLobbyStates = await Promise.all(lobbyStates);
      expect(
        receivedCancellations.every(
          (cancellation) =>
            cancellation.reason === "RECONNECT_TIMEOUT",
        ),
      ).toBe(true);
      expect(
        receivedLobbyStates.every(
          (state) =>
            state.players.every((player) => !player.isReady) &&
            state.players.every((player) => player.score === 0),
        ),
      ).toBe(true);

      const lobbyRoom = await prepareRoom(2);
      expectSuccess(await leaveRoom(lobbyRoom.sockets[1]!));
      const replacement = await connectClient();
      expectError(
        await restoreSession(replacement, lobbyRoom.sessions[1]!),
        "PLAYER_NOT_FOUND",
      );
    },
    TEST_TIMEOUT_MS,
  );
});
