import { SOCKET_EVENTS } from "./events.js";
import type { DrawingDocument } from "./drawing.js";

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

export type GamePhase = "LOBBY" | "ROUND_INTRO" | "DRAWING" | "VOTING";

export interface PublicSubmittedDrawing {
  document: DrawingDocument;
  submittedAt: number;
}

export interface PublicGamePrompt {
  id: string;
  statement: string;
  lowLabel: string;
  highLabel: string;
}

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
  prompt: PublicGamePrompt;
  phaseEndsAt: number | null;
  submittedDrawing: PublicSubmittedDrawing | null;
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

export interface SubmitDrawingPayload {
  drawing: DrawingDocument;
}

export interface SubmitDrawingSuccessData {
  room: PublicRoomState;
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
  | "GAME_NOT_STARTED"
  | "NOT_DRAWING_PHASE"
  | "NOT_CURRENT_DRAWER"
  | "EMPTY_DRAWING"
  | "INVALID_DRAWING"
  | "DRAWING_TOO_LARGE"
  | "DRAWING_ALREADY_SUBMITTED"
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
  [SOCKET_EVENTS.DRAWING_SUBMIT]: (
    payload: SubmitDrawingPayload,
    acknowledge: ActionAcknowledgement<SubmitDrawingSuccessData>,
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
