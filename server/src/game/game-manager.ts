import { randomUUID } from "node:crypto";

import type {
  GuessValue,
  PublicFinishedState,
  PublicGameState,
  PublicLeaderboardEntry,
  PublicRevealState,
  PublicRoomState,
} from "@drawing-game/shared";

import type { RoomManager } from "../rooms/room-manager.js";
import { RoomManagerError } from "../rooms/room-types.js";
import type { InternalPlayer } from "../rooms/room-types.js";
import {
  cloneDrawingDocument,
  validateSubmitDrawingPayload,
} from "./drawing-validation.js";
import { validateSubmitGuessPayload } from "./guess-validation.js";
import {
  generateSecretLevel,
  selectDrawingPrompt,
  shufflePlayerIds,
} from "./game-random.js";
import type {
  DrawingPrompt,
  ContinueGameInternalResult,
  GameIdGenerator,
  GameManagerOptions,
  InternalGame,
  InternalTurn,
  InternalTurnScoreResult,
  RequestRematchInternalResult,
  StartGameInternalResult,
  SubmitDrawingInternalResult,
  SubmitGuessInternalResult,
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

function validateSecretLevel(
  secretLevel: number,
): asserts secretLevel is GuessValue {
  if (!Number.isInteger(secretLevel) || secretLevel < 1 || secretLevel > 10) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Impossible de générer un niveau secret valide.",
    );
  }
}

function validateTurnId(turnId: string): void {
  if (turnId.length === 0 || turnId.trim() !== turnId) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Impossible de générer un identifiant de tour valide.",
    );
  }
}

export function createGameId(
  generateGameId: GameIdGenerator = randomUUID,
): string {
  let gameId: unknown;

  try {
    gameId = generateGameId();
  } catch {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Impossible de générer un identifiant de partie.",
    );
  }

  if (
    typeof gameId !== "string" ||
    gameId.length === 0 ||
    gameId.trim() !== gameId
  ) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Impossible de générer un identifiant de partie valide.",
    );
  }

  return gameId;
}

function validatePlayerScore(player: InternalPlayer): void {
  if (!Number.isSafeInteger(player.score) || player.score < 0) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Un score de joueur interne est invalide.",
    );
  }
}

function cloneTurnScoreResult(
  result: InternalTurnScoreResult,
): InternalTurnScoreResult {
  return {
    guesses: Object.fromEntries(
      Object.entries(result.guesses).map(([playerId, guess]) => [
        playerId,
        { ...guess },
      ]),
    ),
    drawer: { ...result.drawer },
  };
}

function clonePublicFinishedState(
  finishedState: PublicFinishedState,
): PublicFinishedState {
  return {
    leaderboard: finishedState.leaderboard.map((entry) => ({
      rank: entry.rank,
      player: { ...entry.player },
      score: entry.score,
    })),
    winners: finishedState.winners.map((winner) => ({ ...winner })),
    completedRounds: finishedState.completedRounds,
    completedTurns: finishedState.completedTurns,
  };
}

export function calculateGuessPoints(distance: number): number {
  if (
    !Number.isFinite(distance) ||
    !Number.isInteger(distance) ||
    distance < 0
  ) {
    return 0;
  }

  return Math.max(0, 5 - distance);
}

export function calculateDrawerPoints(
  distances: readonly number[],
): number {
  const closeGuessCount = distances.reduce(
    (count, distance) =>
      Number.isFinite(distance) &&
      Number.isInteger(distance) &&
      distance >= 0 &&
      distance <= 1
        ? count + 1
        : count,
    0,
  );

  return Math.min(5, closeGuessCount);
}

export interface NextTurnPosition {
  currentRound: number;
  currentDrawerIndex: number;
  currentTurnNumber: number;
}

type TurnPositionSource = Pick<
  InternalGame,
  "currentRound" | "currentDrawerIndex" | "totalRounds" | "turnOrder"
>;

export function getNextTurnPosition(
  game: TurnPositionSource,
): NextTurnPosition | null {
  const playerCount = game.turnOrder.length;

  if (
    playerCount < 1 ||
    !Number.isSafeInteger(game.totalRounds) ||
    game.totalRounds < 1 ||
    !Number.isSafeInteger(game.currentRound) ||
    game.currentRound < 1 ||
    game.currentRound > game.totalRounds ||
    !Number.isSafeInteger(game.currentDrawerIndex) ||
    game.currentDrawerIndex < 0 ||
    game.currentDrawerIndex >= playerCount
  ) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "La position du tour actuel est invalide.",
    );
  }

  const nextDrawerIndex = game.currentDrawerIndex + 1;
  if (nextDrawerIndex < playerCount) {
    return {
      currentRound: game.currentRound,
      currentDrawerIndex: nextDrawerIndex,
      currentTurnNumber:
        (game.currentRound - 1) * playerCount + nextDrawerIndex + 1,
    };
  }

  if (game.currentRound >= game.totalRounds) {
    return null;
  }

  return {
    currentRound: game.currentRound + 1,
    currentDrawerIndex: 0,
    currentTurnNumber: game.currentRound * playerCount + 1,
  };
}

export function hasNextTurn(game: TurnPositionSource): boolean {
  return getNextTurnPosition(game) !== null;
}

export function initializeTurn(
  turnId: string,
  drawerPlayerId: string,
  prompt: DrawingPrompt,
  secretLevel: GuessValue,
): InternalTurn {
  return {
    turnId,
    drawerPlayerId,
    prompt,
    secretLevel,
    drawing: null,
    drawingSubmittedAt: null,
    guesses: {},
    scoresAppliedAt: null,
    scoreResult: null,
  };
}

export function buildLeaderboard(
  players: readonly InternalPlayer[],
  turnOrder: readonly string[],
): PublicLeaderboardEntry[] {
  const orderByPlayerId = new Map(
    turnOrder.map((playerId, index) => [playerId, index]),
  );

  const sortedPlayers = [...players].sort((left, right) => {
    validatePlayerScore(left);
    validatePlayerScore(right);

    if (left.score !== right.score) {
      return right.score - left.score;
    }

    const leftOrder =
      orderByPlayerId.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder =
      orderByPlayerId.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    return leftOrder - rightOrder;
  });

  let previousScore: number | null = null;
  let previousRank = 0;

  return sortedPlayers.map((player, index) => {
    const rank =
      previousScore !== null && player.score === previousScore
        ? previousRank
        : index + 1;

    previousScore = player.score;
    previousRank = rank;

    return {
      rank,
      player: {
        id: player.id,
        nickname: player.nickname,
      },
      score: player.score,
    };
  });
}

export function getEligibleVoterIds(
  game: InternalGame,
  players: readonly InternalPlayer[],
): string[] {
  const gamePlayerIds = new Set(game.turnOrder);

  return players
    .filter(
      (player) =>
        player.id !== game.currentTurn.drawerPlayerId &&
        gamePlayerIds.has(player.id),
    )
    .map((player) => player.id);
}

export function getSubmittedGuessCount(
  game: InternalGame,
  eligibleVoterIds: readonly string[],
): number {
  return eligibleVoterIds.reduce(
    (count, playerId) =>
      Object.prototype.hasOwnProperty.call(
        game.currentTurn.guesses,
        playerId,
      )
        ? count + 1
        : count,
    0,
  );
}

export function areAllGuessesSubmitted(
  game: InternalGame,
  eligibleVoterIds: readonly string[],
): boolean {
  return (
    eligibleVoterIds.length > 0 &&
    getSubmittedGuessCount(game, eligibleVoterIds) === eligibleVoterIds.length
  );
}

export function applyTurnScores(
  game: InternalGame,
  players: readonly InternalPlayer[],
  appliedAt: number,
): InternalTurnScoreResult {
  const turn = game.currentTurn;
  const hasAppliedTimestamp = turn.scoresAppliedAt !== null;
  const hasScoreResult = turn.scoreResult !== null;

  if (hasAppliedTimestamp || hasScoreResult) {
    if (!hasAppliedTimestamp || !hasScoreResult) {
      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Le calcul des scores du tour est incohérent.",
      );
    }

    return cloneTurnScoreResult(turn.scoreResult as InternalTurnScoreResult);
  }

  if (!Number.isFinite(appliedAt)) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Impossible de dater le calcul des scores.",
    );
  }

  const eligibleVoterIds = getEligibleVoterIds(game, players);
  if (!areAllGuessesSubmitted(game, eligibleVoterIds)) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Toutes les estimations doivent être présentes avant le calcul des scores.",
    );
  }

  const playersById = new Map(players.map((player) => [player.id, player]));
  const drawer = playersById.get(turn.drawerPlayerId);
  if (drawer === undefined) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Le dessinateur du tour est introuvable.",
    );
  }

  validatePlayerScore(drawer);

  const distances: number[] = [];
  const guessResults: InternalTurnScoreResult["guesses"] = {};
  const scoreUpdates = new Map<string, number>();

  for (const playerId of eligibleVoterIds) {
    const player = playersById.get(playerId);
    const guess = turn.guesses[playerId];

    if (
      player === undefined ||
      guess === undefined ||
      guess.playerId !== playerId
    ) {
      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Une estimation attendue est introuvable.",
      );
    }

    validatePlayerScore(player);
    const distance = Math.abs(guess.value - turn.secretLevel);
    const pointsEarned = calculateGuessPoints(distance);
    const totalScore = player.score + pointsEarned;

    distances.push(distance);
    scoreUpdates.set(playerId, totalScore);
    guessResults[playerId] = {
      playerId,
      distance,
      pointsEarned,
      totalScore,
    };
  }

  const closeGuessCount = distances.filter(
    (distance) => distance <= 1,
  ).length;
  const drawerPoints = calculateDrawerPoints(distances);
  const drawerTotalScore = drawer.score + drawerPoints;
  const result: InternalTurnScoreResult = {
    guesses: guessResults,
    drawer: {
      playerId: drawer.id,
      closeGuessCount,
      pointsEarned: drawerPoints,
      totalScore: drawerTotalScore,
    },
  };

  scoreUpdates.set(drawer.id, drawerTotalScore);
  for (const [playerId, totalScore] of scoreUpdates) {
    const player = playersById.get(playerId);
    if (player === undefined) {
      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Un joueur à créditer est introuvable.",
      );
    }
    player.score = totalScore;
  }

  turn.scoreResult = result;
  turn.scoresAppliedAt = appliedAt;

  return cloneTurnScoreResult(result);
}

export function createPublicRevealState(
  game: InternalGame,
  players: readonly InternalPlayer[],
): PublicRevealState {
  const scoreResult = game.currentTurn.scoreResult;
  if (
    game.currentTurn.scoresAppliedAt === null ||
    scoreResult === null
  ) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Les scores du tour doivent être calculés avant la révélation.",
    );
  }

  const eligibleVoterIds = getEligibleVoterIds(game, players);
  const eligibleVoterIdSet = new Set(eligibleVoterIds);

  const guesses = players
    .filter((player) => eligibleVoterIdSet.has(player.id))
    .map((player) => {
      const guess = game.currentTurn.guesses[player.id];
      const result = scoreResult.guesses[player.id];

      if (
        guess === undefined ||
        guess.playerId !== player.id ||
        !Number.isFinite(guess.submittedAt) ||
        result === undefined ||
        result.playerId !== player.id
      ) {
        throw new RoomManagerError(
          "INTERNAL_ERROR",
          "Une estimation attendue est introuvable.",
        );
      }

      return {
        player: {
          id: player.id,
          nickname: player.nickname,
        },
        value: guess.value,
        distance: result.distance,
        pointsEarned: result.pointsEarned,
        totalScore: result.totalScore,
      };
    });

  if (guesses.length !== eligibleVoterIds.length) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Impossible de publier toutes les estimations.",
    );
  }

  const drawer = players.find(
    (player) => player.id === game.currentTurn.drawerPlayerId,
  );
  if (
    drawer === undefined ||
    scoreResult.drawer.playerId !== drawer.id
  ) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Le résultat du dessinateur est introuvable.",
    );
  }

  const nextPosition = getNextTurnPosition(game);
  const nextDrawerId =
    nextPosition === null
      ? null
      : game.turnOrder[nextPosition.currentDrawerIndex];
  const nextDrawer =
    nextDrawerId === null || nextDrawerId === undefined
      ? null
      : players.find((player) => player.id === nextDrawerId);

  if (nextDrawerId !== null && nextDrawer === undefined) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Le prochain dessinateur est introuvable.",
    );
  }

  return {
    secretLevel: game.currentTurn.secretLevel,
    guesses,
    drawerResult: {
      player: {
        id: drawer.id,
        nickname: drawer.nickname,
      },
      closeGuessCount: scoreResult.drawer.closeGuessCount,
      pointsEarned: scoreResult.drawer.pointsEarned,
      totalScore: scoreResult.drawer.totalScore,
    },
    leaderboard: buildLeaderboard(players, game.turnOrder),
    nextDrawer:
      nextDrawer === null || nextDrawer === undefined
        ? null
        : {
            id: nextDrawer.id,
            nickname: nextDrawer.nickname,
          },
  };
}

export function createPublicFinishedState(
  game: InternalGame,
  players: readonly InternalPlayer[],
): PublicFinishedState {
  const leaderboard = buildLeaderboard(players, game.turnOrder);
  const winningScore = leaderboard[0]?.score;

  if (winningScore === undefined) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Le classement final ne contient aucun joueur.",
    );
  }

  return {
    leaderboard,
    winners: leaderboard
      .filter((entry) => entry.score === winningScore)
      .map((entry) => ({
        id: entry.player.id,
        nickname: entry.player.nickname,
        score: entry.score,
      })),
    completedRounds: game.totalRounds,
    completedTurns: game.turnOrder.length * game.totalRounds,
  };
}

export function toPublicGameState(
  game: InternalGame,
  players: readonly InternalPlayer[],
): PublicGameState {
  const activeDrawer = players.find(
    (player) => player.id === game.currentTurn.drawerPlayerId,
  );
  const historicalDrawer =
    game.phase === "FINISHED"
      ? game.finishedState?.leaderboard.find(
          (entry) =>
            entry.player.id === game.currentTurn.drawerPlayerId,
        )?.player
      : undefined;
  const drawer = activeDrawer ?? historicalDrawer;

  if (drawer === undefined) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Le dessinateur du tour est introuvable.",
    );
  }

  const { drawing, drawingSubmittedAt } = game.currentTurn;
  const submittedDrawingIsPublic =
    game.phase === "VOTING" || game.phase === "REVEAL";
  if (
    submittedDrawingIsPublic &&
    (drawing === null ||
      drawingSubmittedAt === null ||
      !Number.isFinite(drawingSubmittedAt))
  ) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "Le dessin soumis est introuvable.",
    );
  }

  const eligibleVoterIds = getEligibleVoterIds(game, players);
  if (
    (game.phase === "FINISHED" && game.finishedState === null) ||
    (game.phase !== "FINISHED" && game.finishedState !== null)
  ) {
    throw new RoomManagerError(
      "INTERNAL_ERROR",
      "L’état final interne de la partie est incohérent.",
    );
  }

  return {
    gameId: game.gameId,
    phase: game.phase,
    turnId: game.currentTurn.turnId,
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
      statement: game.currentTurn.prompt.statement,
      lowLabel: game.currentTurn.prompt.lowLabel,
      highLabel: game.currentTurn.prompt.highLabel,
    },
    phaseEndsAt: game.phaseEndsAt,
    submittedDrawing:
      submittedDrawingIsPublic &&
      drawing !== null &&
      drawingSubmittedAt !== null
        ? {
            document: cloneDrawingDocument(drawing),
            submittedAt: drawingSubmittedAt,
          }
        : null,
    voting:
      game.phase === "VOTING"
        ? {
            eligibleVoterCount: eligibleVoterIds.length,
            submittedGuessCount: getSubmittedGuessCount(
              game,
              eligibleVoterIds,
            ),
          }
        : null,
    reveal:
      game.phase === "REVEAL"
        ? createPublicRevealState(game, players)
        : null,
    finished:
      game.phase === "FINISHED"
        ? clonePublicFinishedState(
            game.finishedState as PublicFinishedState,
          )
        : null,
  };
}

export class GameManager {
  private readonly clock;
  private readonly gameIdGenerator;
  private readonly createTurnId;
  private readonly introDurationMs;
  private readonly prompts: readonly DrawingPrompt[];
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
    this.gameIdGenerator = options.generateGameId ?? randomUUID;
    this.createTurnId = options.generateTurnId ?? randomUUID;
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

    if (
      new Set(this.prompts.map((prompt) => prompt.id)).size !==
      this.prompts.length
    ) {
      throw new RangeError(
        "Les identifiants de consigne doivent être uniques.",
      );
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

    try {
      turnOrder = this.shuffle([...playerIds]);
      validateTurnOrder(playerIds, turnOrder);
    } catch (error) {
      if (error instanceof RoomManagerError) {
        throw error;
      }

      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Impossible de préparer la partie.",
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

    const currentTurn = this.prepareTurn(drawer.id, [], []);
    const gameId = createGameId(this.gameIdGenerator);
    const startedAt = this.clock();
    if (!Number.isFinite(startedAt)) {
      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Impossible de dater le lancement de la partie.",
      );
    }

    const previousScores = room.players.map((player) => player.score);
    for (const player of room.players) {
      player.score = 0;
    }

    const game: InternalGame = {
      gameId,
      phase: "ROUND_INTRO",
      totalRounds: TOTAL_ROUNDS,
      currentRound: 1,
      turnOrder,
      currentDrawerIndex: 0,
      currentTurn,
      usedPromptIds: [currentTurn.prompt.id],
      usedTurnIds: [currentTurn.turnId],
      finishedState: null,
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
          gameId,
          turnId: currentTurn.turnId,
          drawerPlayerId: drawer.id,
          secretLevel: currentTurn.secretLevel,
        },
      };
    } catch (error) {
      room.game = null;
      this.clearScheduledTransition(room.code);
      room.players.forEach((player, index) => {
        player.score = previousScores[index] ?? 0;
      });

      if (error instanceof RoomManagerError) {
        throw error;
      }

      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Impossible de programmer le début du dessin.",
      );
    }
  }

  submitDrawing(
    socketId: string,
    payload: unknown,
  ): SubmitDrawingInternalResult {
    const room = this.roomManager.getPlayerRoomBySocketId(socketId);
    if (room === undefined) {
      throw new RoomManagerError(
        "NOT_IN_ROOM",
        "Cette connexion n'appartient à aucun salon.",
      );
    }

    const game = room.game;
    if (game === null) {
      throw new RoomManagerError(
        "GAME_NOT_STARTED",
        "Aucune partie n’est en cours.",
      );
    }

    if (game.phase !== "DRAWING") {
      throw new RoomManagerError(
        "NOT_DRAWING_PHASE",
        "Le dessin ne peut pas être envoyé pendant cette phase.",
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

    if (requester.id !== game.currentTurn.drawerPlayerId) {
      throw new RoomManagerError(
        "NOT_CURRENT_DRAWER",
        "Seul le dessinateur actuel peut envoyer un dessin.",
      );
    }

    if (
      game.currentTurn.drawing !== null ||
      game.currentTurn.drawingSubmittedAt !== null
    ) {
      throw new RoomManagerError(
        "DRAWING_ALREADY_SUBMITTED",
        "Un dessin a déjà été envoyé pour ce tour.",
      );
    }

    const validation = validateSubmitDrawingPayload(payload);
    if (!validation.success) {
      throw new RoomManagerError(
        validation.error.code,
        validation.error.message,
      );
    }

    const submittedAt = this.clock();
    if (!Number.isFinite(submittedAt)) {
      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Impossible de dater la soumission du dessin.",
      );
    }

    const previousPhase = game.phase;
    const previousPhaseEndsAt = game.phaseEndsAt;
    game.currentTurn.drawing = validation.document;
    game.currentTurn.drawingSubmittedAt = submittedAt;
    game.phase = "VOTING";
    game.phaseEndsAt = null;

    try {
      return {
        room: this.roomManager.getPublicRoomState(room.code),
      };
    } catch (error) {
      game.currentTurn.drawing = null;
      game.currentTurn.drawingSubmittedAt = null;
      game.phase = previousPhase;
      game.phaseEndsAt = previousPhaseEndsAt;

      if (error instanceof RoomManagerError) {
        throw error;
      }

      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Impossible de publier le dessin soumis.",
      );
    }
  }

  submitGuess(
    socketId: string,
    payload: unknown,
  ): SubmitGuessInternalResult {
    const room = this.roomManager.getPlayerRoomBySocketId(socketId);
    if (room === undefined) {
      throw new RoomManagerError(
        "NOT_IN_ROOM",
        "Cette connexion n'appartient à aucun salon.",
      );
    }

    const game = room.game;
    if (game === null) {
      throw new RoomManagerError(
        "GAME_NOT_STARTED",
        "Aucune partie n’est en cours.",
      );
    }

    if (game.phase !== "VOTING") {
      throw new RoomManagerError(
        "NOT_VOTING_PHASE",
        "Les estimations ne sont pas ouvertes pendant cette phase.",
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

    if (requester.id === game.currentTurn.drawerPlayerId) {
      throw new RoomManagerError(
        "DRAWER_CANNOT_GUESS",
        "Le dessinateur ne peut pas voter pour son propre dessin.",
      );
    }

    const eligibleVoterIds = getEligibleVoterIds(game, room.players);
    if (!eligibleVoterIds.includes(requester.id)) {
      throw new RoomManagerError(
        "PLAYER_NOT_ELIGIBLE",
        "Vous ne pouvez pas participer à ce vote.",
      );
    }

    const validation = validateSubmitGuessPayload(payload);
    if (
      validation.success &&
      validation.data.turnId !== game.currentTurn.turnId
    ) {
      throw new RoomManagerError(
        "STALE_TURN",
        "Cette estimation correspond à un tour qui n’est plus actif.",
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        game.currentTurn.guesses,
        requester.id,
      )
    ) {
      throw new RoomManagerError(
        "GUESS_ALREADY_SUBMITTED",
        "Votre estimation a déjà été validée.",
      );
    }

    if (!validation.success) {
      throw new RoomManagerError(
        validation.error.code,
        validation.error.message,
      );
    }

    const submittedAt = this.clock();
    if (!Number.isFinite(submittedAt)) {
      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Impossible de dater la soumission de l’estimation.",
      );
    }

    const guess = {
      playerId: requester.id,
      value: validation.data.value,
      submittedAt,
    };
    const previousPhase = game.phase;
    const previousPhaseEndsAt = game.phaseEndsAt;
    const previousScores = room.players.map((player) => player.score);
    const previousScoresAppliedAt = game.currentTurn.scoresAppliedAt;
    const previousScoreResult =
      game.currentTurn.scoreResult === null
        ? null
        : cloneTurnScoreResult(game.currentTurn.scoreResult);

    game.currentTurn.guesses[requester.id] = guess;

    try {
      if (areAllGuessesSubmitted(game, eligibleVoterIds)) {
        game.phase = "REVEAL";
        game.phaseEndsAt = null;
        applyTurnScores(game, room.players, submittedAt);
      }

      return {
        room: this.roomManager.getPublicRoomState(room.code),
        guess: {
          value: guess.value,
          submittedAt: guess.submittedAt,
        },
      };
    } catch (error) {
      delete game.currentTurn.guesses[requester.id];
      game.phase = previousPhase;
      game.phaseEndsAt = previousPhaseEndsAt;
      game.currentTurn.scoresAppliedAt = previousScoresAppliedAt;
      game.currentTurn.scoreResult = previousScoreResult;
      room.players.forEach((player, index) => {
        player.score = previousScores[index] ?? 0;
      });

      if (error instanceof RoomManagerError) {
        throw error;
      }

      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Impossible de publier l’estimation.",
      );
    }
  }

  continueGame(socketId: string): ContinueGameInternalResult {
    const room = this.roomManager.getPlayerRoomBySocketId(socketId);
    if (room === undefined) {
      throw new RoomManagerError(
        "NOT_IN_ROOM",
        "Cette connexion n'appartient à aucun salon.",
      );
    }

    const game = room.game;
    if (game === null) {
      throw new RoomManagerError(
        "GAME_NOT_STARTED",
        "Aucune partie n’est en cours.",
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
        "Seul l’hôte peut lancer le tour suivant.",
      );
    }

    if (game.phase === "FINISHED") {
      throw new RoomManagerError(
        "GAME_ALREADY_FINISHED",
        "La partie est terminée.",
      );
    }

    if (game.phase !== "REVEAL") {
      throw new RoomManagerError(
        "NOT_REVEAL_PHASE",
        "Le tour suivant ne peut pas encore commencer.",
      );
    }

    const eligibleVoterIds = getEligibleVoterIds(game, room.players);
    if (
      !areAllGuessesSubmitted(game, eligibleVoterIds) ||
      game.currentTurn.scoresAppliedAt === null ||
      game.currentTurn.scoreResult === null
    ) {
      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Le tour actuel n’est pas prêt à être poursuivi.",
      );
    }

    const nextPosition = getNextTurnPosition(game);
    if (nextPosition === null) {
      const finishedState = createPublicFinishedState(game, room.players);
      const previousPhase = game.phase;
      const previousPhaseEndsAt = game.phaseEndsAt;
      const previousFinishedState = game.finishedState;
      game.phase = "FINISHED";
      game.phaseEndsAt = null;
      game.finishedState = finishedState;

      try {
        return {
          room: this.roomManager.getPublicRoomState(room.code),
        };
      } catch (error) {
        game.phase = previousPhase;
        game.phaseEndsAt = previousPhaseEndsAt;
        game.finishedState = previousFinishedState;

        if (error instanceof RoomManagerError) {
          throw error;
        }

        throw new RoomManagerError(
          "INTERNAL_ERROR",
          "Impossible de terminer la partie.",
        );
      }
    }

    const nextDrawerPlayerId =
      game.turnOrder[nextPosition.currentDrawerIndex];
    const nextDrawer = room.players.find(
      (player) => player.id === nextDrawerPlayerId,
    );
    if (nextDrawer === undefined) {
      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Le prochain dessinateur est introuvable.",
      );
    }

    const nextTurn = this.prepareTurn(
      nextDrawer.id,
      game.usedPromptIds,
      game.usedTurnIds,
    );
    const introStartedAt = this.clock();
    if (!Number.isFinite(introStartedAt)) {
      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Impossible de dater le tour suivant.",
      );
    }

    const previousPhase = game.phase;
    const previousPhaseEndsAt = game.phaseEndsAt;
    const previousRound = game.currentRound;
    const previousDrawerIndex = game.currentDrawerIndex;
    const previousTurn = game.currentTurn;
    const previousUsedPromptIds = [...game.usedPromptIds];
    const previousUsedTurnIds = [...game.usedTurnIds];

    game.phase = "ROUND_INTRO";
    game.phaseEndsAt = introStartedAt + this.introDurationMs;
    game.currentRound = nextPosition.currentRound;
    game.currentDrawerIndex = nextPosition.currentDrawerIndex;
    game.currentTurn = nextTurn;
    game.usedPromptIds = [
      ...previousUsedPromptIds,
      nextTurn.prompt.id,
    ];
    game.usedTurnIds = [...previousUsedTurnIds, nextTurn.turnId];

    try {
      this.scheduleDrawingTransition(room.code, game);
      const publicRoom = this.roomManager.getPublicRoomState(room.code);

      return {
        room: publicRoom,
        nextTurn: {
          drawerSocketId: nextDrawer.socketId,
          secret: {
            roomCode: room.code,
            gameId: game.gameId,
            turnId: nextTurn.turnId,
            drawerPlayerId: nextDrawer.id,
            secretLevel: nextTurn.secretLevel,
          },
        },
      };
    } catch (error) {
      this.clearScheduledTransition(room.code);
      game.phase = previousPhase;
      game.phaseEndsAt = previousPhaseEndsAt;
      game.currentRound = previousRound;
      game.currentDrawerIndex = previousDrawerIndex;
      game.currentTurn = previousTurn;
      game.usedPromptIds = previousUsedPromptIds;
      game.usedTurnIds = previousUsedTurnIds;

      if (error instanceof RoomManagerError) {
        throw error;
      }

      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Impossible de préparer le tour suivant.",
      );
    }
  }

  requestRematch(socketId: string): RequestRematchInternalResult {
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

    if (room.game === null) {
      throw new RoomManagerError(
        "GAME_NOT_STARTED",
        "Aucune partie n’est disponible pour une revanche.",
      );
    }

    if (!requester.isHost) {
      throw new RoomManagerError(
        "NOT_HOST",
        "Seul l’hôte peut proposer une revanche.",
      );
    }

    if (room.game.phase !== "FINISHED") {
      throw new RoomManagerError(
        "GAME_NOT_FINISHED",
        "La revanche ne peut être proposée qu’après la fin de la partie.",
      );
    }

    return {
      room: this.resetRoomForRematch(room.code),
    };
  }

  resetRoomForRematch(roomCode: string): PublicRoomState {
    const room = this.roomManager.getRoomByCode(roomCode);
    if (room === undefined) {
      throw new RoomManagerError(
        "ROOM_NOT_FOUND",
        "Aucun salon ne correspond à ce code.",
      );
    }

    if (room.game === null) {
      throw new RoomManagerError(
        "GAME_NOT_STARTED",
        "Aucune partie n’est disponible pour une revanche.",
      );
    }

    if (room.game.phase !== "FINISHED") {
      throw new RoomManagerError(
        "GAME_NOT_FINISHED",
        "La revanche ne peut être proposée qu’après la fin de la partie.",
      );
    }

    this.clearScheduledTransition(room.code);
    const previousGame = room.game;
    const previousPlayerStates = room.players.map((player) => ({
      isReady: player.isReady,
      score: player.score,
    }));

    room.game = null;
    for (const player of room.players) {
      player.isReady = false;
      player.score = 0;
    }

    try {
      return this.roomManager.getPublicRoomState(room.code);
    } catch (error) {
      room.game = previousGame;
      room.players.forEach((player, index) => {
        const previousState = previousPlayerStates[index];
        if (previousState !== undefined) {
          player.isReady = previousState.isReady;
          player.score = previousState.score;
        }
      });

      if (error instanceof RoomManagerError) {
        throw error;
      }

      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Impossible de préparer le salon pour une revanche.",
      );
    }
  }

  cancelGame(roomCode: string): boolean {
    const room = this.roomManager.getRoomByCode(roomCode);
    this.clearScheduledTransition(roomCode);

    if (room === undefined || room.game === null) {
      return false;
    }

    if (room.game.phase === "FINISHED") {
      return false;
    }

    room.game = null;
    for (const player of room.players) {
      player.isReady = false;
      player.score = 0;
    }

    return true;
  }

  dispose(): void {
    for (const timer of this.phaseTimers.values()) {
      this.clearTimer(timer);
    }
    this.phaseTimers.clear();
  }

  private prepareTurn(
    drawerPlayerId: string,
    usedPromptIds: readonly string[],
    usedTurnIds: readonly string[],
  ): InternalTurn {
    const usedPromptIdSet = new Set(usedPromptIds);
    const availablePrompts = this.prompts.filter(
      (prompt) => !usedPromptIdSet.has(prompt.id),
    );

    if (availablePrompts.length === 0) {
      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Aucune consigne inédite n’est disponible.",
      );
    }

    let selectedPromptCandidate: DrawingPrompt;
    let secretLevel: number;
    let turnId: string;

    try {
      selectedPromptCandidate = this.choosePrompt(availablePrompts);
      secretLevel = this.createSecretLevel();
      turnId = this.createTurnId();
    } catch {
      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Impossible de préparer les données du tour.",
      );
    }

    const selectedPrompt = availablePrompts.find(
      (prompt) => prompt.id === selectedPromptCandidate.id,
    );
    if (selectedPrompt === undefined) {
      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Impossible de sélectionner une consigne inédite valide.",
      );
    }

    validateSecretLevel(secretLevel);
    validateTurnId(turnId);
    if (new Set(usedTurnIds).has(turnId)) {
      throw new RoomManagerError(
        "INTERNAL_ERROR",
        "Le nouvel identifiant de tour doit être unique.",
      );
    }

    return initializeTurn(
      turnId,
      drawerPlayerId,
      selectedPrompt,
      secretLevel,
    );
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
