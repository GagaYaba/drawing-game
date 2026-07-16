import type {
  DrawingDocument,
  GamePhase,
  PublicGamePrompt,
  PublicRoomState,
  TurnSecretPayload,
} from "@drawing-game/shared";

export interface DrawingPrompt extends PublicGamePrompt {
  category: string;
}

export interface InternalTurn {
  drawerPlayerId: string;
  prompt: DrawingPrompt;
  secretLevel: number;
  drawing: DrawingDocument | null;
  drawingSubmittedAt: number | null;
}

export interface InternalGame {
  phase: Exclude<GamePhase, "LOBBY">;
  totalRounds: number;
  currentRound: number;
  turnOrder: string[];
  currentDrawerIndex: number;
  currentTurn: InternalTurn;
  startedAt: number;
  phaseEndsAt: number | null;
}

export type GameClock = () => number;
export type PlayerOrderShuffler = (playerIds: readonly string[]) => string[];
export type DrawingPromptSelector = (
  prompts: readonly DrawingPrompt[],
) => DrawingPrompt;
export type SecretLevelGenerator = () => number;
export type GameTimerScheduler = (
  callback: () => void,
  delayMilliseconds: number,
) => unknown;
export type GameTimerClearer = (handle: unknown) => void;

export interface GameManagerOptions {
  clock?: GameClock;
  introDurationMs?: number;
  prompts?: readonly DrawingPrompt[];
  shufflePlayerIds?: PlayerOrderShuffler;
  selectPrompt?: DrawingPromptSelector;
  generateSecretLevel?: SecretLevelGenerator;
  scheduleTimer?: GameTimerScheduler;
  clearTimer?: GameTimerClearer;
  onPublicRoomStateChanged?: (
    roomCode: string,
    room: PublicRoomState,
  ) => void;
}

export interface StartGameInternalResult {
  room: PublicRoomState;
  drawerSocketId: string;
  secret: TurnSecretPayload;
}

export interface SubmitDrawingInternalResult {
  room: PublicRoomState;
}
