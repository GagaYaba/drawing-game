import type {
  PublicFinishedState,
  PublicRoomState,
} from "@drawing-game/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FinishedScreen } from "../../client/src/components/FinishedScreen.js";
import { LobbyScreen } from "../../client/src/components/LobbyScreen.js";

const HOST_ID = "host-id";
const PLAYER_ID = "player-id";
const REMATCH_NOTICE =
  "La revanche est prête. Indiquez lorsque vous êtes prêt à jouer.";

const FINISHED: PublicFinishedState = {
  leaderboard: [
    {
      rank: 1,
      player: {
        id: HOST_ID,
        nickname: "Camille",
      },
      score: 12,
    },
    {
      rank: 2,
      player: {
        id: PLAYER_ID,
        nickname: "Élodie",
      },
      score: 8,
    },
  ],
  winners: [
    {
      id: HOST_ID,
      nickname: "Camille",
      score: 12,
    },
  ],
  completedRounds: 2,
  completedTurns: 6,
};

const LOBBY_ROOM: PublicRoomState = {
  code: "ABCDE",
  players: [
    {
      id: HOST_ID,
      nickname: "Camille",
      isHost: true,
      isReady: false,
      isConnected: true,
      reconnectDeadline: null,
      score: 0,
    },
    {
      id: PLAYER_ID,
      nickname: "Élodie",
      isHost: false,
      isReady: false,
      isConnected: true,
      reconnectDeadline: null,
      score: 0,
    },
  ],
  playerCount: 2,
  maxPlayers: 8,
  minimumPlayersToStart: 3,
  allPlayersReady: false,
  canStart: false,
  game: null,
};

function getVisibleText(markup: string) {
  return markup
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderFinished(
  overrides: Partial<Parameters<typeof FinishedScreen>[0]> = {},
) {
  return renderToStaticMarkup(
    <FinishedScreen
      finished={FINISHED}
      currentPlayerId={HOST_ID}
      isHost
      pendingAction={null}
      errorMessage={null}
      onRequestRematch={() => true}
      onLeaveRoom={() => undefined}
      {...overrides}
    />,
  );
}

describe("FinishedScreen rematch", () => {
  it("réserve la proposition de revanche à l'hôte sans masquer le départ", () => {
    const markup = renderFinished();
    const text = getVisibleText(markup);

    expect(markup).toContain("finished-rematch");
    expect(markup).toContain("finished-rematch-button");
    expect(text).toContain("Proposer une revanche");
    expect(text).toContain("Quitter la partie");
    expect(text).not.toContain("L’hôte peut proposer une revanche.");
  });

  it("bloque le double clic et annonce le chargement pendant la demande", () => {
    const markup = renderFinished({ pendingAction: "rematch" });
    const text = getVisibleText(markup);

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain(
      'class="button button--primary finished-rematch-button" type="button" disabled=""',
    );
    expect(text).toContain("Préparation…");
    expect(text).toContain("Préparation de la revanche en cours.");
    expect(markup).toContain('role="status"');
  });

  it("informe les non-hôtes sans leur rendre le bouton", () => {
    const markup = renderFinished({
      currentPlayerId: PLAYER_ID,
      isHost: false,
    });
    const text = getVisibleText(markup);

    expect(text).toContain("L’hôte peut proposer une revanche.");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain("finished-rematch-button");
    expect(text).toContain("Quitter la partie");
  });

  it("conserve le bouton après une erreur serveur afin de pouvoir réessayer", () => {
    const markup = renderFinished({
      errorMessage: "Le serveur a refusé la revanche.",
    });
    const text = getVisibleText(markup);

    expect(markup).toContain('role="alert"');
    expect(text).toContain("Le serveur a refusé la revanche.");
    expect(text).toContain("Proposer une revanche");
  });
});

describe("rematch lobby notice", () => {
  it("annonce le retour au lobby dans une zone de statut accessible", () => {
    const markup = renderToStaticMarkup(
      <LobbyScreen
        room={LOBBY_ROOM}
        currentPlayerId={HOST_ID}
        pendingAction={null}
        errorMessage={null}
        noticeMessage={REMATCH_NOTICE}
        onSetReady={() => undefined}
        onStartGame={() => undefined}
        onLeaveRoom={() => undefined}
      />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(getVisibleText(markup)).toContain(REMATCH_NOTICE);
  });
});
