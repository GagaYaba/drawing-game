import { describe, expect, it } from "vitest";

import { toPublicGameState, TOTAL_ROUNDS } from "../src/game/game-manager.js";
import { selectDrawingPrompt } from "../src/game/game-random.js";
import type { DrawingPrompt, InternalGame } from "../src/game/game-types.js";
import { DRAWING_PROMPTS } from "../src/game/prompt-bank.js";
import { MAX_PLAYERS } from "../src/rooms/room-manager.js";
import type { InternalPlayer } from "../src/rooms/room-types.js";
import { TEST_CLIENT_INSTANCE_ID } from "./test-client-instance.js";

const HISTORICAL_PROMPT_IDS = [
  "octopus-elegance",
  "cabin-comfort",
  "dragon-power",
  "penguin-suspicion",
  "train-speed",
  "sandwich-appetite",
  "lamp-modernity",
  "witch-kindness",
  "island-danger",
  "slipper-luxury",
  "alien-strangeness",
  "vampire-fear",
  "duck-humour",
  "cloud-sadness",
  "bicycle-intelligence",
  "crown-elegance",
  "sofa-comfort",
  "hamster-power",
  "detective-suspicion",
  "rocket-speed",
  "soup-appetite",
  "school-modernity",
  "goblin-cuteness",
  "bridge-danger",
  "tent-luxury",
  "fish-strangeness",
  "scarecrow-fear",
  "king-humour",
  "sun-sadness",
  "backpack-intelligence",
  "whale-elegance",
  "spaceship-comfort",
  "fairy-power",
  "neighbor-suspicion",
  "snail-speed",
  "planet-appetite",
] as const;

const NEW_PROMPT_IDS = [
  "toilet-paper-replacement",
  "heroic-official-reward",
  "unlikely-roommate",
  "partner-dirty-trick",
  "video-call-background",
  "future-diary-scene",
  "face-protection-substitute",
  "balcony-performance",
  "hamster-neighbor-revenge",
  "toilet-paper-mummy",
  "suspicious-drop-reaction",
  "dramatic-president-speech",
  "living-room-sport",
  "unlikely-miracle-remedy",
  "absurd-official-outing",
  "silent-video-karaoke",
] as const;

const DRAWER: InternalPlayer = {
  id: "drawer-id",
  socketId: "drawer-socket",
  activeClientInstanceId: TEST_CLIENT_INSTANCE_ID,
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
  it("contient exactement les 36 identifiants historiques et les 16 nouveaux", () => {
    const promptIds = DRAWING_PROMPTS.map(({ id }) => id);
    const expectedIds = [...HISTORICAL_PROMPT_IDS, ...NEW_PROMPT_IDS];

    expect(DRAWING_PROMPTS).toHaveLength(52);
    expect(new Set(promptIds).size).toBe(DRAWING_PROMPTS.length);
    expect([...promptIds].sort()).toEqual([...expectedIds].sort());
  });

  it("fournit des champs propres, des labels distincts et des textes adaptés au header", () => {
    for (const prompt of DRAWING_PROMPTS) {
      expect(prompt.id.trim()).toBe(prompt.id);
      expect(prompt.id).not.toBe("");
      expect(prompt.statement.trim()).toBe(prompt.statement);
      expect(prompt.statement).not.toBe("");
      expect([...prompt.statement].length).toBeLessThanOrEqual(220);
      expect(prompt.lowLabel.trim()).toBe(prompt.lowLabel);
      expect(prompt.lowLabel).not.toBe("");
      expect([...prompt.lowLabel].length).toBeLessThanOrEqual(30);
      expect(prompt.highLabel.trim()).toBe(prompt.highLabel);
      expect(prompt.highLabel).not.toBe("");
      expect([...prompt.highLabel].length).toBeLessThanOrEqual(30);
      expect(
        prompt.lowLabel.localeCompare(prompt.highLabel, "fr", {
          sensitivity: "base",
        }),
      ).not.toBe(0);
      expect(prompt.category.trim()).toBe(prompt.category);
      expect(prompt.category).not.toBe("");
    }
  });

  it("associe une mise en situation à une mission variée sans formulation vague", () => {
    const missionOpenings = new Set<string>();
    const statementsUsingRepresent = DRAWING_PROMPTS.filter(
      ({ statement }) => /\bReprésente\b/u.test(statement),
    );

    for (const { statement } of DRAWING_PROMPTS) {
      const match = statement.match(/^.+?[.!?]\s+(.+)$/u);

      expect(match).not.toBeNull();
      const mission = match?.[1] ?? "";
      expect(mission.length).toBeGreaterThan(30);
      expect(mission).toMatch(/\b(?:au|aux)\b|à l[’']|à la\b/iu);
      missionOpenings.add(mission.split(/\s+/u)[0] ?? "");
      expect(statement).not.toMatch(/plus ou moins/iu);
    }

    expect(missionOpenings.size).toBeGreaterThanOrEqual(8);
    expect(statementsUsingRepresent.length).toBeLessThan(
      DRAWING_PROMPTS.length / 4,
    );
  });

  it("ne duplique aucune consigne, même après normalisation éditoriale", () => {
    const normalizedStatements = DRAWING_PROMPTS.map(({ statement }) =>
      statement.normalize("NFC").toLocaleLowerCase("fr"),
    );

    expect(new Set(normalizedStatements).size).toBe(
      DRAWING_PROMPTS.length,
    );
  });

  it("rend les 16 nouvelles consignes accessibles à la sélection aléatoire", () => {
    const selectedIds = DRAWING_PROMPTS.map((_, index) =>
      selectDrawingPrompt(
        DRAWING_PROMPTS,
        () => (index + 0.5) / DRAWING_PROMPTS.length,
      ).id,
    );

    expect(selectedIds).toEqual(
      DRAWING_PROMPTS.map(({ id }) => id),
    );
    expect(NEW_PROMPT_IDS.every((id) => selectedIds.includes(id))).toBe(
      true,
    );
  });

  it("prévoit assez de consignes uniques pour huit joueurs et deux manches", () => {
    expect(DRAWING_PROMPTS.length).toBeGreaterThanOrEqual(
      MAX_PLAYERS * TOTAL_ROUNDS,
    );
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
