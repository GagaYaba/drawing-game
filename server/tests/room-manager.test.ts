import { describe, expect, it } from "vitest";

import {
  MAX_PLAYERS,
  RoomManager,
  RoomManagerError,
  type RoomManagerOptions,
} from "../src/rooms/room-manager.js";

const DEFAULT_CODES = [
  "7KXMP",
  "ABCDE",
  "FGHJK",
  "LMNPQ",
  "RSTUV",
  "WXYZ2",
];

function createTestManager(
  overrides: RoomManagerOptions = {},
): RoomManager {
  const codes = [...DEFAULT_CODES];
  let nextId = 1;
  let timestamp = 1_000;

  return new RoomManager({
    codeGenerator: () => codes.shift() ?? "ZZZZZ",
    idGenerator: () => `player-${nextId++}`,
    clock: () => timestamp++,
    ...overrides,
  });
}

function expectRoomError(
  action: () => unknown,
  code: RoomManagerError["code"],
): void {
  try {
    action();
    throw new Error("L'action aurait dû échouer.");
  } catch (error) {
    expect(error).toBeInstanceOf(RoomManagerError);
    expect((error as RoomManagerError).code).toBe(code);
  }
}

describe("RoomManager", () => {
  it("crée un salon avec un hôte et un état public sans socketId", () => {
    const manager = createTestManager();

    const result = manager.createRoom("socket-host", "Romane");

    expect(result.session).toMatchObject({
      roomCode: "7KXMP",
      playerId: "player-1",
      token: expect.any(String),
    });
    expect(result.room).toEqual({
      code: "7KXMP",
      players: [
        {
          id: "player-1",
          nickname: "Romane",
          isHost: true,
          isReady: false,
          isConnected: true,
          reconnectDeadline: null,
          score: 0,
        },
      ],
      playerCount: 1,
      maxPlayers: 8,
      minimumPlayersToStart: 3,
      allPlayersReady: false,
      canStart: false,
      game: null,
    });
    expect(result.room.players[0]).not.toHaveProperty("socketId");
    expect(result.room.players[0]).not.toHaveProperty("sessionTokenHash");
    expect(JSON.stringify(result.room)).not.toContain(result.session.token);
  });

  it("réessaie la génération jusqu'à obtenir un code unique", () => {
    const generatedCodes = ["ABCDE", "ABCDE", "FGHJK"];
    const manager = createTestManager({
      codeGenerator: () => generatedCodes.shift() ?? "LMNPQ",
    });

    expect(manager.createRoom("socket-1", "Alice").session.roomCode).toBe(
      "ABCDE",
    );
    expect(manager.createRoom("socket-2", "Bruno").session.roomCode).toBe(
      "FGHJK",
    );
  });

  it("normalise le pseudonyme et réduit les espaces consécutifs", () => {
    const manager = createTestManager();

    const result = manager.createRoom(
      "socket-host",
      "  Élodie   Dupond_2  ",
    );

    expect(result.room.players[0]?.nickname).toBe("Élodie Dupond_2");
  });

  it("rejette les pseudonymes trop courts, les contrôles et les symboles", () => {
    const manager = createTestManager();

    expectRoomError(
      () => manager.createRoom("socket-1", "A"),
      "INVALID_NICKNAME",
    );
    expectRoomError(
      () => manager.createRoom("socket-2", "Al\nice"),
      "INVALID_NICKNAME",
    );
    expectRoomError(
      () => manager.createRoom("socket-3", "Alice!"),
      "INVALID_NICKNAME",
    );
  });

  it("rejette un pseudonyme déjà utilisé sans tenir compte de la casse", () => {
    const manager = createTestManager();
    manager.createRoom("socket-host", "Élodie");

    expectRoomError(
      () => manager.joinRoom("socket-2", "éLODIE", "7KXMP"),
      "NICKNAME_ALREADY_USED",
    );

    const otherManager = createTestManager();
    otherManager.createRoom("socket-host", "Straße");
    expectRoomError(
      () => otherManager.joinRoom("socket-2", "STRASSE", "7KXMP"),
      "NICKNAME_ALREADY_USED",
    );
  });

  it("normalise le code et connecte un joueur non-hôte", () => {
    const manager = createTestManager();
    manager.createRoom("socket-host", "Alice");

    const result = manager.joinRoom("socket-2", "Bruno", "  7kxmp ");

    expect(result.session.roomCode).toBe("7KXMP");
    expect(result.room.players).toHaveLength(2);
    expect(result.room.players[1]).toMatchObject({
      id: "player-2",
      nickname: "Bruno",
      isHost: false,
      isReady: false,
    });
    expect(manager.getPlayerRoomBySocketId("socket-2")?.code).toBe("7KXMP");
  });

  it("rejette les codes invalides et les salons inexistants", () => {
    const manager = createTestManager();

    expectRoomError(
      () => manager.joinRoom("socket-1", "Alice", "O0I1A"),
      "INVALID_ROOM_CODE",
    );
    expectRoomError(
      () => manager.joinRoom("socket-2", "Bruno", "ABCDE"),
      "ROOM_NOT_FOUND",
    );
  });

  it("refuse un neuvième joueur", () => {
    const manager = createTestManager();
    manager.createRoom("socket-1", "P1");

    for (let index = 2; index <= MAX_PLAYERS; index += 1) {
      manager.joinRoom(`socket-${index}`, `P${index}`, "7KXMP");
    }

    expectRoomError(
      () => manager.joinRoom("socket-9", "P9", "7KXMP"),
      "ROOM_FULL",
    );
  });

  it("change le statut prêt du joueur identifié par son socket", () => {
    const manager = createTestManager();
    manager.createRoom("socket-host", "Alice");
    manager.joinRoom("socket-2", "Bruno", "7KXMP");

    const result = manager.setPlayerReady("socket-2", true);

    expect(result.code).toBe("7KXMP");
    expect(result.players[0]?.isReady).toBe(false);
    expect(result.players[1]?.isReady).toBe(true);
    expectRoomError(
      () =>
        manager.setPlayerReady(
          "socket-2",
          "true" as unknown as boolean,
        ),
      "INVALID_READY_STATUS",
    );
  });

  it("calcule allPlayersReady indépendamment du minimum de joueurs", () => {
    const manager = createTestManager();
    manager.createRoom("socket-1", "Alice");
    manager.joinRoom("socket-2", "Bruno", "7KXMP");

    manager.setPlayerReady("socket-1", true);
    const result = manager.setPlayerReady("socket-2", true);

    expect(result.allPlayersReady).toBe(true);
    expect(result.canStart).toBe(false);
  });

  it("active canStart uniquement quand au moins trois joueurs sont prêts", () => {
    const manager = createTestManager();
    manager.createRoom("socket-1", "Alice");
    manager.joinRoom("socket-2", "Bruno", "7KXMP");
    manager.joinRoom("socket-3", "Chloé", "7KXMP");

    manager.setPlayerReady("socket-1", true);
    manager.setPlayerReady("socket-2", true);
    const beforeEveryoneIsReady = manager.setPlayerReady("socket-3", false);
    const everyoneIsReady = manager.setPlayerReady("socket-3", true);

    expect(beforeEveryoneIsReady.canStart).toBe(false);
    expect(everyoneIsReady.allPlayersReady).toBe(true);
    expect(everyoneIsReady.canStart).toBe(true);
  });

  it("retire un joueur et renvoie l'état restant aux handlers", () => {
    const manager = createTestManager();
    manager.createRoom("socket-host", "Alice");
    const joined = manager.joinRoom("socket-2", "Bruno", "7KXMP");

    const result = manager.leaveRoom("socket-2");

    expect(result).toMatchObject({
      roomCode: "7KXMP",
      playerId: joined.session.playerId,
      roomDeleted: false,
    });
    expect(result.room?.players.map((player) => player.nickname)).toEqual([
      "Alice",
    ]);
    expect(manager.getPlayerRoomBySocketId("socket-2")).toBeUndefined();
  });

  it("supprime un salon devenu vide", () => {
    const manager = createTestManager();
    manager.createRoom("socket-host", "Alice");

    const result = manager.leaveRoom("socket-host");

    expect(result.room).toBeNull();
    expect(result.roomDeleted).toBe(true);
    expect(manager.getRoomByCode("7KXMP")).toBeUndefined();
  });

  it("transfère le rôle d'hôte au joueur restant le plus ancien", () => {
    const joinedTimes = [100, 300, 200];
    const manager = createTestManager({
      clock: () => joinedTimes.shift() ?? 400,
    });
    manager.createRoom("socket-host", "Alice");
    manager.joinRoom("socket-later", "Bruno", "7KXMP");
    manager.joinRoom("socket-older", "Chloé", "7KXMP");

    const disconnected = manager.markPlayerDisconnected(
      "socket-host",
      500,
      600,
    );
    if (disconnected === null) {
      throw new Error("L’hôte aurait dû être marqué déconnecté.");
    }
    const result = manager.removePlayerById(
      disconnected.roomCode,
      disconnected.playerId,
    );

    expect(result?.room?.players.filter((player) => player.isHost)).toEqual([
      expect.objectContaining({ nickname: "Chloé" }),
    ]);
  });

  it("interdit à un socket de créer ou rejoindre un deuxième salon", () => {
    const manager = createTestManager();
    manager.createRoom("socket-1", "Alice");
    manager.createRoom("socket-2", "Bruno");

    expectRoomError(
      () => manager.createRoom("socket-1", "Chloé"),
      "ALREADY_IN_ROOM",
    );
    expectRoomError(
      () => manager.joinRoom("socket-1", "Chloé", "ABCDE"),
      "ALREADY_IN_ROOM",
    );
  });

  it("traite sans erreur la déconnexion d'un socket hors salon", () => {
    const manager = createTestManager();

    expect(
      manager.markPlayerDisconnected("unknown-socket", 500, 600),
    ).toBeNull();
    expectRoomError(
      () => manager.leaveRoom("unknown-socket"),
      "NOT_IN_ROOM",
    );
  });
});
