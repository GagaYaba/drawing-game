import { readFileSync } from "node:fs";

import type {
  PublicFinishedState,
  PublicLeaderboardEntry,
  PublicPlayer,
} from "@drawing-game/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FinishedScreen } from "../../client/src/components/FinishedScreen.js";

const GLOBAL_PODIUM_STYLES = readFileSync(
  new URL(
    "../../client/src/components/FinishedScreen.css",
    import.meta.url,
  ),
  "utf8",
);

const entries: PublicLeaderboardEntry[] = [
  {
    rank: 1,
    player: { id: "player-1", nickname: "Élodie" },
    score: 12,
  },
  {
    rank: 2,
    player: { id: "player-2", nickname: "Camille" },
    score: 9,
  },
  {
    rank: 3,
    player: { id: "player-3", nickname: "Noé" },
    score: 4,
  },
  {
    rank: 4,
    player: { id: "player-4", nickname: "Jade" },
    score: 2,
  },
];

function createFinished(
  leaderboard: PublicLeaderboardEntry[] = entries,
): PublicFinishedState {
  const winningScore = leaderboard[0]?.score ?? 0;

  return {
    leaderboard,
    winners: leaderboard
      .filter((entry) => entry.score === winningScore)
      .map((entry) => ({
        id: entry.player.id,
        nickname: entry.player.nickname,
        score: entry.score,
      })),
    completedRounds: 2,
    completedTurns: 8,
  };
}

function renderFinished(
  finished: PublicFinishedState,
  overrides: Partial<Parameters<typeof FinishedScreen>[0]> = {},
) {
  return renderToStaticMarkup(
    <FinishedScreen
      finished={finished}
      currentPlayerId="player-1"
      isHost
      pendingAction={null}
      errorMessage={null}
      onRequestRematch={() => true}
      onLeaveRoom={() => undefined}
      {...overrides}
    />,
  );
}

function getPodiumMarkup(markup: string) {
  const start = markup.indexOf("<ol");
  const end = markup.indexOf("</ol>", start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return markup.slice(start, end);
}

function countOccurrences(source: string, fragment: string) {
  return source.split(fragment).length - 1;
}

describe("FinishedScreen podium", () => {
  it("ordonne les trois premiers dans le DOM, place le premier au centre visuel et conserve tous les scores", () => {
    const markup = renderFinished(createFinished());
    const podium = getPodiumMarkup(markup);

    expect(podium).toContain('aria-label="Podium final"');
    expect(podium).toContain("finished-podium--count-3");
    expect(podium).toContain("finished-podium__entry--slot-1");
    expect(podium).toContain("finished-podium__entry--slot-2");
    expect(podium).toContain("finished-podium__entry--slot-3");
    expect(podium.indexOf("Élodie")).toBeLessThan(
      podium.indexOf("Camille"),
    );
    expect(podium.indexOf("Camille")).toBeLessThan(
      podium.indexOf("Noé"),
    );
    expect(podium).toContain("12 points");
    expect(podium).toContain("9 points");
    expect(podium).toContain("4 points");
    expect(podium).not.toContain("Jade");
    expect(markup).toContain("Suite du classement");
    expect(markup).toContain("Jade");

    expect(GLOBAL_PODIUM_STYLES).toMatch(
      /\.finished-podium\s*\{[\s\S]*?grid-template-areas:\s*"second first third";/,
    );
    expect(GLOBAL_PODIUM_STYLES).toMatch(
      /\.finished-podium__entry--slot-1\s*\{\s*grid-area:\s*first;/,
    );
  });

  it("conserve les rangs réels et annonce explicitement les égalités", () => {
    const tiedEntries: PublicLeaderboardEntry[] = [
      {
        rank: 1,
        player: { id: "player-1", nickname: "Élodie" },
        score: 12,
      },
      {
        rank: 1,
        player: { id: "player-2", nickname: "Camille" },
        score: 12,
      },
      {
        rank: 3,
        player: { id: "player-3", nickname: "Noé" },
        score: 7,
      },
    ];
    const markup = renderFinished(createFinished(tiedEntries));
    const podium = getPodiumMarkup(markup);

    expect(podium).toContain("finished-podium--shared-first");
    expect(
      countOccurrences(
        podium,
        "finished-podium__entry--rank-1",
      ),
    ).toBe(2);
    expect(podium).toContain(
      'aria-label="1re place ex æquo : Élodie, 12 points, vous"',
    );
    expect(podium).toContain(
      'aria-label="1re place ex æquo : Camille, 12 points"',
    );
    expect(podium).not.toContain("Noé");
    expect(markup).toContain("Suite du classement");
    expect(markup).toContain("Noé");
  });

  it("présente tous les co-gagnants au même niveau, même au-delà de trois", () => {
    const tiedEntries: PublicLeaderboardEntry[] = Array.from(
      { length: 4 },
      (_, index) => ({
        rank: 1,
        player: {
          id: `player-${index + 1}`,
          nickname: `Champion ${index + 1}`,
        },
        score: 0,
      }),
    );
    const markup = renderFinished(createFinished(tiedEntries));
    const podium = getPodiumMarkup(markup);

    expect(podium).toContain("finished-podium--count-4");
    expect(podium).toContain("finished-podium--shared-first");
    expect(
      countOccurrences(
        podium,
        "finished-podium__entry--rank-1",
      ),
    ).toBe(4);
    for (const entry of tiedEntries) {
      expect(podium).toContain(entry.player.nickname);
    }
    expect(markup).not.toContain("Suite du classement");
    expect(GLOBAL_PODIUM_STYLES).toMatch(
      /\.finished-podium--shared-first\s*\{[\s\S]*?grid-template-columns:\s*repeat\([\s\S]*?auto-fit,/,
    );
  });

  it("ne coupe pas une égalité qui traverse la troisième entrée", () => {
    const tiedSecondEntries: PublicLeaderboardEntry[] = [
      {
        rank: 1,
        player: { id: "player-1", nickname: "Élodie" },
        score: 12,
      },
      ...["Camille", "Noé", "Jade"].map((nickname, index) => ({
        rank: 2,
        player: {
          id: `player-${index + 2}`,
          nickname,
        },
        score: 9,
      })),
      {
        rank: 5,
        player: { id: "player-5", nickname: "Lina" },
        score: 3,
      },
    ];
    const markup = renderFinished(createFinished(tiedSecondEntries));
    const podium = getPodiumMarkup(markup);

    expect(podium).toContain("finished-podium--count-4");
    expect(podium).toContain("finished-podium--extended");
    for (const nickname of ["Élodie", "Camille", "Noé", "Jade"]) {
      expect(podium).toContain(nickname);
    }
    expect(podium).not.toContain("Lina");
    expect(markup).toContain("Suite du classement");
    expect(markup).toContain("Lina");
  });

  it("affiche une ou deux places sans fabriquer de marche vide", () => {
    const onePlayer = renderFinished(
      createFinished(entries.slice(0, 1)),
    );
    const twoPlayers = renderFinished(
      createFinished(entries.slice(0, 2)),
    );

    expect(getPodiumMarkup(onePlayer)).toContain(
      "finished-podium--count-1",
    );
    expect(
      countOccurrences(
        getPodiumMarkup(onePlayer),
        "finished-podium__entry--slot-",
      ),
    ).toBe(1);
    expect(getPodiumMarkup(twoPlayers)).toContain(
      "finished-podium--count-2",
    );
    expect(
      countOccurrences(
        getPodiumMarkup(twoPlayers),
        "finished-podium__entry--slot-",
      ),
    ).toBe(2);
  });

  it("intègre reconnexion, revanche selon le rôle et départ dans la scène finale", () => {
    const players: PublicPlayer[] = [
      {
        id: "player-1",
        nickname: "Élodie",
        isHost: true,
        isReady: false,
        isConnected: true,
        reconnectDeadline: null,
        score: 12,
      },
      {
        id: "player-2",
        nickname: "Camille",
        isHost: false,
        isReady: false,
        isConnected: false,
        reconnectDeadline: 10_000,
        score: 9,
      },
    ];
    const hostMarkup = renderFinished(createFinished(), { players });
    const guestMarkup = renderFinished(createFinished(), {
      currentPlayerId: "player-2",
      isHost: false,
      players,
    });

    expect(hostMarkup).toContain("Reconnexion en cours");
    expect(hostMarkup).toContain("finished-rematch-button");
    expect(hostMarkup).toContain("Proposer une revanche");
    expect(hostMarkup).toContain("Quitter la partie");
    expect(guestMarkup).not.toContain("finished-rematch-button");
    expect(guestMarkup).toContain("finished-rematch--guest");
    expect(guestMarkup).toContain("L’hôte peut proposer une revanche.");
    expect(guestMarkup).toContain("Quitter la partie");
  });

  it("préserve le viewport desktop, le repli 320 px et le mouvement réduit", () => {
    expect(GLOBAL_PODIUM_STYLES).toMatch(
      /\.finished-screen \.game-phase-layout__body\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    );
    expect(GLOBAL_PODIUM_STYLES).toMatch(
      /@media \(min-width:\s*900px\)[\s\S]*?\.finished-stage\s*\{[\s\S]*?overflow-y:\s*auto;/,
    );
    expect(GLOBAL_PODIUM_STYLES).toMatch(
      /@media \(max-width:\s*360px\)[\s\S]*?grid-template-areas:\s*"first"\s*"second"\s*"third";/,
    );
    expect(GLOBAL_PODIUM_STYLES).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.finished-podium__mascot[\s\S]*?animation:\s*none !important;/,
    );
  });
});
