import type { AddressInfo } from "node:net";

import {
  SOCKET_EVENTS,
  type ActionAcknowledgement,
  type ActionResult,
  type ClientToServerEvents,
  type GameCancelledPayload,
  type PublicGameState,
  type PublicRoomState,
  type RoomErrorCode,
  type RoomSessionData,
  type ServerPongPayload,
  type ServerToClientEvents,
  type StartGameSuccessData,
  type TurnSecretPayload,
} from "@drawing-game/shared";
import { io as createSocketClient, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDrawingGameServer } from "../src/create-server.js";

type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;
type DrawingGameServer = ReturnType<typeof createDrawingGameServer>;

interface PreparedRoom {
  sockets: TestClient[];
  sessions: RoomSessionData[];
  roomCode: string;
}

const ASYNC_TIMEOUT_MS = 3_000;
const TEST_TIMEOUT_MS = 10_000;
const INTRO_DURATION_MS = 60;
const SECRET_LEVEL = 7;
const TEST_PROMPT = {
  id: "integration-prompt",
  statement:
    "Représente une montagne de la plus imposante (10) à la moins imposante (1).",
  lowLabel: "Moins imposante",
  highLabel: "Plus imposante",
  category: "integration",
} as const;

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

function startGameWithPayload(
  socket: TestClient,
  ...payloads: unknown[]
): Promise<ActionResult<StartGameSuccessData>> {
  return waitForAcknowledgement((acknowledge) => {
    Reflect.apply(socket.emit, socket, [
      SOCKET_EVENTS.GAME_START,
      ...payloads,
      acknowledge,
    ]);
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
    throw new Error("Expected an action error, received success");
  }

  expect(result.error.code).toBe(expectedCode);
  expect(result.error.message.length).toBeGreaterThan(0);
}

function expectGame(
  room: PublicRoomState,
  expectedPhase?: PublicGameState["phase"],
): PublicGameState {
  expect(room.game).not.toBeNull();

  if (room.game === null) {
    throw new Error("Expected a public game state");
  }

  if (expectedPhase !== undefined) {
    expect(room.game.phase).toBe(expectedPhase);
  }

  return room.game;
}

function expectNoSecretInPublicPayload(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain('"secretLevel"');
  expect(serialized).not.toContain('"drawerSocketId"');
  expect(serialized).not.toContain('"socketId"');
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

async function prepareRoom(
  playerCount: number,
  readyPlayerCount: number,
  nicknamePrefix: string,
): Promise<PreparedRoom> {
  const sockets: TestClient[] = [];
  for (let index = 0; index < playerCount; index += 1) {
    sockets.push(await connectClient());
  }

  const hostSession = expectSuccess(
    await createRoom(sockets[0]!, `${nicknamePrefix}1`),
  );
  const sessions = [hostSession];

  for (let index = 1; index < sockets.length; index += 1) {
    sessions.push(
      expectSuccess(
        await joinRoom(
          sockets[index]!,
          `${nicknamePrefix}${index + 1}`,
          hostSession.roomCode,
        ),
      ),
    );
  }

  for (let index = 0; index < readyPlayerCount; index += 1) {
    expectSuccess(await setReady(sockets[index]!, true));
  }

  return { sockets, sessions, roomCode: hostSession.roomCode };
}

beforeEach(async () => {
  clients = [];
  const createdServer = createDrawingGameServer({
    serveClient: false,
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

describe("Socket.IO game integration", () => {
  it(
    "starts with three ready players and sends the secret only to the drawer",
    async () => {
      const room = await prepareRoom(3, 3, "Start");
      const secretEvents = room.sockets.map(collectSecrets);
      const introStates = room.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === room.roomCode &&
            state.game?.phase === "ROUND_INTRO",
        ),
      );

      const acknowledgement = expectSuccess(await startGame(room.sockets[0]!));
      const states = await Promise.all(introStates);
      await Promise.all(room.sockets.map(passSocketBarrier));

      const acknowledgedGame = expectGame(
        acknowledgement.room,
        "ROUND_INTRO",
      );
      expect(acknowledgedGame).toMatchObject({
        totalRounds: 2,
        currentRound: 1,
        currentTurnNumber: 1,
        totalTurns: 6,
        prompt: {
          id: TEST_PROMPT.id,
          statement: TEST_PROMPT.statement,
          lowLabel: TEST_PROMPT.lowLabel,
          highLabel: TEST_PROMPT.highLabel,
        },
      });

      for (const state of states) {
        const game = expectGame(state, "ROUND_INTRO");
        expect(state).toEqual(acknowledgement.room);
        expect(game.currentDrawer).toEqual(acknowledgedGame.currentDrawer);
        expect(game.prompt).toEqual(acknowledgedGame.prompt);
        expectNoSecretInPublicPayload(state);
      }
      expectNoSecretInPublicPayload(acknowledgement);

      const drawerIndex = room.sessions.findIndex(
        (session) =>
          session.playerId === acknowledgedGame.currentDrawer.id,
      );
      expect(drawerIndex).toBeGreaterThanOrEqual(0);
      expect(secretEvents.flat()).toHaveLength(1);

      for (const [index, receivedSecrets] of secretEvents.entries()) {
        if (index === drawerIndex) {
          expect(receivedSecrets).toEqual([
            {
              roomCode: room.roomCode,
              turnId: acknowledgedGame.turnId,
              drawerPlayerId: acknowledgedGame.currentDrawer.id,
              secretLevel: SECRET_LEVEL,
            },
          ]);
        } else {
          expect(receivedSecrets).toEqual([]);
        }
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects a start request from a non-host",
    async () => {
      const room = await prepareRoom(3, 3, "Guest");

      expectError(await startGame(room.sockets[1]!), "NOT_HOST");
      expect(server?.roomManager.getPublicRoomState(room.roomCode).game).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "acknowledges an invalid game:start payload without breaking the socket",
    async () => {
      const socket = await connectClient();

      expectError(
        await startGameWithPayload(
          socket,
          { forgedHost: true },
          { forgedRoom: "ABCDE" },
        ),
        "INVALID_GAME_START_REQUEST",
      );
      expect(socket.connected).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects a start request with only two players",
    async () => {
      const room = await prepareRoom(2, 2, "Two");

      expectError(
        await startGame(room.sockets[0]!),
        "NOT_ENOUGH_PLAYERS",
      );
      expect(server?.roomManager.getPublicRoomState(room.roomCode).game).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects a start request while one player is not ready",
    async () => {
      const room = await prepareRoom(3, 2, "Ready");

      expectError(
        await startGame(room.sockets[0]!),
        "PLAYERS_NOT_READY",
      );
      expect(server?.roomManager.getPublicRoomState(room.roomCode).game).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects a second start after the game has begun",
    async () => {
      const room = await prepareRoom(3, 3, "Double");
      room.sockets.map(collectSecrets);
      const introState = waitForRoomState(
        room.sockets[0]!,
        (state) => state.game?.phase === "ROUND_INTRO",
      );

      const firstStart = expectSuccess(await startGame(room.sockets[0]!));
      await introState;
      expectError(
        await startGame(room.sockets[0]!),
        "GAME_ALREADY_STARTED",
      );

      const currentRoom = server?.roomManager.getPublicRoomState(room.roomCode);
      expect(currentRoom?.game?.currentDrawer).toEqual(
        firstStart.room.game?.currentDrawer,
      );
      expect(currentRoom?.game?.prompt).toEqual(firstStart.room.game?.prompt);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "transitions from ROUND_INTRO to DRAWING with a short real timer",
    async () => {
      const room = await prepareRoom(3, 3, "Phase");
      room.sockets.map(collectSecrets);
      const introStates = room.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) => state.game?.phase === "ROUND_INTRO",
        ),
      );
      const drawingStates = room.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) => state.game?.phase === "DRAWING",
        ),
      );

      const acknowledgement = expectSuccess(await startGame(room.sockets[0]!));
      const intro = await Promise.all(introStates);
      const drawing = await Promise.all(drawingStates);
      const initialGame = expectGame(
        acknowledgement.room,
        "ROUND_INTRO",
      );

      expect(initialGame.phaseEndsAt).not.toBeNull();
      for (const state of intro) {
        expect(state.game).toEqual(initialGame);
      }
      for (const state of drawing) {
        const game = expectGame(state, "DRAWING");
        expect(game.currentDrawer).toEqual(initialGame.currentDrawer);
        expect(game.prompt).toEqual(initialGame.prompt);
        expect(game.phaseEndsAt).toBeNull();
        expectNoSecretInPublicPayload(state);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses new joins after the game has started",
    async () => {
      const room = await prepareRoom(3, 3, "Closed");
      const newcomer = await connectClient();
      room.sockets.map(collectSecrets);
      const introState = waitForRoomState(
        room.sockets[0]!,
        (state) => state.game?.phase === "ROUND_INTRO",
      );

      expectSuccess(await startGame(room.sockets[0]!));
      await introState;

      expectError(
        await joinRoom(newcomer, "LatePlayer", room.roomCode),
        "GAME_ALREADY_STARTED",
      );
      if (server === undefined || newcomer.id === undefined) {
        throw new Error("Expected an active server and connected newcomer");
      }
      expect(
        server.roomManager.getPlayerRoomBySocketId(newcomer.id),
      ).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cancels the game on disconnect and resets the remaining lobby",
    async () => {
      const room = await prepareRoom(3, 3, "Cancel");
      room.sockets.map(collectSecrets);
      const introStates = room.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) => state.game?.phase === "ROUND_INTRO",
        ),
      );

      expectSuccess(await startGame(room.sockets[0]!));
      await Promise.all(introStates);

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

      const [receivedCancellations, receivedStates] = await Promise.all([
        Promise.all(cancellations),
        Promise.all(lobbyStates),
      ]);

      for (const cancellation of receivedCancellations) {
        expect(cancellation).toMatchObject({
          reason: "PLAYER_DISCONNECTED",
        });
        expect(cancellation.message.length).toBeGreaterThan(0);
      }
      expect(receivedStates[1]).toEqual(receivedStates[0]);
      for (const state of receivedStates) {
        expect(state.game).toBeNull();
        expect(state.allPlayersReady).toBe(false);
        expect(state.canStart).toBe(false);
        expect(state.players.every((player) => !player.isReady)).toBe(true);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cancels the game when a player leaves voluntarily",
    async () => {
      const room = await prepareRoom(3, 3, "Leave");
      room.sockets.map(collectSecrets);
      const introState = waitForRoomState(
        room.sockets[0]!,
        (state) => state.game?.phase === "ROUND_INTRO",
      );
      expectSuccess(await startGame(room.sockets[0]!));
      await introState;

      const remainingSockets = room.sockets.slice(0, 2);
      const cancellations = remainingSockets.map(waitForGameCancellation);
      const lobbyStates = remainingSockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) => state.playerCount === 2 && state.game === null,
        ),
      );

      expectSuccess(await leaveRoom(room.sockets[2]!));
      const [receivedCancellations, receivedStates] = await Promise.all([
        Promise.all(cancellations),
        Promise.all(lobbyStates),
      ]);

      for (const cancellation of receivedCancellations) {
        expect(cancellation.reason).toBe("PLAYER_LEFT");
      }
      for (const state of receivedStates) {
        expect(state.game).toBeNull();
        expect(state.players.every((player) => !player.isReady)).toBe(true);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps game events isolated between two rooms",
    async () => {
      const firstRoom = await prepareRoom(3, 3, "Alpha");
      const secondRoom = await prepareRoom(3, 3, "Beta");

      await Promise.all(
        [...firstRoom.sockets, ...secondRoom.sockets].map(passSocketBarrier),
      );

      const statesFromFirstRoomSeenBySecond: PublicRoomState[] = [];
      const statesFromSecondRoomSeenByFirst: PublicRoomState[] = [];
      const secretsSeenBySecondRoom: TurnSecretPayload[] = [];

      for (const socket of secondRoom.sockets) {
        socket.on(SOCKET_EVENTS.ROOM_STATE, (state) => {
          if (state.code === firstRoom.roomCode) {
            statesFromFirstRoomSeenBySecond.push(state);
          }
        });
        socket.on(SOCKET_EVENTS.TURN_SECRET, (secret) => {
          secretsSeenBySecondRoom.push(secret);
        });
      }
      for (const socket of firstRoom.sockets) {
        socket.on(SOCKET_EVENTS.ROOM_STATE, (state) => {
          if (state.code === secondRoom.roomCode) {
            statesFromSecondRoomSeenByFirst.push(state);
          }
        });
      }

      const firstRoomIntro = firstRoom.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === firstRoom.roomCode &&
            state.game?.phase === "ROUND_INTRO",
        ),
      );
      expectSuccess(await startGame(firstRoom.sockets[0]!));
      await Promise.all(firstRoomIntro);
      await Promise.all(secondRoom.sockets.map(passSocketBarrier));

      expect(statesFromFirstRoomSeenBySecond).toEqual([]);
      expect(secretsSeenBySecondRoom).toEqual([]);
      expect(
        server?.roomManager.getPublicRoomState(secondRoom.roomCode).game,
      ).toBeNull();

      const secondRoomUpdates = secondRoom.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === secondRoom.roomCode &&
            state.players[0]?.isReady === false,
        ),
      );
      expectSuccess(await setReady(secondRoom.sockets[0]!, false));
      await Promise.all(secondRoomUpdates);
      await Promise.all(firstRoom.sockets.map(passSocketBarrier));

      expect(statesFromSecondRoomSeenByFirst).toEqual([]);
      expect(
        server?.roomManager.getPublicRoomState(firstRoom.roomCode).game,
      ).not.toBeNull();
    },
    TEST_TIMEOUT_MS,
  );
});
