import type { TurnSecretPayload } from "@drawing-game/shared";
import { describe, expect, it } from "vitest";

import {
  createSubmitGuessPayload,
  didPublicTurnChange,
  isTurnSecretForActiveDrawer,
} from "../../client/src/hooks/useRoomSession.js";

const SECRET: TurnSecretPayload = {
  roomCode: "ABCDE",
  turnId: "turn-2",
  drawerPlayerId: "player-1",
  secretLevel: 7,
};

const ACTIVE_CONTEXT = {
  roomCode: "ABCDE",
  turnId: "turn-2",
  playerId: "player-1",
} as const;

describe("private turn state guards", () => {
  it("associe chaque estimation envoyée au tour public actif", () => {
    expect(createSubmitGuessPayload("turn-7", 4)).toEqual({
      turnId: "turn-7",
      value: 4,
    });
  });

  it("détecte chaque nouveau turnId, y compris l'entrée et la sortie d'une partie", () => {
    expect(didPublicTurnChange(null, null)).toBe(false);
    expect(didPublicTurnChange(null, "turn-1")).toBe(true);
    expect(didPublicTurnChange("turn-1", "turn-1")).toBe(false);
    expect(didPublicTurnChange("turn-1", "turn-2")).toBe(true);
    expect(didPublicTurnChange("turn-2", null)).toBe(true);
  });

  it("accepte uniquement le secret du tour actif destiné au joueur courant", () => {
    expect(isTurnSecretForActiveDrawer(SECRET, ACTIVE_CONTEXT)).toBe(true);
    expect(
      isTurnSecretForActiveDrawer(
        { ...SECRET, turnId: "turn-1" },
        ACTIVE_CONTEXT,
      ),
    ).toBe(false);
    expect(
      isTurnSecretForActiveDrawer(
        { ...SECRET, roomCode: "OTHER" },
        ACTIVE_CONTEXT,
      ),
    ).toBe(false);
    expect(
      isTurnSecretForActiveDrawer(
        { ...SECRET, drawerPlayerId: "player-2" },
        ACTIVE_CONTEXT,
      ),
    ).toBe(false);
  });

  it("rejette un secret retardé, invalide ou reçu sans tour actif", () => {
    expect(
      isTurnSecretForActiveDrawer(
        { ...SECRET, secretLevel: 0 },
        ACTIVE_CONTEXT,
      ),
    ).toBe(false);
    expect(
      isTurnSecretForActiveDrawer(
        { ...SECRET, secretLevel: 11 },
        ACTIVE_CONTEXT,
      ),
    ).toBe(false);
    expect(
      isTurnSecretForActiveDrawer(
        { ...SECRET, secretLevel: 7.5 },
        ACTIVE_CONTEXT,
      ),
    ).toBe(false);
    expect(
      isTurnSecretForActiveDrawer(SECRET, {
        ...ACTIVE_CONTEXT,
        turnId: null,
      }),
    ).toBe(false);
  });
});
