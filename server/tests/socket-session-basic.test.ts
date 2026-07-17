import type { AddressInfo } from "node:net";

import {
  SOCKET_EVENTS,
  type ActionAcknowledgement,
  type ActionResult,
  type ClientToServerEvents,
  type PublicRoomState,
  type RestoreSessionSuccessData,
  type RoomErrorCode,
  type RoomSessionData,
  type ServerToClientEvents,
} from "@drawing-game/shared";
import { io as createSocketClient, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDrawingGameServer } from "../src/create-server.js";
import {
  SECOND_TEST_CLIENT_INSTANCE_ID,
  TEST_CLIENT_INSTANCE_ID,
} from "./test-client-instance.js";

type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;
type DrawingGameServer = ReturnType<typeof createDrawingGameServer>;

interface ManualTimers {
  scheduleTimer: (callback: () => void, delay: number) => number;
  clearTimer: (handle: unknown) => void;
  runNext: () => void;
  pendingCount: () => number;
}

interface TwoPlayerRoom {
  host: TestClient;
  guest: TestClient;
  hostSession: RoomSessionData;
  guestSession: RoomSessionData;
}

const ASYNC_TIMEOUT_MS = 3_000;
const TEST_TIMEOUT_MS = 10_000;
const RECONNECT_GRACE_MS = 100;

let server: DrawingGameServer | undefined;
let serverUrl = "";
let clients: TestClient[] = [];
let now = 1_000;
let timers: ManualTimers;

function createManualTimers(): ManualTimers {
  let nextHandle = 0;
  const callbacks = new Map<number, () => void>();

  return {
    scheduleTimer: (callback) => {
      const handle = ++nextHandle;
      callbacks.set(handle, callback);
      return handle;
    },
    clearTimer: (handle) => {
      if (typeof handle === "number") {
        callbacks.delete(handle);
      }
    },
    runNext: () => {
      const entry = callbacks.entries().next().value as
        | [number, () => void]
        | undefined;
      if (entry === undefined) {
        throw new Error("Aucun timer de reconnexion n'est planifié.");
      }

      callbacks.delete(entry[0]);
      entry[1]();
    },
    pendingCount: () => callbacks.size,
  };
}

function getServer(): DrawingGameServer {
  if (server === undefined) {
    throw new Error("Le serveur de test n'est pas démarré.");
  }

  return server;
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

function emitRawAction<T>(
  socket: TestClient,
  eventName: string,
  payload: unknown,
): Promise<ActionResult<T>> {
  return waitForAcknowledgement((acknowledge) => {
    Reflect.apply(socket.emit, socket, [
      eventName,
      payload,
      acknowledge,
    ]);
  });
}

function createRoom(
  socket: TestClient,
  nickname: string,
  clientInstanceId = TEST_CLIENT_INSTANCE_ID,
): Promise<ActionResult<RoomSessionData>> {
  return waitForAcknowledgement((acknowledge) => {
    socket.emit(
      SOCKET_EVENTS.ROOM_CREATE,
      { nickname, clientInstanceId },
      acknowledge,
    );
  });
}

function joinRoom(
  socket: TestClient,
  nickname: string,
  roomCode: string,
  clientInstanceId = TEST_CLIENT_INSTANCE_ID,
): Promise<ActionResult<RoomSessionData>> {
  return waitForAcknowledgement((acknowledge) => {
    socket.emit(
      SOCKET_EVENTS.ROOM_JOIN,
      { nickname, roomCode, clientInstanceId },
      acknowledge,
    );
  });
}

function restoreSession(
  socket: TestClient,
  payload: RoomSessionData["session"],
  clientInstanceId = SECOND_TEST_CLIENT_INSTANCE_ID,
): Promise<ActionResult<RestoreSessionSuccessData>> {
  return waitForAcknowledgement((acknowledge) => {
    socket.emit(
      SOCKET_EVENTS.SESSION_RESTORE,
      { ...payload, clientInstanceId },
      acknowledge,
    );
  });
}

function leaveRoom(
  socket: TestClient,
): Promise<ActionResult<null>> {
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

async function waitForCondition(
  predicate: () => boolean,
  failureMessage: string,
): Promise<void> {
  const deadline = Date.now() + ASYNC_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(failureMessage);
}

async function createTwoPlayerRoom(
  nicknamePrefix: string,
): Promise<TwoPlayerRoom> {
  const host = await connectClient();
  const guest = await connectClient();
  const hostSession = expectSuccess(
    await createRoom(host, `${nicknamePrefix}Host`),
  );
  const guestSession = expectSuccess(
    await joinRoom(
      guest,
      `${nicknamePrefix}Guest`,
      hostSession.session.roomCode,
    ),
  );

  return { host, guest, hostSession, guestSession };
}

function createWrongToken(token: string): string {
  const replacement = token.startsWith("A") ? "B" : "A";
  return `${replacement}${token.slice(1)}`;
}

beforeEach(async () => {
  clients = [];
  now = 1_000;
  timers = createManualTimers();
  const createdServer = createDrawingGameServer({
    serveClient: false,
    reconnectGraceMs: RECONNECT_GRACE_MS,
    reconnectManagerOptions: {
      clock: () => now,
      scheduleTimer: timers.scheduleTimer,
      clearTimer: timers.clearTimer,
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

describe("basic Socket.IO session restoration", () => {
  it(
    "retourne un token privé absent de tout état public",
    async () => {
      const host = await connectClient();
      const publicStatePromise = waitForRoomState(
        host,
        (state) => state.playerCount === 1,
      );

      const created = expectSuccess(await createRoom(host, "Alice"));
      const publicState = await publicStatePromise;

      expect(created.session.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(created.room).toEqual(publicState);
      expect(created.session.playerId).toBe(publicState.players[0]?.id);
      expect(JSON.stringify(publicState)).not.toContain(
        created.session.token,
      );
      expect(publicState.players[0]).not.toHaveProperty("token");
      expect(publicState.players[0]).not.toHaveProperty(
        "sessionTokenHash",
      );
      expect(publicState.players[0]).not.toHaveProperty("socketId");
      expect(publicState.players[0]).not.toHaveProperty(
        "activeClientInstanceId",
      );
      expect(JSON.stringify(publicState)).not.toContain(
        TEST_CLIENT_INSTANCE_ID,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "conserve le joueur déconnecté puis restaure le même hôte et son score sur un nouveau socket",
    async () => {
      const room = await createTwoPlayerRoom("Restore");
      const { roomCode, playerId } = room.hostSession.session;
      const internalHost = getServer()
        .roomManager.getRoomByCode(roomCode)
        ?.players.find((player) => player.id === playerId);
      if (internalHost === undefined) {
        throw new Error("L'hôte interne est introuvable.");
      }
      internalHost.score = 12;

      const disconnectedStatePromise = waitForRoomState(
        room.guest,
        (state) =>
          state.players.some(
            (player) =>
              player.id === playerId && !player.isConnected,
          ),
      );
      room.host.disconnect();
      const disconnectedState = await disconnectedStatePromise;
      const disconnectedHost = disconnectedState.players.find(
        (player) => player.id === playerId,
      );

      expect(disconnectedState.playerCount).toBe(2);
      expect(disconnectedHost).toMatchObject({
        id: playerId,
        isHost: true,
        isConnected: false,
        reconnectDeadline: now + RECONNECT_GRACE_MS,
        score: 12,
      });
      expect(timers.pendingCount()).toBe(1);

      const restoredSocket = await connectClient();
      const connectedStatePromise = waitForRoomState(
        room.guest,
        (state) =>
          state.players.some(
            (player) =>
              player.id === playerId && player.isConnected,
          ),
      );
      const restored = expectSuccess(
        await restoreSession(
          restoredSocket,
          room.hostSession.session,
        ),
      );
      const connectedState = await connectedStatePromise;
      const restoredHost = connectedState.players.find(
        (player) => player.id === playerId,
      );

      expect(restored.session).toEqual(room.hostSession.session);
      expect(restoredHost).toMatchObject({
        id: playerId,
        isHost: true,
        isConnected: true,
        reconnectDeadline: null,
        score: 12,
      });
      expect(restored.privateState).toEqual({
        gameId: null,
        turnId: null,
        secretLevel: null,
        submittedGuess: null,
        isCurrentDrawer: false,
      });
      expect(timers.pendingCount()).toBe(0);
      expect(
        getServer().roomManager
          .getRoomByCode(roomCode)
          ?.players.find((player) => player.id === playerId)
          ?.socketId,
      ).toBe(restoredSocket.id);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuse un mauvais token et les propriétés supplémentaires",
    async () => {
      const room = await createTwoPlayerRoom("Invalid");
      const credentials = room.hostSession.session;
      const disconnectedStatePromise = waitForRoomState(
        room.guest,
        (state) =>
          state.players.some(
            (player) =>
              player.id === credentials.playerId &&
              !player.isConnected,
          ),
      );
      room.host.disconnect();
      await disconnectedStatePromise;

      const attacker = await connectClient();
      expectError(
        await restoreSession(attacker, {
          ...credentials,
          token: createWrongToken(credentials.token),
        }),
        "INVALID_SESSION",
      );
      expectError(
        await emitRawAction<RestoreSessionSuccessData>(
          attacker,
          SOCKET_EVENTS.SESSION_RESTORE,
          {
            ...credentials,
            clientInstanceId: SECOND_TEST_CLIENT_INSTANCE_ID,
            unexpected: true,
          },
        ),
        "INVALID_SESSION",
      );

      expect(
        getServer()
          .roomManager.getPublicRoomState(credentials.roomCode)
          .players.find(
            (player) => player.id === credentials.playerId,
          ),
      ).toMatchObject({ isConnected: false });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuse une restauration arrivée à la deadline puis expire le joueur",
    async () => {
      const room = await createTwoPlayerRoom("Expired");
      const credentials = room.guestSession.session;
      const disconnectedStatePromise = waitForRoomState(
        room.host,
        (state) =>
          state.players.some(
            (player) =>
              player.id === credentials.playerId &&
              !player.isConnected,
          ),
      );
      room.guest.disconnect();
      const disconnectedState = await disconnectedStatePromise;
      const reconnectDeadline = disconnectedState.players.find(
        (player) => player.id === credentials.playerId,
      )?.reconnectDeadline;
      if (reconnectDeadline === null || reconnectDeadline === undefined) {
        throw new Error("Une deadline de reconnexion était attendue.");
      }

      now = reconnectDeadline;
      const returningSocket = await connectClient();
      expectError(
        await restoreSession(returningSocket, credentials),
        "SESSION_EXPIRED",
      );

      const expiredStatePromise = waitForRoomState(
        room.host,
        (state) =>
          !state.players.some(
            (player) => player.id === credentials.playerId,
          ),
      );
      timers.runNext();
      await expiredStatePromise;
      expect(timers.pendingCount()).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "effectue un handoff actif avant le disconnect puis ignore l'ancien socket",
    async () => {
      const room = await createTwoPlayerRoom("Refresh");
      const credentials = room.hostSession.session;
      const internalHost = getServer()
        .roomManager.getRoomByCode(credentials.roomCode)
        ?.players.find(
          (player) => player.id === credentials.playerId,
        );
      if (internalHost === undefined) {
        throw new Error("L'hote interne est introuvable.");
      }
      internalHost.score = 12;

      const refreshedSocket = await connectClient();
      const oldSocketId = room.host.id;
      const refreshedSocketId = refreshedSocket.id;
      if (
        oldSocketId === undefined ||
        refreshedSocketId === undefined
      ) {
        throw new Error("Les sockets de test doivent etre connectes.");
      }
      const oldSocketDisconnected = new Promise<void>((resolve) => {
        room.host.once("disconnect", () => resolve());
      });
      const restored = expectSuccess(
        await restoreSession(
          refreshedSocket,
          credentials,
          TEST_CLIENT_INSTANCE_ID,
        ),
      );
      await oldSocketDisconnected;

      expect(restored.session).toEqual(credentials);
      expect(restored.room.playerCount).toBe(2);
      expect(restored.room.players).toContainEqual(
        expect.objectContaining({
          id: credentials.playerId,
          isHost: true,
          isConnected: true,
          reconnectDeadline: null,
          score: 12,
        }),
      );
      expect(JSON.stringify(restored.room)).not.toContain(
        TEST_CLIENT_INSTANCE_ID,
      );
      expect(room.host.connected).toBe(false);
      expect(
        getServer().roomManager.getPlayerRoomBySocketId(oldSocketId),
      ).toBeUndefined();
      expect(
        getServer().roomManager.getPlayerRoomBySocketId(
          refreshedSocketId,
        )?.code,
      ).toBe(credentials.roomCode);
      expect(
        getServer().roomManager.isActivePlayerSocket(
          refreshedSocketId,
        ),
      ).toBe(true);
      expect(timers.pendingCount()).toBe(0);
      expect(
        getServer().reconnectManager.getPendingTimerCount(),
      ).toBe(0);

      const repeated = expectSuccess(
        await restoreSession(
          refreshedSocket,
          credentials,
          TEST_CLIENT_INSTANCE_ID,
        ),
      );
      expect(repeated.room.playerCount).toBe(2);
      expect(
        getServer().roomManager.getRoomByCode(credentials.roomCode)
          ?.players,
      ).toHaveLength(2);
      expectSuccess(
        await emitRawAction<PublicRoomState>(
          refreshedSocket,
          SOCKET_EVENTS.PLAYER_SET_READY,
          { isReady: true },
        ),
      );
      expect(timers.pendingCount()).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuse qu'un second onglet prenne une session encore active",
    async () => {
      const activeSocket = await connectClient();
      const activeSession = expectSuccess(
        await createRoom(activeSocket, "Active"),
      );
      const secondTab = await connectClient();

      expectError(
        await restoreSession(secondTab, activeSession.session),
        "SESSION_ALREADY_ACTIVE",
      );
      expect(
        getServer()
          .roomManager.getPublicRoomState(
            activeSession.session.roomCode,
          )
          .players[0],
      ).toMatchObject({
        id: activeSession.session.playerId,
        isConnected: true,
      });
      expect(activeSocket.connected).toBe(true);
      expect(timers.pendingCount()).toBe(0);
      expectSuccess(
        await emitRawAction<PublicRoomState>(
          activeSocket,
          SOCKET_EVENTS.PLAYER_SET_READY,
          { isReady: true },
        ),
      );

      activeSocket.disconnect();
      await waitForCondition(
        () =>
          getServer()
            .roomManager.getRoomByCode(
              activeSession.session.roomCode,
            )
            ?.players[0]?.isConnected === false,
        "Le premier onglet n'a pas ete marque deconnecte.",
      );
      expect(timers.pendingCount()).toBe(1);

      const restoredSecondTab = expectSuccess(
        await restoreSession(
          secondTab,
          activeSession.session,
          SECOND_TEST_CLIENT_INSTANCE_ID,
        ),
      );
      expect(restoredSecondTab.room.players).toEqual([
        expect.objectContaining({
          id: activeSession.session.playerId,
          isHost: true,
          isConnected: true,
        }),
      ]);
      expect(timers.pendingCount()).toBe(0);
      expect(
        getServer().roomManager.getRoomByCode(
          activeSession.session.roomCode,
        )?.players[0],
      ).toMatchObject({
        socketId: secondTab.id,
        activeClientInstanceId: SECOND_TEST_CLIENT_INSTANCE_ID,
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "invalide définitivement les credentials après room:leave",
    async () => {
      const room = await createTwoPlayerRoom("Leave");
      const hostStatePromise = waitForRoomState(
        room.host,
        (state) =>
          !state.players.some(
            (player) =>
              player.id === room.guestSession.session.playerId,
          ),
      );

      expectSuccess(await leaveRoom(room.guest));
      const hostState = await hostStatePromise;
      expect(hostState.playerCount).toBe(1);

      const returningSocket = await connectClient();
      expectError(
        await restoreSession(
          returningSocket,
          room.guestSession.session,
        ),
        "PLAYER_NOT_FOUND",
      );
      expect(timers.pendingCount()).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "expire l'hôte absent du lobby et transfère immédiatement son rôle",
    async () => {
      const room = await createTwoPlayerRoom("Transfer");
      const hostId = room.hostSession.session.playerId;
      const guestId = room.guestSession.session.playerId;
      const disconnectedStatePromise = waitForRoomState(
        room.guest,
        (state) =>
          state.players.some(
            (player) =>
              player.id === hostId && !player.isConnected,
          ),
      );
      room.host.disconnect();
      const disconnectedState = await disconnectedStatePromise;
      const reconnectDeadline = disconnectedState.players.find(
        (player) => player.id === hostId,
      )?.reconnectDeadline;
      if (reconnectDeadline === null || reconnectDeadline === undefined) {
        throw new Error("Une deadline de reconnexion était attendue.");
      }

      const expiredStatePromise = waitForRoomState(
        room.guest,
        (state) =>
          state.playerCount === 1 &&
          state.players[0]?.id === guestId &&
          state.players[0].isHost,
      );
      now = reconnectDeadline;
      timers.runNext();
      const expiredState = await expiredStatePromise;

      expect(expiredState.players).toEqual([
        expect.objectContaining({
          id: guestId,
          isHost: true,
          isConnected: true,
        }),
      ]);
      expect(
        expiredState.players.some((player) => player.id === hostId),
      ).toBe(false);
      expect(timers.pendingCount()).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "supprime un salon vide à l'expiration de son dernier joueur",
    async () => {
      const host = await connectClient();
      const created = expectSuccess(await createRoom(host, "Solo"));
      host.disconnect();

      await waitForCondition(
        () => timers.pendingCount() === 1,
        "Le timer d'expiration du salon vide n'a pas été planifié.",
      );
      const retainedPlayer = getServer()
        .roomManager.getPublicRoomState(created.session.roomCode)
        .players[0];
      if (retainedPlayer?.reconnectDeadline === null ||
          retainedPlayer?.reconnectDeadline === undefined) {
        throw new Error("Une deadline de reconnexion était attendue.");
      }

      expect(retainedPlayer).toMatchObject({
        id: created.session.playerId,
        isConnected: false,
      });
      now = retainedPlayer.reconnectDeadline;
      timers.runNext();

      expect(
        getServer().roomManager.getRoomByCode(
          created.session.roomCode,
        ),
      ).toBeUndefined();
      expect(timers.pendingCount()).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "restaure un salon sans diffuser ni modifier l'état d'un second salon",
    async () => {
      const firstRoom = await createTwoPlayerRoom("First");
      const secondHost = await connectClient();
      const secondRoom = expectSuccess(
        await createRoom(secondHost, "SecondHost"),
      );
      const secondRoomSnapshot = structuredClone(secondRoom.room);
      const unrelatedUpdates: PublicRoomState[] = [];
      const captureSecondRoomUpdate = (state: PublicRoomState): void => {
        unrelatedUpdates.push(state);
      };
      secondHost.on(
        SOCKET_EVENTS.ROOM_STATE,
        captureSecondRoomUpdate,
      );

      const disconnectedStatePromise = waitForRoomState(
        firstRoom.guest,
        (state) =>
          state.players.some(
            (player) =>
              player.id === firstRoom.hostSession.session.playerId &&
              !player.isConnected,
          ),
      );
      firstRoom.host.disconnect();
      await disconnectedStatePromise;

      const restoredSocket = await connectClient();
      const restoredStatePromise = waitForRoomState(
        firstRoom.guest,
        (state) =>
          state.players.some(
            (player) =>
              player.id === firstRoom.hostSession.session.playerId &&
              player.isConnected,
          ),
      );
      expectSuccess(
        await restoreSession(
          restoredSocket,
          firstRoom.hostSession.session,
        ),
      );
      await restoredStatePromise;
      await new Promise((resolve) => setTimeout(resolve, 50));

      secondHost.off(
        SOCKET_EVENTS.ROOM_STATE,
        captureSecondRoomUpdate,
      );
      expect(firstRoom.hostSession.session.roomCode).not.toBe(
        secondRoom.session.roomCode,
      );
      expect(unrelatedUpdates).toEqual([]);
      expect(
        getServer().roomManager.getPublicRoomState(
          secondRoom.session.roomCode,
        ),
      ).toEqual(secondRoomSnapshot);
    },
    TEST_TIMEOUT_MS,
  );
});
