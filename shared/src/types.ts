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

export type GamePhase =
  | "LOBBY"
  | "ROUND_INTRO"
  | "DRAWING"
  | "VOTING"
  | "REVEAL";

export type GuessValue = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

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

export interface PublicVotingState {
  eligibleVoterCount: number;
  submittedGuessCount: number;
}

export interface PublicGuessResult {
  player: {
    id: string;
    nickname: string;
  };
  value: GuessValue;
  distance: number;
}

export interface PublicRevealState {
  secretLevel: GuessValue;
  guesses: PublicGuessResult[];
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
  voting: PublicVotingState | null;
  reveal: PublicRevealState | null;
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

export interface SubmitGuessPayload {
  value: number;
}

export interface SubmitGuessSuccessData {
  value: GuessValue;
  submittedAt: number;
}

export type GuessErrorCode =
  | "GAME_NOT_STARTED"
  | "NOT_VOTING_PHASE"
  | "DRAWER_CANNOT_GUESS"
  | "PLAYER_NOT_ELIGIBLE"
  | "GUESS_ALREADY_SUBMITTED"
  | "INVALID_GUESS";

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
  | "NOT_DRAWING_PHASE"
  | "NOT_CURRENT_DRAWER"
  | "EMPTY_DRAWING"
  | "INVALID_DRAWING"
  | "DRAWING_TOO_LARGE"
  | "DRAWING_ALREADY_SUBMITTED"
  | GuessErrorCode
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
  [SOCKET_EVENTS.GUESS_SUBMIT]: (
    payload: SubmitGuessPayload,
    acknowledge: ActionAcknowledgement<SubmitGuessSuccessData>,
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
