import type {
  PublicRoomState,
  RoomErrorCode,
  RoomSessionData,
} from "@drawing-game/shared";
import type { InternalGame } from "../game/game-types.js";

export type { RoomErrorCode } from "@drawing-game/shared";

export interface InternalPlayer {
  id: string;
  socketId: string;
  nickname: string;
  isHost: boolean;
  isReady: boolean;
  joinedAt: number;
  score: number;
}

export interface InternalRoom {
  code: string;
  players: InternalPlayer[];
  createdAt: number;
  game: InternalGame | null;
}

export type RoomCodeGenerator = () => string;
export type PlayerIdGenerator = () => string;
export type Clock = () => number;

export interface RoomManagerOptions {
  codeGenerator?: RoomCodeGenerator;
  idGenerator?: PlayerIdGenerator;
  clock?: Clock;
  maxCodeGenerationAttempts?: number;
}

export type CreateRoomResult = RoomSessionData;
export type JoinRoomResult = RoomSessionData;

export interface RoomDepartureResult {
  roomCode: string;
  playerId: string;
  room: PublicRoomState | null;
  roomDeleted: boolean;
}

export class RoomManagerError extends Error {
  readonly code: RoomErrorCode;

  constructor(code: RoomErrorCode, message: string) {
    super(message);
    this.name = "RoomManagerError";
    this.code = code;
  }
}
