import { SOCKET_EVENTS } from "./events.js";

export interface ClientPingPayload {
  sentAt: number;
}

export interface ServerPongPayload {
  sentAt: number;
  receivedAt: number;
}

export interface PublicPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  isReady: boolean;
}

export interface PublicRoomState {
  code: string;
  players: PublicPlayer[];
  playerCount: number;
  maxPlayers: number;
  minimumPlayersToStart: number;
  allPlayersReady: boolean;
  canStart: boolean;
}

export interface CreateRoomPayload {
  nickname: string;
}

export interface JoinRoomPayload {
  nickname: string;
  roomCode: string;
}

export interface SetPlayerReadyPayload {
  isReady: boolean;
}

export type RoomErrorCode =
  | "INVALID_NICKNAME"
  | "INVALID_ROOM_CODE"
  | "INVALID_READY_STATUS"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "NICKNAME_ALREADY_USED"
  | "ALREADY_IN_ROOM"
  | "NOT_IN_ROOM"
  | "PLAYER_NOT_FOUND"
  | "INTERNAL_ERROR";

export type ActionResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: {
        code: RoomErrorCode;
        message: string;
      };
    };

export interface RoomSessionData {
  roomCode: string;
  playerId: string;
  room: PublicRoomState;
}

export type ActionAcknowledgement<T> = (result: ActionResult<T>) => void;

export interface ClientToServerEvents {
  [SOCKET_EVENTS.CLIENT_PING]: (payload: ClientPingPayload) => void;
  [SOCKET_EVENTS.ROOM_CREATE]: (
    payload: CreateRoomPayload,
    acknowledge: ActionAcknowledgement<RoomSessionData>,
  ) => void;
  [SOCKET_EVENTS.ROOM_JOIN]: (
    payload: JoinRoomPayload,
    acknowledge: ActionAcknowledgement<RoomSessionData>,
  ) => void;
  [SOCKET_EVENTS.ROOM_LEAVE]: (
    acknowledge: ActionAcknowledgement<null>,
  ) => void;
  [SOCKET_EVENTS.PLAYER_SET_READY]: (
    payload: SetPlayerReadyPayload,
    acknowledge: ActionAcknowledgement<PublicRoomState>,
  ) => void;
}

export interface ServerToClientEvents {
  [SOCKET_EVENTS.SERVER_PONG]: (payload: ServerPongPayload) => void;
  [SOCKET_EVENTS.ROOM_STATE]: (payload: PublicRoomState) => void;
}

export interface HealthResponse {
  status: "ok";
  service: "drawing-game-server";
}
