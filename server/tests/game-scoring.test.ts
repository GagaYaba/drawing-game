import {
  DRAWING_ASPECT_RATIO,
  DRAWING_BACKGROUND_COLOR,
  DRAWING_DOCUMENT_VERSION,
  type DrawingDocument,
} from "@drawing-game/shared";
import { describe, expect, it } from "vitest";

import {
  applyTurnScores,
  buildLeaderboard,
  calculateDrawerPoints,
  calculateGuessPoints,
  createPublicFinishedState,
  toPublicGameState,
} from "../src/game/game-manager.js";
import type {
  DrawingPrompt,
  InternalGame,
} from "../src/game/game-types.js";
import type { InternalPlayer } from "../src/rooms/room-types.js";
import { TEST_CLIENT_INSTANCE_ID } from "./test-client-instance.js";

const PROMPT: DrawingPrompt = {
  id: "score-prompt",
  statement:
    "Représente un phare du plus lumineux (10) au moins lumineux (1).",
  lowLabel: "Moins lumineux",
  highLabel: "Plus lumineux",
  category: "lumière",
};

function createDrawing(): DrawingDocument {
  return {
    version: DRAWING_DOCUMENT_VERSION,
    aspectRatio: DRAWING_ASPECT_RATIO,
    backgroundColor: DRAWING_BACKGROUND_COLOR,
    strokes: [
      {
        tool: "pen",
        color: "#111111",
        width: 8,
        points: [{ x: 0.5, y: 0.5 }],
      },
    ],
  };
}

function createPlayers(
  scores: readonly number[] = [10, 2, 3, 4],
): InternalPlayer[] {
  return scores.map((score, index) => ({
    id: `player-${index + 1}`,
    socketId: `socket-${index + 1}`,
    activeClientInstanceId: TEST_CLIENT_INSTANCE_ID,
    nickname: `J${index + 1}`,
    isHost: index === 0,
    isReady: true,
    isConnected: true,
    joinedAt: 1_000 + index,
    score,
    sessionTokenHash: `session-token-hash-${index + 1}`,
    disconnectedAt: null,
    reconnectDeadline: null,
  }));
}

function createGame(players: readonly InternalPlayer[]): InternalGame {
  const [drawer, firstVoter, secondVoter, thirdVoter] = players;
  if (
    drawer === undefined ||
    firstVoter === undefined ||
    secondVoter === undefined ||
    thirdVoter === undefined
  ) {
    throw new Error("Quatre joueurs de test sont requis.");
  }

  return {
    gameId: "game-1",
    phase: "VOTING",
    totalRounds: 2,
    currentRound: 1,
    turnOrder: players.map((player) => player.id),
    currentDrawerIndex: 0,
    currentTurn: {
      turnId: "turn-1",
      drawerPlayerId: drawer.id,
      prompt: PROMPT,
      secretLevel: 7,
      drawing: createDrawing(),
      drawingSubmittedAt: 2_000,
      guesses: {
        [firstVoter.id]: {
          playerId: firstVoter.id,
          value: 7,
          submittedAt: 3_001,
        },
        [secondVoter.id]: {
          playerId: secondVoter.id,
          value: 6,
          submittedAt: 3_002,
        },
        [thirdVoter.id]: {
          playerId: thirdVoter.id,
          value: 2,
          submittedAt: 3_003,
        },
      },
      scoresAppliedAt: null,
      scoreResult: null,
    },
    usedPromptIds: [PROMPT.id],
    usedTurnIds: ["turn-1"],
    finishedState: null,
    startedAt: 1_500,
    phaseEndsAt: null,
  };
}

describe("turn scoring rules", () => {
  it.each([
    [0, 5],
    [1, 4],
    [2, 3],
    [3, 2],
    [4, 1],
    [5, 0],
    [6, 0],
    [20, 0],
  ])("attribue %i point(s) à la distance %i", (distance, points) => {
    expect(calculateGuessPoints(distance)).toBe(points);
  });

  it.each([
    [[], 0],
    [[2, 3, 4], 0],
    [[0, 3, 4], 1],
    [[0, 1, 2, 1], 3],
    [[0, 1, 0, 1, 0], 5],
    [[0, 1, 0, 1, 0, 1, 0], 5],
  ])(
    "attribue au dessinateur les votes proches avec plafond à cinq",
    (distances, points) => {
      expect(calculateDrawerPoints(distances)).toBe(points);
    },
  );

  it("applique atomiquement les points cumulés une seule fois", () => {
    const players = createPlayers();
    const game = createGame(players);

    const firstResult = applyTurnScores(game, players, 4_000);

    expect(firstResult).toEqual({
      guesses: {
        "player-2": {
          playerId: "player-2",
          distance: 0,
          pointsEarned: 5,
          totalScore: 7,
        },
        "player-3": {
          playerId: "player-3",
          distance: 1,
          pointsEarned: 4,
          totalScore: 7,
        },
        "player-4": {
          playerId: "player-4",
          distance: 5,
          pointsEarned: 0,
          totalScore: 4,
        },
      },
      drawer: {
        playerId: "player-1",
        closeGuessCount: 2,
        pointsEarned: 2,
        totalScore: 12,
      },
    });
    expect(players.map((player) => player.score)).toEqual([12, 7, 7, 4]);
    expect(game.currentTurn.scoresAppliedAt).toBe(4_000);

    const secondResult = applyTurnScores(game, players, 9_000);

    expect(secondResult).toEqual(firstResult);
    expect(players.map((player) => player.score)).toEqual([12, 7, 7, 4]);
    expect(game.currentTurn.scoresAppliedAt).toBe(4_000);
  });

  it("publie distances, points, score total, résultat dessinateur et classement seulement en REVEAL", () => {
    const players = createPlayers();
    const game = createGame(players);

    const votingState = toPublicGameState(game, players);
    expect(votingState.reveal).toBeNull();
    expect(JSON.stringify(votingState)).not.toContain("pointsEarned");

    applyTurnScores(game, players, 4_000);
    game.phase = "REVEAL";
    const reveal = toPublicGameState(game, players).reveal;

    expect(reveal).toMatchObject({
      secretLevel: 7,
      guesses: [
        {
          player: { id: "player-2", nickname: "J2" },
          value: 7,
          distance: 0,
          pointsEarned: 5,
          totalScore: 7,
        },
        {
          player: { id: "player-3", nickname: "J3" },
          value: 6,
          distance: 1,
          pointsEarned: 4,
          totalScore: 7,
        },
        {
          player: { id: "player-4", nickname: "J4" },
          value: 2,
          distance: 5,
          pointsEarned: 0,
          totalScore: 4,
        },
      ],
      drawerResult: {
        player: { id: "player-1", nickname: "J1" },
        closeGuessCount: 2,
        pointsEarned: 2,
        totalScore: 12,
      },
      leaderboard: [
        {
          rank: 1,
          player: { id: "player-1", nickname: "J1" },
          score: 12,
        },
        {
          rank: 2,
          player: { id: "player-2", nickname: "J2" },
          score: 7,
        },
        {
          rank: 2,
          player: { id: "player-3", nickname: "J3" },
          score: 7,
        },
        {
          rank: 4,
          player: { id: "player-4", nickname: "J4" },
          score: 4,
        },
      ],
      nextDrawer: { id: "player-2", nickname: "J2" },
    });
  });
});

describe("server leaderboard", () => {
  it("trie par score, stabilise les égalités par turnOrder et produit des rangs partagés sans mutation", () => {
    const players = createPlayers([12, 9, 9, 5]);
    const scrambledPlayers = [
      players[3]!,
      players[2]!,
      players[0]!,
      players[1]!,
    ];
    const snapshot = structuredClone(scrambledPlayers);

    const leaderboard = buildLeaderboard(
      scrambledPlayers,
      players.map((player) => player.id),
    );

    expect(leaderboard.map(({ rank, player, score }) => ({
      rank,
      id: player.id,
      score,
    }))).toEqual([
      { rank: 1, id: "player-1", score: 12 },
      { rank: 2, id: "player-2", score: 9 },
      { rank: 2, id: "player-3", score: 9 },
      { rank: 4, id: "player-4", score: 5 },
    ]);
    expect(scrambledPlayers).toEqual(snapshot);
  });

  it.each([
    [[12, 9, 5, 1], ["player-1"]],
    [[12, 12, 5, 1], ["player-1", "player-2"]],
    [[8, 8, 8, 1], ["player-1", "player-2", "player-3"]],
  ])(
    "identifie tous les gagnants du classement final",
    (scores, expectedWinnerIds) => {
      const players = createPlayers(scores);
      const game = createGame(players);
      game.phase = "FINISHED";
      game.currentRound = 2;
      game.currentDrawerIndex = players.length - 1;

      const finished = createPublicFinishedState(game, players);

      expect(finished.winners.map((winner) => winner.id)).toEqual(
        expectedWinnerIds,
      );
      expect(finished.completedRounds).toBe(2);
      expect(finished.completedTurns).toBe(8);
    },
  );
});
