import type { TurnSecretPayload } from "@drawing-game/shared";
import { describe, expect, it } from "vitest";

import {
  buildCreateRoomPayload,
  buildJoinRoomPayload,
  buildRestoreSessionPayload,
  createSubmitGuessPayload,
  didPublicGameChange,
  didPublicTurnChange,
  getSessionRestoreRetryDelay,
  isAutomaticSessionRestoreRetryable,
  isGameActionContextCurrent,
  isTurnSecretForActiveDrawer,
  SESSION_RESTORE_RETRY_DELAYS_MS,
  shouldFailManualRestoreOnConnectError,
} from "../../client/src/hooks/useRoomSession.js";
import {
  createManualSessionRestoreGate,
} from "../../client/src/session/manual-session-restore.js";

const CLIENT_INSTANCE_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_TOKEN = "a".repeat(43);
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

describe("session action payloads", () => {
  it("associe l'identifiant de l'onglet à create, join et restore", () => {
    expect(
      buildCreateRoomPayload("Camille", CLIENT_INSTANCE_ID),
    ).toEqual({
      nickname: "Camille",
      clientInstanceId: CLIENT_INSTANCE_ID,
    });
    expect(
      buildJoinRoomPayload("Camille", "ABCDE", CLIENT_INSTANCE_ID),
    ).toEqual({
      nickname: "Camille",
      roomCode: "ABCDE",
      clientInstanceId: CLIENT_INSTANCE_ID,
    });
    expect(
      buildRestoreSessionPayload(
        {
          roomCode: "ABCDE",
          playerId: "player-1",
          token: SESSION_TOKEN,
        },
        CLIENT_INSTANCE_ID,
      ),
    ).toEqual({
      roomCode: "ABCDE",
      playerId: "player-1",
      token: SESSION_TOKEN,
      clientInstanceId: CLIENT_INSTANCE_ID,
    });
  });
});

describe("session restore retry policy", () => {
  it("borne les nouvelles tentatives à 200, 500 puis 1 000 ms", () => {
    expect(SESSION_RESTORE_RETRY_DELAYS_MS).toEqual([200, 500, 1_000]);
    expect([0, 1, 2, 3].map(getSessionRestoreRetryDelay)).toEqual([
      200,
      500,
      1_000,
      null,
    ]);
    expect(getSessionRestoreRetryDelay(-1)).toBeNull();
    expect(getSessionRestoreRetryDelay(1.5)).toBeNull();
  });

  it("réessaie automatiquement uniquement les erreurs serveur transitoires", () => {
    expect(isAutomaticSessionRestoreRetryable("INTERNAL_ERROR")).toBe(
      true,
    );
    expect(
      isAutomaticSessionRestoreRetryable("SESSION_ALREADY_ACTIVE"),
    ).toBe(false);
    expect(isAutomaticSessionRestoreRetryable("SESSION_EXPIRED")).toBe(
      false,
    );
    expect(isAutomaticSessionRestoreRetryable("INVALID_SESSION")).toBe(
      false,
    );
  });

  it("refuse le double clic puis se réarme après chaque résultat", () => {
    const gate = createManualSessionRestoreGate();

    expect(gate.begin()).toBe(true);
    expect(gate.isInFlight()).toBe(true);
    expect(gate.begin()).toBe(false);

    gate.finish();
    expect(gate.isInFlight()).toBe(false);
    expect(gate.begin()).toBe(true);

    gate.finish();
    expect(gate.isInFlight()).toBe(false);
    expect(gate.begin()).toBe(true);
    gate.finish();
    expect(gate.isInFlight()).toBe(false);
  });

  it("réarme le bouton si la connexion échoue avant l'émission manuelle", () => {
    expect(
      shouldFailManualRestoreOnConnectError(true, false),
    ).toBe(true);
    expect(
      shouldFailManualRestoreOnConnectError(true, true),
    ).toBe(false);
    expect(
      shouldFailManualRestoreOnConnectError(false, false),
    ).toBe(false);
  });
});

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
