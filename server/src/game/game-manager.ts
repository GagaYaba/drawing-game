import type { PublicGameState } from "@drawing-game/shared";

import type { RoomManager } from "../rooms/room-manager.js";
import { RoomManagerError } from "../rooms/room-types.js";
import type { InternalPlayer } from "../rooms/room-types.js";
import {
  generateSecretLevel,
  selectDrawingPrompt,
  shufflePlayerIds,
} from "./game-random.js";
import type {
  DrawingPrompt,
  GameManagerOptions,
  InternalGame,
  StartGameInternalResult,
} from "./game-types.js";
import { DRAWING_PROMPTS } from "./prompt-bank.js";

export const ROUND_INTRO_DURATION_MS = 3_000;
export const TOTAL_ROUNDS = 2;

function defaultScheduleTimer(callback: () => void, delay: number): unknown {
  return setTimeout(callback, delay);
}

function defaultClearTimer(handle: unknown): void {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}

function validateTurnOrder(
  originalPlayerIds: readonly string[],
  turnOrder: readonly string[],
): void {
  if (
    turnOrder.length !== originalPlayerIds.length ||
    new Set(turnOrder).size !== originalPlayerIds.length
  ) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Impossible de déterminer un ordre de dessinateurs valide.",
    );
  }

  const expectedIds = new Set(originalPlayerIds);
  if (turnOrder.some((playerId) => !expectedIds.has(playerId))) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Impossible de déterminer un ordre de dessinateurs valide.",
    );
  }
}

function validateSecretLevel(secretLevel: number): void {
  if (!Number.isInteger(secretLevel) || secretLevel < 1 || secretLevel > 10) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Impossible de générer un niveau secret valide.",
    );
  }
}

export function toPublicGameState(
  game: InternalGame,
  players: readonly InternalPlayer[],
): PublicGameState {
  const drawer = players.find(
    (player) => player.id === game.currentTurn.drawerPlayerId,
  );

  if (drawer === undefined) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Le dessinateur du tour est introuvable.",
    );
  }

  return {
    phase: game.phase,
    totalRounds: game.totalRounds,
    currentRound: game.currentRound,
    currentTurnNumber:
      (game.currentRound - 1) * game.turnOrder.length +
      game.currentDrawerIndex +
      1,
    totalTurns: game.turnOrder.length * game.totalRounds,
    currentDrawer: { id: drawer.id, nickname: drawer.nickname },
    prompt: {
      id: game.currentTurn.prompt.id,
      text: game.currentTurn.prompt.text,
    },
    phaseEndsAt: game.phaseEndsAt,
  };
}

export class GameManager {
  private readonly clock;
  private readonly introDurationMs;
  private readonly prompts;
  private readonly shuffle;
  private readonly choosePrompt;
  private readonly createSecretLevel;
  private readonly scheduleTimer;
  private readonly clearTimer;
  private readonly onPublicRoomStateChanged;
  private readonly phaseTimers = new Map<string, unknown>();

  constructor(
    private readonly roomManager: RoomManager,
    options: GameManagerOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.introDurationMs =
      options.introDurationMs ?? ROUND_INTRO_DURATION_MS;
    this.prompts = options.prompts ?? DRAWING_PROMPTS;
    this.shuffle = options.shufflePlayerIds ?? shufflePlayerIds;
    this.choosePrompt = options.selectPrompt ?? selectDrawingPrompt;
    this.createSecretLevel =
      options.generateSecretLevel ?? generateSecretLevel;
    this.scheduleTimer = options.scheduleTimer ?? defaultScheduleTimer;
    this.clearTimer = options.clearTimer ?? defaultClearTimer;
    this.onPublicRoomStateChanged =
      options.onPublicRoomStateChanged ?? (() => undefined);

    if (
      !Number.isSafeInteger(this.introDurationMs) ||
      this.introDurationMs < 1
    ) {
      throw new RangeError("introDurationMs doit être un entier positif.");
    }

    if (this.prompts.length === 0) {
      throw new RangeError("La banque de consignes ne peut pas être vide.");
    }
  }

  startGame(socketId: string): StartGameInternalResult {
    const room = this.roomManager.getPlayerRoomBySocketId(socketId);

    if (room === undefined) {
      throw new RoomManagerError(
        "NOT_IN_ROOM",
        "Cette connexion n'appartient à aucun salon.",
      );
    }

    const requester = room.players.find(
      (player) => player.socketId === socketId,
    );
    if (requester === undefined) {
      throw new RoomManagerError(
        "PLAYER_NOT_FOUND",
        "Le joueur associé à cette connexion est introuvable.",
      );
    }

    if (!requester.isHost) {
      throw new RoomManagerError(
        "NOT_HOST",
        "Seul l’hôte peut lancer la partie.",
      );
    }

    if (room.game !== null) {
      throw new RoomManagerError(
        "GAME_ALREADY_STARTED",
        "Une partie est déjà en cours.",
      );
    }

    if (room.players.length < 3) {
      throw new RoomManagerError(
        "NOT_ENOUGH_PLAYERS",
        "Il faut au moins 3 joueurs.",
      );
    }

    if (!room.players.every((player) => player.isReady)) {
      throw new RoomManagerError(
        "PLAYERS_NOT_READY",
        "Tous les joueurs doivent être prêts.",
      );
    }

    const playerIds = room.players.map((player) => player.id);
    let turnOrder: string[];
    let selectedPromptCandidate: DrawingPrompt;
    let secretLevel: number;

    try {
      turnOrder = this.shuffle([...playerIds]);
      validateTurnOrder(playerIds, turnOrder);
      selectedPromptCandidate = this.choosePrompt(this.prompts);
      secretLevel = this.createSecretLevel();
      validateSecretLevel(secretLevel);
    } catch (error) {
      if (error instanceof RoomManagerError) {
        throw error;
      }

      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Impossible de préparer la partie.",
      );
    }

    const selectedPrompt = this.prompts.find(
      (prompt) => prompt.id === selectedPromptCandidate.id,
    );
    if (selectedPrompt === undefined) {
      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Impossible de sélectionner une consigne valide.",
      );
    }

    const drawerPlayerId = turnOrder[0];
    const drawer = room.players.find(
      (player) => player.id === drawerPlayerId,
    );
    if (drawer === undefined) {
      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Impossible de sélectionner le premier dessinateur.",
      );
    }

    const startedAt = this.clock();
    if (!Number.isFinite(startedAt)) {
      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Impossible de dater le lancement de la partie.",
      );
    }

    const game: InternalGame = {
      phase: "ROUND_INTRO",
      totalRounds: TOTAL_ROUNDS,
      currentRound: 1,
      turnOrder,
      currentDrawerIndex: 0,
      currentTurn: {
        drawerPlayerId: drawer.id,
        prompt: selectedPrompt,
        secretLevel,
      },
      startedAt,
      phaseEndsAt: startedAt + this.introDurationMs,
    };

    room.game = game;

    try {
      this.scheduleDrawingTransition(room.code, game);
      const publicRoom = this.roomManager.getPublicRoomState(room.code);

      return {
        room: publicRoom,
        drawerSocketId: drawer.socketId,
        secret: {
          roomCode: room.code,
          drawerPlayerId: drawer.id,
          secretLevel,
        },
      };
    } catch (error) {
      room.game = null;
      this.clearScheduledTransition(room.code);

      if (error instanceof RoomManagerError) {
        throw error;
      }

      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Impossible de programmer le début du dessin.",
      );
    }
  }

  cancelGame(roomCode: string): boolean {
    const room = this.roomManager.getRoomByCode(roomCode);
    this.clearScheduledTransition(roomCode);

    if (room === undefined || room.game === null) {
      return false;
    }

    room.game = null;
    for (const player of room.players) {
      player.isReady = false;
    }

    return true;
  }

  dispose(): void {
    for (const timer of this.phaseTimers.values()) {
      this.clearTimer(timer);
    }
    this.phaseTimers.clear();
  }

  private scheduleDrawingTransition(
    roomCode: string,
    game: InternalGame,
  ): void {
    const delay = Math.max(0, (game.phaseEndsAt ?? this.clock()) - this.clock());
    const timer = this.scheduleTimer(() => {
      this.phaseTimers.delete(roomCode);
      const room = this.roomManager.getRoomByCode(roomCode);

      if (
        room === undefined ||
        room.game !== game ||
        game.phase !== "ROUND_INTRO"
      ) {
        return;
      }

      game.phase = "DRAWING";
      game.phaseEndsAt = null;
      this.onPublicRoomStateChanged(
        roomCode,
        this.roomManager.getPublicRoomState(roomCode),
      );
    }, delay);

    this.phaseTimers.set(roomCode, timer);
  }

  private clearScheduledTransition(roomCode: string): void {
    if (!this.phaseTimers.has(roomCode)) {
      return;
    }

    const timer = this.phaseTimers.get(roomCode);
    this.clearTimer(timer);
    this.phaseTimers.delete(roomCode);
  }
}
