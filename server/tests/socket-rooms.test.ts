import type { AddressInfo } from "node:net";

import {
  SOCKET_EVENTS,
  type ActionAcknowledgement,
  type ActionResult,
  type ClientToServerEvents,
  type PublicRoomState,
  type RoomErrorCode,
  type RoomSessionData,
  type ServerPongPayload,
  type ServerToClientEvents,
} from "@drawing-game/shared";
import { io as createSocketClient, type Socket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDrawingGameServer } from "../src/create-server.js";

type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>;
type DrawingGameServer = ReturnType<typeof createDrawingGameServer>;

const ASYNC_TIMEOUT_MS = 3_000;
const TEST_TIMEOUT_MS = 10_000;

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

function emitRawAction<T>(
  socket: TestClient,
  eventName: string,
  payload: unknown,
): Promise<ActionResult<T>> {
  return waitForAcknowledgement((acknowledge) => {
    Reflect.apply(socket.emit, socket, [eventName, payload, acknowledge]);
  });
}

function emitRawActionWithoutPayload<T>(
  socket: TestClient,
  eventName: string,
): Promise<ActionResult<T>> {
  return waitForAcknowledgement((acknowledge) => {
    Reflect.apply(socket.emit, socket, [eventName, acknowledge]);
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

function leaveRoomWithExtraneousPayload(
  socket: TestClient,
): Promise<ActionResult<null>> {
  return waitForAcknowledgement((acknowledge) => {
    Reflect.apply(socket.emit, socket, [
      SOCKET_EVENTS.ROOM_LEAVE,
      { ignored: true },
      acknowledge,
    ]);
  });
}

function waitForRoomState(
  socket: TestClient,
  predicate: (state: PublicRoomState) => boolean = () => true,
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

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

beforeEach(async () => {
  clients = [];
  const createdServer = createDrawingGameServer({
    serveClient: false,
    reconnectGraceMs: 0,
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

describe("Socket.IO room integration", () => {
  it(
    "creates a room, lets a second client join, and broadcasts the same public state",
    async () => {
      const host = await connectClient();
      const guest = await connectClient();

      const initialStatePromise = waitForRoomState(
        host,
        (state) => state.playerCount === 1,
      );
      const creation = expectSuccess(await createRoom(host, "Alice"));
      const initialState = await initialStatePromise;

      expect(creation.session.roomCode).toMatch(/^[A-Z0-9]{5}$/);
      expect(creation.session.playerId).toBe(initialState.players[0]?.id);
      expect(creation.session.token).toEqual(expect.any(String));
      expect(creation.room).toEqual(initialState);
      expect(initialState.players[0]).toMatchObject({
        nickname: "Alice",
        isHost: true,
        isReady: false,
        isConnected: true,
        reconnectDeadline: null,
      });
      expect(JSON.stringify(initialState)).not.toContain(creation.session.token);

      const hostUpdatePromise = waitForRoomState(
        host,
        (state) => state.playerCount === 2,
      );
      const guestUpdatePromise = waitForRoomState(
        guest,
        (state) => state.playerCount === 2,
      );
      const join = expectSuccess(
        await joinRoom(
          guest,
          "Bob",
          creation.session.roomCode.toLowerCase(),
        ),
      );
      const [hostState, guestState] = await Promise.all([
        hostUpdatePromise,
        guestUpdatePromise,
      ]);

      expect(join.session.roomCode).toBe(creation.session.roomCode);
      expect(join.session.playerId).not.toBe(creation.session.playerId);
      expect(join.room).toEqual(hostState);
      expect(guestState).toEqual(hostState);
      expect(hostState.players.map((player) => player.nickname)).toEqual([
        "Alice",
        "Bob",
      ]);
      for (const player of hostState.players) {
        expect(player).not.toHaveProperty("socketId");
        expect(player).not.toHaveProperty("sessionTokenHash");
      }
      expect(JSON.stringify(hostState)).not.toContain(join.session.token);
      expect(hostState).toMatchObject({
        code: creation.session.roomCode,
        playerCount: 2,
        maxPlayers: 8,
        minimumPlayersToStart: 3,
        allPlayersReady: false,
        canStart: false,
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "returns stable errors for an unknown room and a duplicate nickname",
    async () => {
      const host = await connectClient();
      const guest = await connectClient();

      expectError(await joinRoom(guest, "Bob", "ABCDE"), "ROOM_NOT_FOUND");

      const creation = expectSuccess(await createRoom(host, "Romane"));
      expectError(
        await joinRoom(
          guest,
          "  romane  ",
          creation.session.roomCode,
        ),
        "NICKNAME_ALREADY_USED",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "acknowledges malformed payloads without breaking the connection",
    async () => {
      const socket = await connectClient();
      const otherSocket = await connectClient();

      expectError(
        await emitRawActionWithoutPayload<RoomSessionData>(
          socket,
          SOCKET_EVENTS.ROOM_CREATE,
        ),
        "INVALID_NICKNAME",
      );
      expectError(
        await emitRawAction<PublicRoomState>(
          socket,
          SOCKET_EVENTS.PLAYER_SET_READY,
          { isReady: "yes" },
        ),
        "INVALID_READY_STATUS",
      );

      Reflect.apply(socket.emit, socket, [SOCKET_EVENTS.CLIENT_PING, null]);
      await delay(25);

      const created = expectSuccess(await createRoom(socket, "Alice"));
      expectError(
        await emitRawActionWithoutPayload<RoomSessionData>(
          otherSocket,
          SOCKET_EVENTS.ROOM_JOIN,
        ),
        "INVALID_NICKNAME",
      );
      expectError(
        await emitRawActionWithoutPayload<PublicRoomState>(
          socket,
          SOCKET_EVENTS.PLAYER_SET_READY,
        ),
        "INVALID_READY_STATUS",
      );

      expect(created.session.roomCode).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
      expect(socket.connected).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "prevents one socket from joining a second application room",
    async () => {
      const firstHost = await connectClient();
      const secondHost = await connectClient();

      expectSuccess(await createRoom(firstHost, "Alice"));
      const secondRoom = expectSuccess(await createRoom(secondHost, "Bob"));

      expectError(
        await joinRoom(
          firstHost,
          "Alice bis",
          secondRoom.session.roomCode,
        ),
        "ALREADY_IN_ROOM",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "broadcasts ready changes and enables canStart only for three ready players",
    async () => {
      const host = await connectClient();
      const second = await connectClient();
      const third = await connectClient();
      const sockets = [host, second, third];

      const creation = expectSuccess(await createRoom(host, "Alice"));
      expectSuccess(
        await joinRoom(second, "Bob", creation.session.roomCode),
      );
      expectSuccess(
        await joinRoom(third, "Chloé", creation.session.roomCode),
      );

      for (const [index, socket] of sockets.entries()) {
        const expectedReadyCount = index + 1;
        const updates = sockets.map((recipient) =>
          waitForRoomState(
            recipient,
            (state) =>
              state.players.filter((player) => player.isReady).length ===
              expectedReadyCount,
          ),
        );

        const acknowledgedState = expectSuccess(await setReady(socket, true));
        const states = await Promise.all(updates);

        for (const state of states) {
          expect(state).toEqual(acknowledgedState);
          expect(state.playerCount).toBe(3);
          expect(state.canStart).toBe(expectedReadyCount === 3);
          expect(state.allPlayersReady).toBe(expectedReadyCount === 3);
        }
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "removes a disconnected host and transfers ownership to the oldest remaining player",
    async () => {
      const host = await connectClient();
      const second = await connectClient();
      const third = await connectClient();

      const creation = expectSuccess(await createRoom(host, "Alice"));
      const secondSession = expectSuccess(
        await joinRoom(second, "Bob", creation.session.roomCode),
      );
      const thirdSession = expectSuccess(
        await joinRoom(third, "Chloé", creation.session.roomCode),
      );

      const secondUpdatePromise = waitForRoomState(
        second,
        (state) =>
          state.playerCount === 2 &&
          !state.players.some(
            (player) => player.id === creation.session.playerId,
          ),
      );
      const thirdUpdatePromise = waitForRoomState(
        third,
        (state) =>
          state.playerCount === 2 &&
          !state.players.some(
            (player) => player.id === creation.session.playerId,
          ),
      );
      host.disconnect();

      const [secondState, thirdState] = await Promise.all([
        secondUpdatePromise,
        thirdUpdatePromise,
      ]);
      expect(thirdState).toEqual(secondState);
      expect(secondState.players.map((player) => player.id)).toEqual([
        secondSession.session.playerId,
        thirdSession.session.playerId,
      ]);
      expect(secondState.players.filter((player) => player.isHost)).toHaveLength(
        1,
      );
      expect(secondState.players.find((player) => player.isHost)?.id).toBe(
        secondSession.session.playerId,
      );
      expect(
        secondState.players.some(
          (player) => player.id === creation.session.playerId,
        ),
      ).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "lets the host leave voluntarily and broadcasts the ownership transfer",
    async () => {
      const host = await connectClient();
      const guest = await connectClient();
      const creation = expectSuccess(await createRoom(host, "Alice"));
      const guestSession = expectSuccess(
        await joinRoom(guest, "Bob", creation.session.roomCode),
      );
      const guestUpdatePromise = waitForRoomState(
        guest,
        (state) => state.playerCount === 1,
      );

      expectSuccess(await leaveRoomWithExtraneousPayload(host));
      const guestState = await guestUpdatePromise;

      expect(guestState.players).toEqual([
        expect.objectContaining({
          id: guestSession.session.playerId,
          nickname: "Bob",
          isHost: true,
        }),
      ]);
      if (server === undefined || host.id === undefined) {
        throw new Error("Expected an active test server and connected host");
      }
      expect(server.roomManager.getPlayerRoomBySocketId(host.id)).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps room membership and room:state broadcasts isolated",
    async () => {
      const firstHost = await connectClient();
      const firstGuest = await connectClient();
      const secondHost = await connectClient();

      const firstCreationState = waitForRoomState(firstHost);
      const firstRoom = expectSuccess(await createRoom(firstHost, "Alice"));
      await firstCreationState;

      const secondCreationState = waitForRoomState(secondHost);
      const secondRoom = expectSuccess(await createRoom(secondHost, "Chloé"));
      await secondCreationState;

      const unrelatedUpdates: PublicRoomState[] = [];
      const captureUnrelatedUpdate = (state: PublicRoomState): void => {
        unrelatedUpdates.push(state);
      };
      secondHost.on(SOCKET_EVENTS.ROOM_STATE, captureUnrelatedUpdate);

      const firstHostUpdate = waitForRoomState(
        firstHost,
        (state) => state.playerCount === 2,
      );
      const firstGuestUpdate = waitForRoomState(
        firstGuest,
        (state) => state.playerCount === 2,
      );
      expectSuccess(
        await joinRoom(firstGuest, "Bob", firstRoom.session.roomCode),
      );
      const [hostState, guestState] = await Promise.all([
        firstHostUpdate,
        firstGuestUpdate,
      ]);
      await delay(100);

      secondHost.off(SOCKET_EVENTS.ROOM_STATE, captureUnrelatedUpdate);
      expect(guestState).toEqual(hostState);
      expect(hostState.code).toBe(firstRoom.session.roomCode);
      expect(hostState.players.map((player) => player.nickname)).toEqual([
        "Alice",
        "Bob",
      ]);
      expect(secondRoom.room.code).toBe(secondRoom.session.roomCode);
      expect(secondRoom.room.players.map((player) => player.nickname)).toEqual([
        "Chloé",
      ]);
      expect(secondRoom.session.roomCode).not.toBe(
        firstRoom.session.roomCode,
      );
      expect(unrelatedUpdates).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "preserves the client:ping/server:pong diagnostic exchange",
    async () => {
      const socket = await connectClient();
      const sentAt = Date.now();
      const pongPromise = waitForPong(socket);

      socket.emit(SOCKET_EVENTS.CLIENT_PING, { sentAt });

      await expect(pongPromise).resolves.toMatchObject({ sentAt });
      const pong = await pongPromise;
      expect(pong.receivedAt).toBeGreaterThanOrEqual(sentAt);
    },
    TEST_TIMEOUT_MS,
  );
});
