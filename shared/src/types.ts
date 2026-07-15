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

export type GamePhase = "LOBBY" | "ROUND_INTRO" | "DRAWING";

export interface PublicGameState {
  phase: GamePhase;
  totalRounds: number;
  currentRound: number;
  currentTurnNumber: number;
  totalTurns: number;
  currentDrawer: {
    id: string;
    nickname: string;
  };
  prompt: {
    id: string;
    text: string;
  };
  phaseEndsAt: number | null;
}

export interface PublicRoomState {
  code: string;
  players: PublicPlayer[];
  playerCount: number;
  maxPlayers: number;
  minimumPlayersToStart: number;
  allPlayersReady: boolean;
  canStart: boolean;
  game: PublicGameState | null;
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
  | "INVALID_GAME_START_REQUEST"
  | "NOT_HOST"
  | "NOT_ENOUGH_PLAYERS"
  | "PLAYERS_NOT_READY"
  | "GAME_ALREADY_STARTED"
  | "GAME_NOT_IN_LOBBY"
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

export interface StartGameSuccessData {
  room: PublicRoomState;
}

export interface TurnSecretPayload {
  roomCode: string;
  drawerPlayerId: string;
  secretLevel: number;
}

export type GameCancellationReason =
  | "PLAYER_LEFT"
  | "PLAYER_DISCONNECTED";

export interface GameCancelledPayload {
  reason: GameCancellationReason;
  message: string;
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
  [SOCKET_EVENTS.GAME_START]: (
    acknowledge: ActionAcknowledgement<StartGameSuccessData>,
  ) => void;
}

export interface ServerToClientEvents {
  [SOCKET_EVENTS.SERVER_PONG]: (payload: ServerPongPayload) => void;
  [SOCKET_EVENTS.ROOM_STATE]: (payload: PublicRoomState) => void;
  [SOCKET_EVENTS.TURN_SECRET]: (payload: TurnSecretPayload) => void;
  [SOCKET_EVENTS.GAME_CANCELLED]: (payload: GameCancelledPayload) => void;
}

export interface HealthResponse {
  status: "ok";
  service: "drawing-game-server";
}
