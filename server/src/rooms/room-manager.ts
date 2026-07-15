import { randomInt, randomUUID } from "node:crypto";

import type { PublicPlayer, PublicRoomState } from "@drawing-game/shared";

import { toPublicGameState } from "../game/game-manager.js";

import {
  getNicknameComparisonKey,
  normalizeNickname,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  validateReadyStatus,
} from "./room-validation.js";
import {
  RoomManagerError,
  type CreateRoomResult,
  type InternalPlayer,
  type InternalRoom,
  type JoinRoomResult,
  type RoomDepartureResult,
  type RoomManagerOptions,
} from "./room-types.js";

export { RoomManagerError } from "./room-types.js";
export type {
  Clock,
  CreateRoomResult,
  InternalPlayer,
  InternalRoom,
  JoinRoomResult,
  PlayerIdGenerator,
  RoomCodeGenerator,
  RoomDepartureResult,
  RoomErrorCode,
  RoomManagerOptions,
} from "./room-types.js";

export const MAX_PLAYERS = 8;
export const MINIMUM_PLAYERS_TO_START = 3;

const DEFAULT_MAX_CODE_GENERATION_ATTEMPTS = 100;

function createRandomRoomCode(): string {
  let code = "";

  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_CODE_ALPHABET.charAt(randomInt(ROOM_CODE_ALPHABET.length));
  }

  return code;
}

export class RoomManager {
  private readonly rooms = new Map<string, InternalRoom>();
  private readonly roomCodeBySocketId = new Map<string, string>();
  private readonly codeGenerator: () => string;
  private readonly idGenerator: () => string;
  private readonly clock: () => number;
  private readonly maxCodeGenerationAttempts: number;

  constructor(options: RoomManagerOptions = {}) {
    this.codeGenerator = options.codeGenerator ?? createRandomRoomCode;
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.clock = options.clock ?? Date.now;
    this.maxCodeGenerationAttempts =
      options.maxCodeGenerationAttempts ?? DEFAULT_MAX_CODE_GENERATION_ATTEMPTS;

    if (
      !Number.isSafeInteger(this.maxCodeGenerationAttempts) ||
      this.maxCodeGenerationAttempts < 1
    ) {
      throw new RangeError("maxCodeGenerationAttempts doit être un entier positif.");
    }
  }

  createRoom(socketId: string, nickname: string): CreateRoomResult {
    this.assertSocketIsAvailable(socketId);
    const normalizedNickname = normalizeNickname(nickname);
    const code = this.generateUniqueRoomCode();
    const timestamp = this.clock();
    const player = this.createPlayer(
      socketId,
      normalizedNickname,
      true,
      timestamp,
    );
    const room: InternalRoom = {
      code,
      players: [player],
      createdAt: timestamp,
      game: null,
    };

    this.rooms.set(code, room);
    this.roomCodeBySocketId.set(socketId, code);

    return {
      roomCode: code,
      playerId: player.id,
      room: this.toPublicRoomState(room),
    };
  }

  joinRoom(
    socketId: string,
    nickname: string,
    roomCode: string,
  ): JoinRoomResult {
    this.assertSocketIsAvailable(socketId);
    const code = normalizeRoomCode(roomCode);
    const normalizedNickname = normalizeNickname(nickname);
    const room = this.rooms.get(code);

    if (!room) {
      throw new RoomManagerError(
        "ROOM_NOT_FOUND",
        "Aucun salon ne correspond à ce code.",
      );
    }

    if (room.game !== null) {
      throw new RoomManagerError(
        "GAME_ALREADY_STARTED",
        "Cette partie a déjà commencé.",
      );
    }

    if (room.players.length >= MAX_PLAYERS) {
      throw new RoomManagerError(
        "ROOM_FULL",
        "Ce salon a déjà atteint sa limite de joueurs.",
      );
    }

    const nicknameKey = getNicknameComparisonKey(normalizedNickname);
    const nicknameAlreadyUsed = room.players.some(
      (player) => getNicknameComparisonKey(player.nickname) === nicknameKey,
    );

    if (nicknameAlreadyUsed) {
      throw new RoomManagerError(
        "NICKNAME_ALREADY_USED",
        "Ce pseudonyme est déjà utilisé dans le salon.",
      );
    }

    const player = this.createPlayer(
      socketId,
      normalizedNickname,
      false,
      this.clock(),
    );
    room.players.push(player);
    this.roomCodeBySocketId.set(socketId, code);

    return {
      roomCode: code,
      playerId: player.id,
      room: this.toPublicRoomState(room),
    };
  }

  leaveRoom(socketId: string): RoomDepartureResult {
    const roomCode = this.roomCodeBySocketId.get(socketId);

    if (!roomCode) {
      throw new RoomManagerError(
        "NOT_IN_ROOM",
        "Cette connexion n'appartient à aucun salon.",
      );
    }

    return this.removePlayer(socketId, roomCode);
  }

  handleSocketDisconnect(socketId: string): RoomDepartureResult | null {
    const roomCode = this.roomCodeBySocketId.get(socketId);

    if (!roomCode) {
      return null;
    }

    return this.removePlayer(socketId, roomCode);
  }

  setPlayerReady(
    socketId: string,
    isReady: boolean,
  ): PublicRoomState {
    const readyStatus = validateReadyStatus(isReady);
    const roomCode = this.roomCodeBySocketId.get(socketId);

    if (!roomCode) {
      throw new RoomManagerError(
        "NOT_IN_ROOM",
        "Cette connexion n'appartient à aucun salon.",
      );
    }

    const room = this.rooms.get(roomCode);
    const player = room?.players.find(
      (candidate) => candidate.socketId === socketId,
    );

    if (!room || !player) {
      this.roomCodeBySocketId.delete(socketId);
      throw new RoomManagerError(
        "PLAYER_NOT_FOUND",
        "Le joueur associé à cette connexion est introuvable.",
      );
    }


    if (room.game !== null) {
      throw new RoomManagerError(
        "GAME_ALREADY_STARTED",
        "Cette partie a déjà commencé.",
      );
    }

    player.isReady = readyStatus;

    return this.toPublicRoomState(room);
  }

  getRoomByCode(roomCode: string): InternalRoom | undefined {
    try {
      return this.rooms.get(normalizeRoomCode(roomCode));
    } catch (error) {
      if (error instanceof RoomManagerError) {
        return undefined;
      }

      throw error;
    }
  }

  getPlayerRoomBySocketId(socketId: string): InternalRoom | undefined {
    const roomCode = this.roomCodeBySocketId.get(socketId);
    return roomCode ? this.rooms.get(roomCode) : undefined;
  }

  getPublicRoomState(roomCode: string): PublicRoomState {
    const code = normalizeRoomCode(roomCode);
    const room = this.rooms.get(code);

    if (!room) {
      throw new RoomManagerError(
        "ROOM_NOT_FOUND",
        "Aucun salon ne correspond à ce code.",
      );
    }

    return this.toPublicRoomState(room);
  }

  private assertSocketIsAvailable(socketId: string): void {
    if (this.roomCodeBySocketId.has(socketId)) {
      throw new RoomManagerError(
        "ALREADY_IN_ROOM",
        "Cette connexion appartient déjà à un salon.",
      );
    }
  }

  private createPlayer(
    socketId: string,
    nickname: string,
    isHost: boolean,
    joinedAt: number,
  ): InternalPlayer {
    return {
      id: this.idGenerator(),
      socketId,
      nickname,
      isHost,
      isReady: false,
      joinedAt,
    };
  }

  private generateUniqueRoomCode(): string {
    for (
      let attempt = 0;
      attempt < this.maxCodeGenerationAttempts;
      attempt += 1
    ) {
      let code: string;

      try {
        code = normalizeRoomCode(this.codeGenerator());
      } catch {
        throw new RoomManagerError(
          "INTERNAL_ERROR",
          "Le générateur de codes de salon a produit un code invalide.",
        );
      }

      if (!this.rooms.has(code)) {
        return code;
      }
    }

    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Impossible de générer un code de salon unique.",
    );
  }

  private removePlayer(
    socketId: string,
    roomCode: string,
  ): RoomDepartureResult {
    const room = this.rooms.get(roomCode);
    const playerIndex = room?.players.findIndex(
      (player) => player.socketId === socketId,
    );

    if (!room || playerIndex === undefined || playerIndex < 0) {
      this.roomCodeBySocketId.delete(socketId);
      throw new RoomManagerError(
        "PLAYER_NOT_FOUND",
        "Le joueur associé à cette connexion est introuvable.",
      );
    }

    const [departingPlayer] = room.players.splice(playerIndex, 1);
    this.roomCodeBySocketId.delete(socketId);

    if (!departingPlayer) {
      throw new RoomManagerError(
        "PLAYER_NOT_FOUND",
        "Le joueur associé à cette connexion est introuvable.",
      );
    }

    if (room.players.length === 0) {
      this.rooms.delete(roomCode);

      return {
        roomCode,
        playerId: departingPlayer.id,
        room: null,
        roomDeleted: true,
      };
    }

    if (departingPlayer.isHost) {
      for (const player of room.players) {
        player.isHost = false;
      }

      const oldestPlayer = room.players.reduce((oldest, player) =>
        player.joinedAt < oldest.joinedAt ? player : oldest,
      );
      oldestPlayer.isHost = true;
    }

    return {
      roomCode,
      playerId: departingPlayer.id,
      room: this.toPublicRoomState(room),
      roomDeleted: false,
    };
  }

  private toPublicRoomState(room: InternalRoom): PublicRoomState {
    const players: PublicPlayer[] = room.players.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      isHost: player.isHost,
      isReady: player.isReady,
    }));
    const allPlayersReady =
      players.length > 0 && players.every((player) => player.isReady);

    return {
      code: room.code,
      players,
      playerCount: players.length,
      maxPlayers: MAX_PLAYERS,
      minimumPlayersToStart: MINIMUM_PLAYERS_TO_START,
      allPlayersReady,
      canStart:
        room.game === null &&
        players.length >= MINIMUM_PLAYERS_TO_START &&
        allPlayersReady,
      game:
        room.game === null
          ? null
          : toPublicGameState(room.game, room.players),
    };
  }
}
