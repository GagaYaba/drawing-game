import { describe, expect, it } from "vitest";

import { toPublicGameState, TOTAL_ROUNDS } from "../src/game/game-manager.js";
import type { DrawingPrompt, InternalGame } from "../src/game/game-types.js";
import { DRAWING_PROMPTS } from "../src/game/prompt-bank.js";
import type { InternalPlayer } from "../src/rooms/room-types.js";

const DRAWER: InternalPlayer = {
  id: "drawer-id",
  socketId: "drawer-socket",
  nickname: "Dessinatrice",
  isHost: true,
  isReady: true,
  isConnected: true,
  joinedAt: 1_000,
  score: 0,
  sessionTokenHash: "drawer-session-token-hash",
  disconnectedAt: null,
  reconnectDeadline: null,
};

function createGame(prompt: DrawingPrompt): InternalGame {
  return {
    gameId: "game-1",
    phase: "DRAWING",
    totalRounds: TOTAL_ROUNDS,
    currentRound: 1,
    turnOrder: [DRAWER.id],
    currentDrawerIndex: 0,
    currentTurn: {
      turnId: "turn-1",
      drawerPlayerId: DRAWER.id,
      prompt,
      secretLevel: 7,
      drawing: null,
      drawingSubmittedAt: null,
      guesses: {},
      scoresAppliedAt: null,
      scoreResult: null,
    },
    usedPromptIds: [prompt.id],
    usedTurnIds: ["turn-1"],
    finishedState: null,
    startedAt: 2_000,
    phaseEndsAt: null,
  };
}

describe("DRAWING_PROMPTS", () => {
  it("conserve exactement les 36 consignes originales avec des identifiants uniques", () => {
    expect(DRAWING_PROMPTS).toHaveLength(36);
    expect(new Set(DRAWING_PROMPTS.map(({ id }) => id)).size).toBe(
      DRAWING_PROMPTS.length,
    );
  });

  it("fournit tous les champs requis avec des valeurs non vides", () => {
    for (const prompt of DRAWING_PROMPTS) {
      expect(prompt.id.trim()).toBe(prompt.id);
      expect(prompt.id).not.toBe("");
      expect(prompt.statement.trim()).toBe(prompt.statement);
      expect(prompt.statement).not.toBe("");
      expect(prompt.lowLabel.trim()).toBe(prompt.lowLabel);
      expect(prompt.lowLabel).not.toBe("");
      expect(prompt.highLabel.trim()).toBe(prompt.highLabel);
      expect(prompt.highLabel).not.toBe("");
      expect(prompt.category.trim()).toBe(prompt.category);
      expect(prompt.category).not.toBe("");
    }
  });

  it("annonce explicitement le niveau 10 avant le niveau 1 dans chaque phrase", () => {
    for (const { statement } of DRAWING_PROMPTS) {
      const highLevelIndex = statement.indexOf("(10)");
      const lowLevelIndex = statement.indexOf("(1)");

      expect(highLevelIndex).toBeGreaterThanOrEqual(0);
      expect(lowLevelIndex).toBeGreaterThanOrEqual(0);
      expect(highLevelIndex).toBeLessThan(lowLevelIndex);
    }
  });

  it("emploie une action claire et aucune formulation vague interdite", () => {
    for (const { statement } of DRAWING_PROMPTS) {
      expect(statement).toMatch(/^(?:Représente|Dessine)\b/u);
      expect(statement).not.toMatch(/plus ou moins/iu);
      expect(statement).not.toMatch(/\bun peu\b/iu);
      expect(statement).not.toMatch(/\bassez\b/iu);
    }
  });

  it("projette chaque consigne champ par champ sans donnée interne ni secret", () => {
    for (const prompt of DRAWING_PROMPTS) {
      const publicGame = toPublicGameState(createGame(prompt), [DRAWER]);

      expect(publicGame.prompt).toEqual({
        id: prompt.id,
        statement: prompt.statement,
        lowLabel: prompt.lowLabel,
        highLabel: prompt.highLabel,
      });
      expect(publicGame.prompt).not.toHaveProperty("category");
      expect(publicGame).not.toHaveProperty("secretLevel");
      expect(publicGame).not.toHaveProperty("turnOrder");
      expect(JSON.stringify(publicGame)).not.toContain("secretLevel");
      expect(JSON.stringify(publicGame)).not.toContain("drawer-socket");
    }
  });

  it("ignore aussi d'éventuels champs privés présents sur une consigne interne", () => {
    const promptWithPrivateExtras = {
      ...DRAWING_PROMPTS[0],
      secretLevel: 7,
      markerPosition: 65,
      cssClass: "secret-level-7",
    };

    const publicGame = toPublicGameState(
      createGame(promptWithPrivateExtras),
      [DRAWER],
    );
    const serialized = JSON.stringify(publicGame);

    expect(Object.keys(publicGame.prompt).sort()).toEqual(
      ["highLabel", "id", "lowLabel", "statement"].sort(),
    );
    expect(serialized).not.toContain("secretLevel");
    expect(serialized).not.toContain("markerPosition");
    expect(serialized).not.toContain("secret-level-7");
  });
});
