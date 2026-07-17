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

interface RevealedTurn {
  room: PreparedRoom;
  states: PublicRoomState[];
  drawerIndex: number;
  voterIndexes: number[];
}

const ASYNC_TIMEOUT_MS = 8_000;
const TEST_TIMEOUT_MS = 30_000;
const INTRO_DURATION_MS = 25;
const SECRET_LEVELS = [7, 4, 9, 2, 6, 8] as const;
const TEST_PROMPTS = Array.from({ length: 6 }, (_value, index) => ({
  id: `continue-prompt-${index + 1}`,
  statement: `Représente le sujet ${index + 1} du niveau 10 au niveau 1.`,
  lowLabel: `Niveau bas ${index + 1}`,
  highLabel: `Niveau haut ${index + 1}`,
  category: "integration",
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

function continueGameWithArguments(
  socket: TestClient,
  ...payloadArguments: unknown[]
): Promise<ActionResult<ContinueGameSuccessData>> {
  return waitForAcknowledgement((acknowledge) => {
    Reflect.apply(socket.emit, socket, [
      SOCKET_EVENTS.GAME_CONTINUE,
      ...payloadArguments,
      acknowledge,
    ]);
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

async function waitForDrawingTurn(
  room: PreparedRoom,
  triggerTransition: () => Promise<ActionResult<unknown>>,
  expectedTurnNumber: number,
): Promise<PublicRoomState[]> {
  const drawingStates = room.sockets.map((socket) =>
    waitForRoomState(
      socket,
      (state) =>
        state.code === room.roomCode &&
        state.game?.phase === "DRAWING" &&
        state.game.currentTurnNumber === expectedTurnNumber,
    ),
  );

  expectSuccess(await triggerTransition());
  return Promise.all(drawingStates);
}

async function revealCurrentTurn(
  room: PreparedRoom,
  drawingState: PublicRoomState,
  secretLevel: number,
  guessValues: readonly [number, number] = [secretLevel, secretLevel],
): Promise<RevealedTurn> {
  const drawingGame = expectGame(drawingState, "DRAWING");
  const drawerIndex = room.sessions.findIndex(
    (session) => session.playerId === drawingGame.currentDrawer.id,
  );
  if (drawerIndex < 0) {
    throw new Error("Le dessinateur devrait appartenir au salon.");
  }
  const voterIndexes = room.sockets
    .map((_socket, index) => index)
    .filter((index) => index !== drawerIndex);

  const votingStates = room.sockets.map((socket) =>
    waitForRoomState(
      socket,
      (state) =>
        state.code === room.roomCode &&
        state.game?.phase === "VOTING" &&
        state.game.currentTurnNumber === drawingGame.currentTurnNumber,
    ),
  );
  expectSuccess(await submitDrawing(room.sockets[drawerIndex]!));
  await Promise.all(votingStates);

  const revealStates = room.sockets.map((socket) =>
    waitForRoomState(
      socket,
      (state) =>
        state.code === room.roomCode &&
        state.game?.phase === "REVEAL" &&
        state.game.currentTurnNumber === drawingGame.currentTurnNumber,
    ),
  );
  expectSuccess(
    await submitGuess(room.sockets[voterIndexes[0]!]!, guessValues[0]),
  );
  expectSuccess(
    await submitGuess(room.sockets[voterIndexes[1]!]!, guessValues[1]),
  );

  return {
    room,
    states: await Promise.all(revealStates),
    drawerIndex,
    voterIndexes,
  };
}

async function prepareFirstReveal(
  nicknamePrefix: string,
  secretLevel: number = SECRET_LEVELS[0],
  guessValues: readonly [number, number] = [secretLevel, secretLevel],
): Promise<RevealedTurn> {
  const room = await prepareRoom(nicknamePrefix);
  const drawingStates = await waitForDrawingTurn(
    room,
    () => startGame(room.sockets[0]!),
    1,
  );
  return revealCurrentTurn(
    room,
    drawingStates[0]!,
    secretLevel,
    guessValues,
  );
}

beforeEach(async () => {
  clients = [];
  let secretIndex = 0;
  let turnIdIndex = 0;
  const createdServer = createDrawingGameServer({
    serveClient: false,
    reconnectGraceMs: 0,
    gameManagerOptions: {
      introDurationMs: INTRO_DURATION_MS,
      prompts: TEST_PROMPTS,
      shufflePlayerIds: (playerIds) => [...playerIds],
      selectPrompt: (prompts) => prompts[0]!,
      generateSecretLevel: () =>
        SECRET_LEVELS[secretIndex++ % SECRET_LEVELS.length]!,
      generateTurnId: () => `turn-${++turnIdIndex}`,
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

describe("Socket.IO game continuation integration", () => {
  it(
    "acknowledge les refus d'autorisation, de phase et de payload sans casser les sockets",
    async () => {
      const outsider = await connectClient();
      expectError(await continueGame(outsider), "NOT_IN_ROOM");

      const room = await prepareRoom("Refus");
      expectError(
        await continueGame(room.sockets[0]!),
        "GAME_NOT_STARTED",
      );

      const drawingStatesPromise = room.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === room.roomCode &&
            state.game?.phase === "DRAWING",
        ),
      );
      expectSuccess(await startGame(room.sockets[0]!));
      expectError(
        await continueGame(room.sockets[0]!),
        "NOT_REVEAL_PHASE",
      );
      const drawingStates = await Promise.all(drawingStatesPromise);
      const reveal = await revealCurrentTurn(
        room,
        drawingStates[0]!,
        SECRET_LEVELS[0],
      );

      expectError(
        await continueGame(room.sockets[1]!),
        "NOT_HOST",
      );
      expectError(
        await continueGameWithArguments(room.sockets[0]!, {
          nextDrawerId: room.sessions[2]!.playerId,
        }),
        "INVALID_GAME_CONTINUE_REQUEST",
      );
      expectError(
        await continueGameWithArguments(
          room.sockets[0]!,
          {},
          { score: 999 },
        ),
        "INVALID_GAME_CONTINUE_REQUEST",
      );

      expect(
        server?.roomManager.getPublicRoomState(room.roomCode).game?.phase,
      ).toBe("REVEAL");
      expect(reveal.states.every((state) => state.game?.finished === null)).toBe(
        true,
      );
      expect(room.sockets.every((socket) => socket.connected)).toBe(true);
      expect(outsider.connected).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "ne laisse réussir qu'une continuation et envoie le nouveau secret au seul nouveau dessinateur",
    async () => {
      const revealed = await prepareFirstReveal("Secret");
      const previousGame = expectGame(revealed.states[0]!, "REVEAL");
      const previousScores = revealed.states[0]!.players.map(
        ({ id, score }) => ({ id, score }),
      );
      const secretCollectors = revealed.room.sockets.map(collectTurnSecrets);
      const stateCollectors = revealed.room.sockets.map(collectRoomStates);
      const introStates = revealed.room.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === revealed.room.roomCode &&
            state.game?.phase === "ROUND_INTRO" &&
            state.game.currentTurnNumber === 2,
        ),
      );

      const results = await Promise.all([
        continueGame(revealed.room.sockets[0]!),
        continueGame(revealed.room.sockets[0]!),
      ]);
      const successfulResult = results.find((result) => result.success);
      const rejectedResult = results.find((result) => !result.success);
      if (successfulResult === undefined || rejectedResult === undefined) {
        throw new Error(
          "Une continuation devait réussir et l'autre être refusée.",
        );
      }
      const acknowledgement = expectSuccess(successfulResult);
      expectError(rejectedResult, "NOT_REVEAL_PHASE");

      const receivedIntroStates = await Promise.all(introStates);
      await Promise.all(revealed.room.sockets.map(passSocketBarrier));
      for (const collector of secretCollectors) {
        collector.stop();
      }
      for (const collector of stateCollectors) {
        collector.stop();
        const introUpdates = collector.states.filter(
          (state) =>
            state.code === revealed.room.roomCode &&
            state.game?.phase === "ROUND_INTRO" &&
            state.game.currentTurnNumber === 2,
        );
        expect(introUpdates).toEqual([acknowledgement.room]);
      }

      const nextGame = expectGame(acknowledgement.room, "ROUND_INTRO");
      expect(nextGame.currentRound).toBe(1);
      expect(nextGame.currentTurnNumber).toBe(2);
      expect(nextGame.currentDrawer.id).toBe(
        revealed.room.sessions[1]!.playerId,
      );
      expect(nextGame.prompt.id).toBe(TEST_PROMPTS[1]!.id);
      expect(nextGame.turnId).not.toBe(previousGame.turnId);
      expect(nextGame.submittedDrawing).toBeNull();
      expect(nextGame.voting).toBeNull();
      expect(nextGame.reveal).toBeNull();
      expect(nextGame.finished).toBeNull();
      expect(
        acknowledgement.room.players.map(({ id, score }) => ({ id, score })),
      ).toEqual(previousScores);

      for (const state of receivedIntroStates) {
        expect(state).toEqual(acknowledgement.room);
      }

      const expectedDrawerIndex = 1;
      for (let index = 0; index < secretCollectors.length; index += 1) {
        const secrets = secretCollectors[index]!.secrets;
        if (index === expectedDrawerIndex) {
          expect(secrets).toEqual([
            {
              roomCode: revealed.room.roomCode,
              gameId: nextGame.gameId,
              turnId: nextGame.turnId,
              drawerPlayerId: nextGame.currentDrawer.id,
              secretLevel: SECRET_LEVELS[1],
            },
          ]);
        } else {
          expect(secrets).toEqual([]);
        }
      }

      const serializedAcknowledgement = JSON.stringify(acknowledgement);
      expect(serializedAcknowledgement).not.toContain("secretLevel");
      expect(serializedAcknowledgement).not.toContain("drawerSocketId");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuse une estimation retardée de l'ancien tour pendant le vote suivant sans modifier vote ni score",
    async () => {
      const revealed = await prepareFirstReveal("Retard");
      const previousGame = expectGame(revealed.states[0]!, "REVEAL");
      const scoresAfterFirstTurn = revealed.states[0]!.players.map(
        ({ id, score }) => ({ id, score }),
      );
      const nextDrawingStates = await waitForDrawingTurn(
        revealed.room,
        () => continueGame(revealed.room.sockets[0]!),
        2,
      );
      const nextDrawingGame = expectGame(nextDrawingStates[0]!, "DRAWING");
      expect(nextDrawingGame.turnId).not.toBe(previousGame.turnId);

      const nextDrawerIndex = revealed.room.sessions.findIndex(
        (session) => session.playerId === nextDrawingGame.currentDrawer.id,
      );
      if (nextDrawerIndex < 0) {
        throw new Error("Le nouveau dessinateur devrait appartenir au salon.");
      }

      const votingStates = revealed.room.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === revealed.room.roomCode &&
            state.game?.phase === "VOTING" &&
            state.game.turnId === nextDrawingGame.turnId,
        ),
      );
      expectSuccess(
        await submitDrawing(revealed.room.sockets[nextDrawerIndex]!),
      );
      const receivedVotingStates = await Promise.all(votingStates);
      for (const state of receivedVotingStates) {
        const votingGame = expectGame(state, "VOTING");
        expect(votingGame.voting?.submittedGuessCount).toBe(0);
        expect(state.players.map(({ id, score }) => ({ id, score }))).toEqual(
          scoresAfterFirstTurn,
        );
      }

      const delayedVoterIndex = revealed.room.sessions.findIndex(
        (_session, index) =>
          index !== revealed.drawerIndex && index !== nextDrawerIndex,
      );
      if (delayedVoterIndex < 0) {
        throw new Error(
          "Un joueur autorisé à voter pendant les deux tours est requis.",
        );
      }

      const stateCollectors = revealed.room.sockets.map(collectRoomStates);
      expectError(
        await submitGuess(
          revealed.room.sockets[delayedVoterIndex]!,
          5,
          previousGame.turnId,
        ),
        "STALE_TURN",
      );
      await Promise.all(revealed.room.sockets.map(passSocketBarrier));

      for (const collector of stateCollectors) {
        collector.stop();
        expect(
          collector.states.filter(
            (state) => state.code === revealed.room.roomCode,
          ),
        ).toEqual([]);
      }

      const internalRoom = server?.roomManager.getRoomByCode(
        revealed.room.roomCode,
      );
      if (internalRoom === undefined || internalRoom.game === null) {
        throw new Error("Le tour interne suivant devrait être actif.");
      }
      const internalGame = internalRoom.game;

      expect(internalGame.phase).toBe("VOTING");
      expect(internalGame.currentTurn.turnId).toBe(nextDrawingGame.turnId);
      expect(internalGame.currentTurn.guesses).toEqual({});
      expect(internalGame.currentTurn.scoresAppliedAt).toBeNull();
      expect(internalGame.currentTurn.scoreResult).toBeNull();
      expect(
        internalRoom.players.map(({ id, score }) => ({ id, score })),
      ).toEqual(scoresAfterFirstTurn);

      const validVoteState = waitForRoomState(
        revealed.room.sockets[0]!,
        (state) =>
          state.code === revealed.room.roomCode &&
          state.game?.phase === "VOTING" &&
          state.game.turnId === nextDrawingGame.turnId &&
          state.game.voting?.submittedGuessCount === 1,
      );
      expectSuccess(
        await submitGuess(
          revealed.room.sockets[delayedVoterIndex]!,
          6,
          nextDrawingGame.turnId,
        ),
      );
      const stateAfterValidVote = await validVoteState;
      expect(
        stateAfterValidVote.players.map(({ id, score }) => ({ id, score })),
      ).toEqual(scoresAfterFirstTurn);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "joue les six tours dans l'ordre fixe puis diffuse FINISHED et refuse toute continuation supplémentaire",
    async () => {
      const room = await prepareRoom("Complet");
      const drawerIds: string[] = [];
      let lastReveal: PublicRoomState | null = null;

      for (let turnNumber = 1; turnNumber <= 6; turnNumber += 1) {
        const drawingStates = await waitForDrawingTurn(
          room,
          () =>
            turnNumber === 1
              ? startGame(room.sockets[0]!)
              : continueGame(room.sockets[0]!),
          turnNumber,
        );
        const drawingGame = expectGame(drawingStates[0]!, "DRAWING");
        const expectedDrawerIndex = (turnNumber - 1) % room.sessions.length;
        const expectedRound =
          Math.floor((turnNumber - 1) / room.sessions.length) + 1;

        expect(drawingGame.currentTurnNumber).toBe(turnNumber);
        expect(drawingGame.currentRound).toBe(expectedRound);
        expect(drawingGame.currentDrawer.id).toBe(
          room.sessions[expectedDrawerIndex]!.playerId,
        );
        expect(drawingGame.prompt.id).toBe(
          TEST_PROMPTS[turnNumber - 1]!.id,
        );
        drawerIds.push(drawingGame.currentDrawer.id);

        const reveal = await revealCurrentTurn(
          room,
          drawingStates[0]!,
          SECRET_LEVELS[turnNumber - 1]!,
        );
        lastReveal = reveal.states[0]!;
        const revealGame = expectGame(lastReveal, "REVEAL");
        expect(revealGame.reveal?.secretLevel).toBe(
          SECRET_LEVELS[turnNumber - 1],
        );
        expect(revealGame.reveal?.guesses).toHaveLength(2);
        expect(revealGame.reveal?.guesses.every(
          ({ pointsEarned }) => pointsEarned === 5,
        )).toBe(true);
        expect(revealGame.reveal?.drawerResult.pointsEarned).toBe(2);
      }

      expect(drawerIds).toEqual([
        room.sessions[0]!.playerId,
        room.sessions[1]!.playerId,
        room.sessions[2]!.playerId,
        room.sessions[0]!.playerId,
        room.sessions[1]!.playerId,
        room.sessions[2]!.playerId,
      ]);
      expect(lastReveal).not.toBeNull();

      const finishedStates = room.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === room.roomCode &&
            state.game?.phase === "FINISHED",
        ),
      );
      const acknowledgement = expectSuccess(
        await continueGame(room.sockets[0]!),
      );
      const receivedFinishedStates = await Promise.all(finishedStates);
      const finishedGame = expectGame(acknowledgement.room, "FINISHED");

      expect(finishedGame.currentRound).toBe(2);
      expect(finishedGame.currentTurnNumber).toBe(6);
      expect(finishedGame.totalTurns).toBe(6);
      expect(finishedGame.voting).toBeNull();
      expect(finishedGame.reveal).toBeNull();
      expect(finishedGame.finished).toEqual({
        leaderboard: room.sessions.map((session) => ({
          rank: 1,
          player: {
            id: session.playerId,
            nickname: expect.any(String),
          },
          score: 24,
        })),
        winners: room.sessions.map((session) => ({
          id: session.playerId,
          nickname: expect.any(String),
          score: 24,
        })),
        completedRounds: 2,
        completedTurns: 6,
      });
      expect(acknowledgement.room.players.every(
        (player) => player.score === 24,
      )).toBe(true);

      for (const state of receivedFinishedStates) {
        expect(state).toEqual(acknowledgement.room);
      }

      const serializedFinishedState = JSON.stringify(acknowledgement);
      expect(serializedFinishedState).not.toContain("secretLevel");
      expect(serializedFinishedState).not.toContain("drawerSocketId");
      expectError(
        await continueGame(room.sockets[0]!),
        "GAME_ALREADY_FINISHED",
      );
      expect(room.sockets.every((socket) => socket.connected)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "isole les scores, la continuation et les secrets entre deux salons",
    async () => {
      const firstRoom = await prepareFirstReveal(
        "Alpha",
        SECRET_LEVELS[0],
        [SECRET_LEVELS[0], SECRET_LEVELS[0]],
      );
      const secondRoom = await prepareFirstReveal(
        "Beta",
        SECRET_LEVELS[1],
        [10, 10],
      );
      const firstBefore = firstRoom.states[0]!;
      const secondBefore = secondRoom.states[0]!;

      expect(firstBefore.players.map(({ score }) => score)).toEqual([2, 5, 5]);
      expect(secondBefore.players.map(({ score }) => score)).toEqual([0, 0, 0]);
      expect(expectGame(firstBefore, "REVEAL").reveal?.leaderboard).not.toEqual(
        expectGame(secondBefore, "REVEAL").reveal?.leaderboard,
      );

      const firstSecretCollectors =
        firstRoom.room.sockets.map(collectTurnSecrets);
      const secondSecretCollectors =
        secondRoom.room.sockets.map(collectTurnSecrets);
      const secondStateCollectors =
        secondRoom.room.sockets.map(collectRoomStates);
      const firstIntroStates = firstRoom.room.sockets.map((socket) =>
        waitForRoomState(
          socket,
          (state) =>
            state.code === firstRoom.room.roomCode &&
            state.game?.phase === "ROUND_INTRO" &&
            state.game.currentTurnNumber === 2,
        ),
      );

      const continuation = expectSuccess(
        await continueGame(firstRoom.room.sockets[0]!),
      );
      const receivedFirstIntroStates = await Promise.all(firstIntroStates);
      await Promise.all(
        [...firstRoom.room.sockets, ...secondRoom.room.sockets].map(
          passSocketBarrier,
        ),
      );

      for (const collector of [
        ...firstSecretCollectors,
        ...secondSecretCollectors,
      ]) {
        collector.stop();
      }
      for (const collector of secondStateCollectors) {
        collector.stop();
      }

      const continuedGame = expectGame(
        continuation.room,
        "ROUND_INTRO",
      );
      expect(continuedGame.currentTurnNumber).toBe(2);
      expect(continuedGame.prompt.id).toBe(TEST_PROMPTS[1]!.id);
      expect(
        continuation.room.players.map(({ score }) => score),
      ).toEqual([2, 5, 5]);
      for (const state of receivedFirstIntroStates) {
        expect(state).toEqual(continuation.room);
      }

      const expectedFirstDrawerIndex = 1;
      for (let index = 0; index < firstSecretCollectors.length; index += 1) {
        const secrets = firstSecretCollectors[index]!.secrets;
        if (index === expectedFirstDrawerIndex) {
          expect(secrets).toEqual([
            {
              roomCode: firstRoom.room.roomCode,
              gameId: continuedGame.gameId,
              turnId: continuedGame.turnId,
              drawerPlayerId: continuedGame.currentDrawer.id,
              secretLevel: SECRET_LEVELS[2],
            },
          ]);
        } else {
          expect(secrets).toEqual([]);
        }
      }
      for (const collector of secondSecretCollectors) {
        expect(collector.secrets).toEqual([]);
      }
      for (const collector of secondStateCollectors) {
        expect(
          collector.states.some(
            (state) => state.code === firstRoom.room.roomCode,
          ),
        ).toBe(false);
      }

      const secondAfter = server?.roomManager.getPublicRoomState(
        secondRoom.room.roomCode,
      );
      expect(secondAfter).toEqual(secondBefore);
      const untouchedSecondGame = expectGame(secondAfter!, "REVEAL");
      expect(untouchedSecondGame.currentTurnNumber).toBe(1);
      expect(untouchedSecondGame.prompt.id).toBe(TEST_PROMPTS[0]!.id);
      expect(untouchedSecondGame.reveal?.leaderboard).toEqual(
        expectGame(secondBefore, "REVEAL").reveal?.leaderboard,
      );
    },
    TEST_TIMEOUT_MS,
  );
});
