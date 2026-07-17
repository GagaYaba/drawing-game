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
  type SubmitDrawingSuccessData,
  type SubmitGuessSuccessData,
} from "@drawing-game/shared";
import { io as createSocketClient, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDrawingGameServer } from "../src/create-server.js";
import { TEST_CLIENT_INSTANCE_ID } from "./test-client-instance.js";

type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;
type DrawingGameServer = ReturnType<typeof createDrawingGameServer>;

interface PreparedRoom {
  sockets: TestClient[];
  sessions: PlayerSessionCredentials[];
  roomCode: string;
}

interface VotingRoom extends PreparedRoom {
  drawerIndex: number;
  voterIndexes: number[];
  votingStates: PublicRoomState[];
}

const ASYNC_TIMEOUT_MS = 8_000;
const TEST_TIMEOUT_MS = 25_000;
const INTRO_DURATION_MS = 40;
const SECRET_LEVEL = 7;
const TEST_PROMPT = {
  id: "guess-integration-prompt",
  statement:
    "Représente un phare du plus lumineux (10) au moins lumineux (1).",
  lowLabel: "Moins lumineux",
  highLabel: "Plus lumineux",
  category: "integration",
} as const;

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
  value: number,
  turnId = getActiveTurnId(socket),
): Promise<ActionResult<SubmitGuessSuccessData>> {
  return waitForAcknowledgement((acknowledge) => {
    socket.emit(SOCKET_EVENTS.GUESS_SUBMIT, { turnId, value }, acknowledge);
  });
}

function getActiveTurnId(socket: TestClient): string {
  const socketId = socket.id;
  const turnId =
    socketId === undefined
      ? undefined
      : server?.roomManager.getPlayerRoomBySocketId(socketId)?.game?.currentTurn
          .turnId;

  if (turnId === undefined) {
    throw new Error("Le tour actif du client de test est introuvable.");
  }

  return turnId;
}

function submitGuessWithArguments(
  socket: TestClient,
  ...payloadArguments: unknown[]
): Promise<ActionResult<SubmitGuessSuccessData>> {
  return waitForAcknowledgement((acknowledge) => {
    Reflect.apply(socket.emit, socket, [
      SOCKET_EVENTS.GUESS_SUBMIT,
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

function expectPrivateVoting(
  room: PublicRoomState,
  eligibleVoterCount: number,
  submittedGuessCount: number,
): void {
  const game = expectGame(room, "VOTING");
  expect(game.voting).toEqual({
    eligibleVoterCount,
    submittedGuessCount,
  });
  expect(game.reveal).toBeNull();
  expect(game.submittedDrawing).not.toBeNull();
  expect(game).not.toHaveProperty("secretLevel");
  expect(game).not.toHaveProperty("guesses");
  expect(game).not.toHaveProperty("distance");
  expect(Object.keys(game.voting ?? {}).sort()).toEqual([
    "eligibleVoterCount",
    "submittedGuessCount",
  ]);

  const serializedGame = JSON.stringify(game);
  expect(serializedGame).not.toContain("secretLevel");
  expect(serializedGame).not.toContain('"guesses"');
  expect(serializedGame).not.toContain('"distance"');
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

async function enterVoting(room: PreparedRoom): Promise<VotingRoom> {
  const drawingStates = room.sockets.map((socket) =>
    waitForRoomState(
      socket,
      (state) =>
        state.code === room.roomCode && state.game?.phase === "DRAWING",
    ),
  );
  expectSuccess(await startGame(room.sockets[0]!));
  const receivedDrawingStates = await Promise.all(drawingStates);
  const drawingGame = expectGame(receivedDrawingStates[0]!, "DRAWING");
  const drawerIndex = room.sessions.findIndex(
    (session) => session.playerId === drawingGame.currentDrawer.id,
  );
  if (drawerIndex < 0) {
    throw new Error("Le dessinateur devrait appartenir au salon.");
  }

  const votingStates = room.sockets.map((socket) =>
    waitForRoomState(
      socket,
      (state) =>
        state.code === room.roomCode && state.game?.phase === "VOTING",
    ),
  );
  expectSuccess(await submitDrawing(room.sockets[drawerIndex]!));

  return {
    ...room,
    drawerIndex,
    voterIndexes: room.sockets
      .map((_socket, index) => index)
      .filter((index) => index !== drawerIndex),
    votingStates: await Promise.all(votingStates),
  };
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

  vi.restoreAllMocks();
});

describe("Socket.IO authoritative guess integration", () => {
  it(
    "garde le premier vote privé puis diffuse une seule révélation cohérente au dernier vote",
    async () => {
      const room = await enterVoting(await prepareRoom("Reveal"));
      for (const state of room.votingStates) {
        expectPrivateVoting(state, 2, 0);
      }

      const firstVoterIndex = room.voterIndexes[0]!;
      const lastVoterIndex = room.voterIndexes[1]!;
      const firstVoteStates = room.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === room.roomCode &&
            state.game?.phase === "VOTING" &&
            state.game.voting?.submittedGuessCount === 1,
        ),
      );
      const firstAcknowledgement = expectSuccess(
        await submitGuess(room.sockets[firstVoterIndex]!, 5),
      );
      const receivedFirstVoteStates = await Promise.all(firstVoteStates);

      expect(firstAcknowledgement).toEqual({
        value: 5,
        submittedAt: expect.any(Number),
      });
      expect(Object.keys(firstAcknowledgement).sort()).toEqual([
        "submittedAt",
        "value",
      ]);
      for (const state of receivedFirstVoteStates) {
        expectPrivateVoting(state, 2, 1);
      }
      expect(JSON.stringify(firstAcknowledgement)).not.toContain("secret");
      expect(JSON.stringify(firstAcknowledgement)).not.toContain("distance");

      const stateCollectors = room.sockets.map(collectRoomStates);
      const revealStates = room.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === room.roomCode && state.game?.phase === "REVEAL",
        ),
      );
      const lastAcknowledgement = expectSuccess(
        await submitGuess(room.sockets[lastVoterIndex]!, 9),
      );
      const receivedRevealStates = await Promise.all(revealStates);
      await Promise.all(room.sockets.map(passSocketBarrier));

      expect(lastAcknowledgement).toEqual({
        value: 9,
        submittedAt: expect.any(Number),
      });

      const valueByPlayerId = new Map([
        [room.sessions[firstVoterIndex]!.playerId, 5],
        [room.sessions[lastVoterIndex]!.playerId, 9],
      ]);
      const expectedGuesses = receivedRevealStates[0]!.players
        .filter(
          (player) =>
            player.id !==
            receivedRevealStates[0]!.game?.currentDrawer.id,
        )
        .map((player) => {
          const value = valueByPlayerId.get(player.id);
          if (value === undefined) {
            throw new Error("Une estimation publique est introuvable.");
          }

          return {
            player: { id: player.id, nickname: player.nickname },
            value,
            distance: Math.abs(value - SECRET_LEVEL),
            pointsEarned: 3,
            totalScore: 3,
          };
        });
      const revealPlayers = receivedRevealStates[0]!.players;
      const drawerPlayer = revealPlayers.find(
        (player) =>
          player.id ===
          receivedRevealStates[0]!.game?.currentDrawer.id,
      );
      if (drawerPlayer === undefined) {
        throw new Error("Le dessinateur public est introuvable.");
      }
      const voterPlayers = revealPlayers.filter(
        (player) => player.id !== drawerPlayer.id,
      );
      const expectedLeaderboard = [
        ...voterPlayers.map((player) => ({
          rank: 1,
          player: { id: player.id, nickname: player.nickname },
          score: 3,
        })),
        {
          rank: 3,
          player: {
            id: drawerPlayer.id,
            nickname: drawerPlayer.nickname,
          },
          score: 0,
        },
      ];

      for (const state of receivedRevealStates) {
        const game = expectGame(state, "REVEAL");
        expect(game.voting).toBeNull();
        expect(game.phaseEndsAt).toBeNull();
        expect(game.submittedDrawing).toEqual(
          room.votingStates[0]!.game?.submittedDrawing,
        );
        expect(game.reveal).toEqual({
          secretLevel: SECRET_LEVEL,
          guesses: expectedGuesses,
          drawerResult: {
            player: {
              id: drawerPlayer.id,
              nickname: drawerPlayer.nickname,
            },
            closeGuessCount: 0,
            pointsEarned: 0,
            totalScore: 0,
          },
          leaderboard: expectedLeaderboard,
          nextDrawer: {
            id: voterPlayers[0]!.id,
            nickname: voterPlayers[0]!.nickname,
          },
        });
        expect(game.reveal?.guesses).toHaveLength(2);
        expect(game.reveal?.guesses).not.toContainEqual(
          expect.objectContaining({
            player: expect.objectContaining({
              id: room.sessions[room.drawerIndex]!.playerId,
            }),
          }),
        );
        expect(game).not.toHaveProperty("score");
        expect(game).not.toHaveProperty("points");
        expect(state.players.map(({ score }) => score)).toEqual([0, 3, 3]);
      }

      for (const collector of stateCollectors) {
        collector.stop();
        const relevantStates = collector.states.filter(
          (state) => state.code === room.roomCode,
        );
        expect(relevantStates).toHaveLength(1);
        expect(relevantStates[0]?.game?.phase).toBe("REVEAL");
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "applique les autorisations depuis socket.id avant toute validation du payload",
    async () => {
      const outsider = await connectClient();
      expectError(
        await submitGuessWithArguments(outsider, { value: 0 }),
        "NOT_IN_ROOM",
      );

      const prepared = await prepareRoom("Auth");
      expectError(
        await submitGuessWithArguments(prepared.sockets[1]!, { value: 0 }),
        "GAME_NOT_STARTED",
      );

      const room = await enterVoting(prepared);
      expectError(
        await submitGuess(room.sockets[room.drawerIndex]!, 7),
        "DRAWER_CANNOT_GUESS",
      );

      const firstVoterIndex = room.voterIndexes[0]!;
      const lastVoterIndex = room.voterIndexes[1]!;
      expectSuccess(await submitGuess(room.sockets[firstVoterIndex]!, 5));
      expectError(
        await submitGuessWithArguments(
          room.sockets[firstVoterIndex]!,
          { value: 0 },
        ),
        "GUESS_ALREADY_SUBMITTED",
      );

      expectSuccess(await submitGuess(room.sockets[lastVoterIndex]!, 9));
      expectError(
        await submitGuess(room.sockets[firstVoterIndex]!, 5),
        "NOT_VOTING_PHASE",
      );
      expect(room.sockets.every((socket) => socket.connected)).toBe(true);
      expect(outsider.connected).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "acknowledge tous les payloads invalides, les arguments multiples et une erreur inattendue",
    async () => {
      const room = await enterVoting(await prepareRoom("Validation"));
      const voter = room.sockets[room.voterIndexes[0]!]!;
      const turnId = getActiveTurnId(voter);
      const invalidArguments: unknown[][] = [
        [{ turnId, value: 0 }],
        [{ turnId, value: 11 }],
        [{ turnId, value: 5.5 }],
        [{ turnId, value: "5" }],
        [{ turnId, value: Number.NaN }],
        [{ turnId, value: Number.POSITIVE_INFINITY }],
        [{ value: 5 }],
        [{ turnId: "", value: 5 }],
        [{ turnId: ` ${turnId} `, value: 5 }],
        [{ turnId: 1, value: 5 }],
        [null],
        [],
        [[{ turnId, value: 5 }]],
        [
          {
            turnId,
            value: 5,
            playerId: room.sessions[room.voterIndexes[0]!]!.playerId,
          },
        ],
        [{ turnId, value: { nested: 5 } }],
        [{ turnId, value: 5 }, { roomCode: room.roomCode }],
      ];

      for (const payloadArguments of invalidArguments) {
        expectError(
          await submitGuessWithArguments(voter, ...payloadArguments),
          "INVALID_GUESS",
        );
      }

      const currentPublicRoom = server?.roomManager.getPublicRoomState(
        room.roomCode,
      );
      if (currentPublicRoom === undefined) {
        throw new Error("Le salon de test devrait exister.");
      }
      expectPrivateVoting(currentPublicRoom, 2, 0);
      expect(voter.connected).toBe(true);

      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      vi.spyOn(server!.gameManager, "submitGuess").mockImplementationOnce(
        () => {
          throw new Error("erreur inattendue");
        },
      );
      expectError(await submitGuess(voter, 5), "INTERNAL_ERROR");
      expect(consoleError).toHaveBeenCalledOnce();

      const validState = waitForRoomState(
        voter,
        (state) => state.game?.voting?.submittedGuessCount === 1,
      );
      expectSuccess(await submitGuess(voter, 5));
      await expect(validState).resolves.toSatisfy(
        (state: PublicRoomState) =>
          state.game?.phase === "VOTING" &&
          state.game.voting?.submittedGuessCount === 1,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "n'accepte qu'un seul vote concurrent et ne diffuse qu'un seul compteur",
    async () => {
      const room = await enterVoting(await prepareRoom("Concurrent"));
      const voter = room.sockets[room.voterIndexes[0]!]!;
      const collectors = room.sockets.map(collectRoomStates);

      const results = await Promise.all([
        submitGuess(voter, 4),
        submitGuess(voter, 8),
      ]);
      await Promise.all(room.sockets.map(passSocketBarrier));

      expect(results.filter((result) => result.success)).toHaveLength(1);
      const rejected = results.find((result) => !result.success);
      if (rejected === undefined) {
        throw new Error("Une estimation concurrente aurait dû être refusée.");
      }
      expectError(rejected, "GUESS_ALREADY_SUBMITTED");

      const publicRoom = server?.roomManager.getPublicRoomState(room.roomCode);
      if (publicRoom === undefined) {
        throw new Error("Le salon de test devrait exister.");
      }
      expectPrivateVoting(publicRoom, 2, 1);

      for (const collector of collectors) {
        collector.stop();
        const relevantStates = collector.states.filter(
          (state) => state.code === room.roomCode,
        );
        expect(relevantStates).toHaveLength(1);
        expectPrivateVoting(relevantStates[0]!, 2, 1);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "isole les compteurs et résultats entre deux salons",
    async () => {
      const [firstRoom, secondRoom] = await Promise.all([
        prepareRoom("Alpha"),
        prepareRoom("Beta"),
      ]).then(async ([first, second]) =>
        Promise.all([enterVoting(first), enterVoting(second)]),
      );
      expect(firstRoom.roomCode).not.toBe(secondRoom.roomCode);

      const leakedStates: PublicRoomState[] = [];
      const leakHandlers = secondRoom.sockets.map((socket) => {
        const handler = (state: PublicRoomState): void => {
          if (state.code === firstRoom.roomCode) {
            leakedStates.push(state);
          }
        };
        socket.on(SOCKET_EVENTS.ROOM_STATE, handler);
        return { socket, handler };
      });

      const firstRoomUpdates = firstRoom.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === firstRoom.roomCode &&
            state.game?.voting?.submittedGuessCount === 1,
        ),
      );
      expectSuccess(
        await submitGuess(
          firstRoom.sockets[firstRoom.voterIndexes[0]!]!,
          6,
        ),
      );
      await Promise.all(firstRoomUpdates);
      await Promise.all(secondRoom.sockets.map(passSocketBarrier));

      for (const { socket, handler } of leakHandlers) {
        socket.off(SOCKET_EVENTS.ROOM_STATE, handler);
      }
      expect(leakedStates).toEqual([]);

      const untouchedSecondRoom = server?.roomManager.getPublicRoomState(
        secondRoom.roomCode,
      );
      if (untouchedSecondRoom === undefined) {
        throw new Error("Le second salon devrait exister.");
      }
      expectPrivateVoting(untouchedSecondRoom, 2, 0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "annule une partie pendant VOTING sans conserver de données de vote publiques",
    async () => {
      const room = await enterVoting(await prepareRoom("Cancel"));
      const firstVoterIndex = room.voterIndexes[0]!;
      const departingVoterIndex = room.voterIndexes[1]!;
      expectSuccess(
        await submitGuess(room.sockets[firstVoterIndex]!, 5),
      );

      const remainingSockets = room.sockets.filter(
        (_socket, index) => index !== departingVoterIndex,
      );
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

      room.sockets[departingVoterIndex]!.disconnect();
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
        expect(JSON.stringify(state)).not.toContain('"voting"');
        expect(JSON.stringify(state)).not.toContain('"reveal"');
      }
      expect(
        server?.roomManager.getRoomByCode(room.roomCode)?.game,
      ).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );
});
