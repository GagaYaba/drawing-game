import type {
  PublicPlayer,
  PublicRoomState,
  TurnSecretPayload,
} from "@drawing-game/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectionRecoveryOverlay } from "../../client/src/components/ConnectionRecoveryOverlay.js";
import { LobbyScreen } from "../../client/src/components/LobbyScreen.js";
import {
  DisconnectedPlayersNotice,
  PlayerConnectionStatus,
} from "../../client/src/components/PlayerConnectionStatus.js";
import {
  isGameActionContextCurrent,
  isPermanentSessionRestoreError,
  isTurnSecretForActiveDrawer,
} from "../../client/src/hooks/useRoomSession.js";

const NOW = 1_700_000_000_000;
const SESSION_TOKEN = "A".repeat(43);

function getVisibleText(markup: string) {
  return markup
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createPlayer(
  overrides: Partial<PublicPlayer> = {},
): PublicPlayer {
  return {
    id: "player-1",
    nickname: "Camille",
    isHost: false,
    isReady: true,
    isConnected: true,
    reconnectDeadline: null,
    score: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConnectionRecoveryOverlay", () => {
  it("bloque l'interface avec un texte de déconnexion accessible sans exposer le token", () => {
    const markup = renderToStaticMarkup(
      <ConnectionRecoveryOverlay
        {...{
          status: "disconnected" as const,
          announcement: "Connexion perdue.",
          hasStoredSession: true,
          onRetry: () => undefined,
          token: SESSION_TOKEN,
        }}
      />,
    );
    const text = getVisibleText(markup);

    expect(text).toContain("Connexion interrompue");
    expect(text).toContain("Tentative de reconnexion");
    expect(text).toContain("délai de grâce");
    expect(markup).toContain("connection-recovery-overlay");
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="assertive"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).not.toContain(SESSION_TOKEN);
  });

  it("distingue la restauration et réserve la région live masquée à l'annonce finale", () => {
    const restoringMarkup = renderToStaticMarkup(
      <ConnectionRecoveryOverlay
        status="restoring"
        announcement="Cette annonce reste masquée pendant la restauration."
        hasStoredSession
        onRetry={() => undefined}
      />,
    );
    const connectedMarkup = renderToStaticMarkup(
      <ConnectionRecoveryOverlay
        status="connected"
        announcement="Votre session a été restaurée."
        hasStoredSession
        onRetry={() => undefined}
      />,
    );

    expect(getVisibleText(restoringMarkup)).toContain(
      "Restauration de votre session",
    );
    expect(getVisibleText(restoringMarkup)).toContain(
      "Votre place et votre progression sont en cours de récupération.",
    );
    expect(restoringMarkup).not.toContain(
      "Cette annonce reste masquée pendant la restauration.",
    );

    expect(connectedMarkup).not.toContain("connection-recovery-overlay");
    expect(getVisibleText(connectedMarkup)).toContain(
      "Votre session a été restaurée.",
    );
    expect(connectedMarkup).toContain('aria-live="assertive"');
  });

  it("ne montre aucune récupération lorsqu'aucune session n'est conservée", () => {
    const markup = renderToStaticMarkup(
      <ConnectionRecoveryOverlay
        status="disconnected"
        announcement={null}
        hasStoredSession={false}
        onRetry={() => undefined}
      />,
    );

    expect(markup).not.toContain("connection-recovery-overlay");
    expect(getVisibleText(markup)).toBe("");
  });

  it("conserve l'écran bloqué après un échec transitoire et propose une nouvelle tentative", () => {
    const markup = renderToStaticMarkup(
      <ConnectionRecoveryOverlay
        status="restore-failed"
        announcement="Une erreur temporaire empêche la restauration."
        hasStoredSession
        onRetry={() => undefined}
      />,
    );
    const text = getVisibleText(markup);

    expect(markup).toContain("connection-recovery-overlay");
    expect(markup).toContain('role="alert"');
    expect(text).toContain("Restauration interrompue");
    expect(text).toContain(
      "Une erreur temporaire empêche la restauration.",
    );
    expect(text).toContain("Réessayer la restauration");
    expect(markup).toContain('type="button"');
  });
});

describe("statuts textuels de reconnexion", () => {
  it("affiche un compte à rebours textuel sans région live actualisée chaque seconde", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const player = createPlayer({
      isConnected: false,
      reconnectDeadline: NOW + 42_000,
    });
    const markup = renderToStaticMarkup(
      <PlayerConnectionStatus player={player} />,
    );

    expect(getVisibleText(markup)).toBe("Reconnexion… 42 s");
    expect(markup).toContain("player-connection-status--reconnecting");
    expect(markup).not.toContain("aria-live");
  });

  it("peut rendre explicitement l'état connecté", () => {
    const player = createPlayer();

    expect(
      getVisibleText(
        renderToStaticMarkup(
          <PlayerConnectionStatus player={player} showConnected />,
        ),
      ),
    ).toBe("Connecté");
    expect(
      renderToStaticMarkup(<PlayerConnectionStatus player={player} />),
    ).toBe("");
  });

  it("annonce une seule fois les joueurs déconnectés et masque les joueurs connectés", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const markup = renderToStaticMarkup(
      <DisconnectedPlayersNotice
        players={[
          createPlayer({
            id: "connected",
            nickname: "Camille",
          }),
          createPlayer({
            id: "offline-1",
            nickname: "Élodie",
            isConnected: false,
            reconnectDeadline: NOW + 30_000,
          }),
          createPlayer({
            id: "offline-2",
            nickname: "Noé",
            isConnected: false,
            reconnectDeadline: null,
          }),
        ]}
      />,
    );
    const text = getVisibleText(markup);

    expect(markup).toContain(
      'aria-label="Joueurs en cours de reconnexion"',
    );
    expect(text).toContain("Élodie, Noé sont en cours de reconnexion.");
    expect(text).toContain("Élodie");
    expect(text).toContain("Noé");
    expect(text).not.toContain("Camille");
    expect(markup.match(/aria-live="polite"/g)).toHaveLength(1);
  });
});

describe("LobbyScreen avec un joueur en reconnexion", () => {
  it("priorise l'attente de reconnexion dans le décompte, la liste et la préparation", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const room: PublicRoomState = {
      code: "ABCD2",
      players: [
        createPlayer({
          id: "host",
          nickname: "Camille",
          isHost: true,
        }),
        createPlayer({
          id: "guest",
          nickname: "Élodie",
          isConnected: false,
          reconnectDeadline: NOW + 25_000,
        }),
      ],
      playerCount: 2,
      maxPlayers: 8,
      minimumPlayersToStart: 3,
      allPlayersReady: true,
      canStart: false,
      game: null,
    };
    const markup = renderToStaticMarkup(
      <LobbyScreen
        room={room}
        currentPlayerId="host"
        pendingAction={null}
        errorMessage={null}
        noticeMessage={null}
        onSetReady={() => undefined}
        onStartGame={() => undefined}
        onLeaveRoom={() => undefined}
      />,
    );
    const text = getVisibleText(markup);

    expect(text).toContain("1 connecté");
    expect(text).toContain("1 en reconnexion");
    expect(text).toContain("Élodie");
    expect(text).toContain("Reconnexion… 25 s");
    expect(text).toContain(
      "Attendez la reconnexion de tous les joueurs.",
    );
    expect(text).not.toContain("Il faut au moins 3 joueurs");
    expect(markup).toContain("player-row--disconnected");
  });
});

describe("gardes pures après restauration", () => {
  const secret: TurnSecretPayload = {
    roomCode: "ABCD2",
    gameId: "game-2",
    turnId: "turn-4",
    drawerPlayerId: "player-1",
    secretLevel: 7,
  };
  const restoredContext = {
    roomCode: "ABCD2",
    gameId: "game-2",
    turnId: "turn-4",
    playerId: "player-1",
  } as const;

  it("n'accepte le secret restauré que pour le salon, la partie, le tour et le joueur actifs", () => {
    expect(
      isTurnSecretForActiveDrawer(secret, restoredContext),
    ).toBe(true);
    expect(
      isTurnSecretForActiveDrawer(
        { ...secret, roomCode: "EFGH3" },
        restoredContext,
      ),
    ).toBe(false);
    expect(
      isTurnSecretForActiveDrawer(
        { ...secret, gameId: "game-1" },
        restoredContext,
      ),
    ).toBe(false);
    expect(
      isTurnSecretForActiveDrawer(
        { ...secret, turnId: "turn-3" },
        restoredContext,
      ),
    ).toBe(false);
    expect(
      isTurnSecretForActiveDrawer(
        { ...secret, drawerPlayerId: "player-2" },
        restoredContext,
      ),
    ).toBe(false);
  });

  it("rejette un acknowledgement d'avant reconnexion si le contexte public a changé", () => {
    const pendingContext = {
      roomCode: "ABCD2",
      gameId: "game-2",
      turnId: "turn-4",
      phase: "VOTING",
    } as const;

    expect(
      isGameActionContextCurrent(pendingContext, pendingContext),
    ).toBe(true);
    expect(
      isGameActionContextCurrent(pendingContext, {
        ...pendingContext,
        turnId: "turn-5",
      }),
    ).toBe(false);
    expect(isGameActionContextCurrent(pendingContext, null)).toBe(false);
  });
});

describe("classification des échecs de restauration", () => {
  it.each([
    "INVALID_SESSION",
    "SESSION_EXPIRED",
    "ROOM_NOT_FOUND",
    "PLAYER_NOT_FOUND",
  ])("considère %s comme définitif", (code) => {
    expect(isPermanentSessionRestoreError(code)).toBe(true);
  });

  it.each(["INTERNAL_ERROR", "SESSION_ALREADY_ACTIVE"])(
    "préserve la session pour %s",
    (code) => {
      expect(isPermanentSessionRestoreError(code)).toBe(false);
    },
  );
});
