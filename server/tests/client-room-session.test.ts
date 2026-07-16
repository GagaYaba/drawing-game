import type { TurnSecretPayload } from "@drawing-game/shared";
import { describe, expect, it } from "vitest";

import {
  createSubmitGuessPayload,
  didPublicGameChange,
  didPublicTurnChange,
  isGameActionContextCurrent,
  isTurnSecretForActiveDrawer,
} from "../../client/src/hooks/useRoomSession.js";

const SECRET: TurnSecretPayload = {
  roomCode: "ABCDE",
  gameId: "game-2",
  turnId: "turn-2",
  drawerPlayerId: "player-1",
  secretLevel: 7,
};

const ACTIVE_CONTEXT = {
  roomCode: "ABCDE",
  gameId: "game-2",
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

  it("détecte un changement de partie même si le turnId est réutilisé", () => {
    expect(didPublicGameChange(null, null)).toBe(false);
    expect(didPublicGameChange(null, "game-1")).toBe(true);
    expect(didPublicGameChange("game-1", "game-1")).toBe(false);
    expect(didPublicGameChange("game-1", "game-2")).toBe(true);
    expect(didPublicGameChange("game-2", null)).toBe(true);
  });

  it("invalide les acknowledgements dès que leur contexte public change", () => {
    const actionContext = {
      roomCode: "ABCDE",
      gameId: "game-2",
      turnId: "turn-2",
      phase: "VOTING",
    } as const;

    expect(
      isGameActionContextCurrent(actionContext, actionContext),
    ).toBe(true);
    expect(
      isGameActionContextCurrent(actionContext, {
        ...actionContext,
        gameId: "game-3",
      }),
    ).toBe(false);
    expect(
      isGameActionContextCurrent(actionContext, {
        ...actionContext,
        turnId: "turn-3",
      }),
    ).toBe(false);
    expect(
      isGameActionContextCurrent(actionContext, {
        ...actionContext,
        phase: "REVEAL",
      }),
    ).toBe(false);
    expect(isGameActionContextCurrent(actionContext, null)).toBe(false);
  });

  it("accepte uniquement le secret du tour actif destiné au joueur courant", () => {
    expect(isTurnSecretForActiveDrawer(SECRET, ACTIVE_CONTEXT)).toBe(true);
    expect(
      isTurnSecretForActiveDrawer(
        { ...SECRET, gameId: "game-1" },
        ACTIVE_CONTEXT,
      ),
    ).toBe(false);
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
