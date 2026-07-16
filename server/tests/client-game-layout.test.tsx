import { readFileSync } from "node:fs";

import type { PublicGameState } from "@drawing-game/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppLayout } from "../../client/src/App.js";
import { GameLeaderboard } from "../../client/src/components/game/GameLeaderboard.js";
import {
  GamePromptHeader,
  GamePromptValue,
} from "../../client/src/components/game/GamePromptHeader.js";
import { GameStatusPanel } from "../../client/src/components/game/GameStatusPanel.js";

const GLOBAL_STYLES = readFileSync(
  new URL("../../client/src/styles/global.css", import.meta.url),
  "utf8",
);

function createGame(drawerNickname = "Camille"): PublicGameState {
  return {
    gameId: "game-1",
    phase: "DRAWING",
    turnId: "turn-1",
    totalRounds: 2,
    currentRound: 1,
    currentTurnNumber: 1,
    totalTurns: 6,
    currentDrawer: {
      id: "drawer-id",
      nickname: drawerNickname,
    },
    prompt: {
      id: "test-prompt",
      statement:
        "Représente un dragon du plus puissant (10) au moins puissant (1).",
      lowLabel: "Moins puissant",
      highLabel: "Plus puissant",
    },
    phaseEndsAt: null,
    submittedDrawing: null,
    voting: null,
    reveal: null,
    finished: null,
  };
}

describe("AppLayout", () => {
  it("conserve la marque et les diagnostics hors d'une phase active", () => {
    const markup = renderToStaticMarkup(
      <AppLayout isGameActive={false}>
        <section aria-label="Lobby de test">Lobby</section>
      </AppLayout>,
    );

    expect(markup).toContain('<main class="app-shell">');
    expect(markup).toContain('<header class="hero">');
    expect(markup).toContain("Jeu multijoueur");
    expect(markup).toContain("Drawing Scale Game");
    expect(markup).toContain('class="game-logo"');
    expect(markup).toContain("<span>Drawing</span>");
    expect(markup).toContain("Scale Game");
    expect(markup).toContain("Diagnostic technique");
    expect(markup).toContain(
      "<footer>React · Express · Socket.IO · TypeScript</footer>",
    );
    expect(markup).toContain('aria-label="Lobby de test"');
  });

  it("retire la marque et le footer tout en gardant les diagnostics montés mais masqués", () => {
    const markup = renderToStaticMarkup(
      <AppLayout isGameActive>
        <section aria-label="Phase active de test">Partie</section>
      </AppLayout>,
    );

    expect(markup).toContain(
      '<main class="app-shell app-shell--active">',
    );
    expect(markup).toContain('aria-label="Phase active de test"');
    expect(markup).not.toContain('class="hero"');
    expect(markup).not.toContain("Jeu multijoueur");
    expect(markup).not.toContain("Drawing Scale Game");
    expect(markup).toContain(
      '<details class="diagnostics" hidden="" aria-hidden="true">',
    );
    expect(markup).toContain("Diagnostic technique");
    expect(markup).not.toContain("<footer>");
  });

  it("verrouille le scroll de page sur desktop et le rétablit sur mobile", () => {
    expect(GLOBAL_STYLES).toMatch(
      /@media \(min-width: 900px\)[\s\S]*?\.app-shell--active\s*\{[\s\S]*?height: 100vh;[\s\S]*?overflow: hidden;/,
    );
    expect(GLOBAL_STYLES).toMatch(
      /@media \(max-width: 899px\)[\s\S]*?\.app-shell--active\s*\{[\s\S]*?height: auto;[\s\S]*?overflow: visible;/,
    );
    expect(GLOBAL_STYLES).toMatch(
      /\.game-phase-layout__sidebar\.reveal-sidebar\s*\{[\s\S]*?overflow: hidden;/,
    );
    expect(GLOBAL_STYLES).toMatch(
      /\.reveal-sidebar__content\s*\{[\s\S]*?overflow-y: auto;/,
    );
    expect(GLOBAL_STYLES).toMatch(
      /\.reveal-sidebar__content\s*\{[\s\S]*?grid-auto-rows: max-content;[\s\S]*?align-content: start;/,
    );
    expect(GLOBAL_STYLES).toMatch(
      /\.finished-sidebar \.game-leaderboard\s*\{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?overflow: hidden;/,
    );
    expect(GLOBAL_STYLES).toMatch(
      /\.finished-sidebar \.game-leaderboard__list\s*\{[\s\S]*?overflow-y: auto;/,
    );
    expect(GLOBAL_STYLES).toMatch(
      /@media \(min-width: 900px\)[\s\S]*?\.game-phase-layout__sidebar\.finished-sidebar\s*\{[\s\S]*?overflow: hidden;/,
    );
  });

  it("désactive les animations des mascottes en mouvement réduit", () => {
    expect(GLOBAL_STYLES).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none/u,
    );
  });
});

describe("GameStatusPanel", () => {
  it("regroupe manche, tour et dessinateur en conservant le nom complet accessible", () => {
    const drawerNickname = "Alexandrine-Extraordinaire";
    const markup = renderToStaticMarkup(
      <GameStatusPanel game={createGame(drawerNickname)} />,
    );

    expect(markup).toContain(
      '<dl class="game-status-panel" aria-label="Progression de la partie">',
    );
    expect(markup).toContain("<dt>Manche</dt><dd>1 / 2</dd>");
    expect(markup).toContain("<dt>Tour</dt><dd>1 / 6</dd>");
    expect(markup).toContain("<dt>Dessinateur</dt>");
    expect(markup).toContain(
      `<dd class="game-status-panel__drawer" title="${drawerNickname}">${drawerNickname}</dd>`,
    );
  });
});

describe("GameLeaderboard", () => {
  it("affiche les rangs, les scores et identifie le joueur courant", () => {
    const markup = renderToStaticMarkup(
      <GameLeaderboard
        entries={[
          {
            rank: 1,
            player: { id: "player-1", nickname: "Élodie" },
            score: 12,
          },
          {
            rank: 2,
            player: { id: "player-2", nickname: "Camille" },
            score: 1,
          },
        ]}
        currentPlayerId="player-2"
      />,
    );

    expect(markup).toContain('aria-label="Classement de la partie"');
    expect(markup).toContain('aria-label="Rang 1">1</span>');
    expect(markup).toContain("Élodie");
    expect(markup).toContain("12 points");
    expect(markup).toContain(
      'class="game-leaderboard__entry game-leaderboard__entry--current"',
    );
    expect(markup).toContain("Camille");
    expect(markup).toContain("1 point");
    expect(markup).toContain("Vous");
  });
});

describe("GamePromptHeader", () => {
  it("place la question, la jauge puis la valeur après la phrase de consigne", () => {
    const statement = "Représente un phare du plus lumineux au moins lumineux.";
    const markup = renderToStaticMarkup(
      <GamePromptHeader
        statement={statement}
        gaugePrompt={<p>Quel niveau faut-il estimer ?</p>}
        gauge={<div data-testid="gauge">Jauge</div>}
        valueText={
          <GamePromptValue label="Votre estimation" value={6} />
        }
      />,
    );
    const statementIndex = markup.indexOf(statement);
    const questionIndex = markup.indexOf(
      'class="game-prompt-header__question"',
    );
    const gaugeIndex = markup.indexOf(
      'class="game-prompt-header__gauge"',
    );
    const valueIndex = markup.indexOf(
      'class="game-prompt-header__value"',
    );

    expect(markup).toContain(
      'class="game-prompt-header game-prompt-header--with-question game-prompt-header--with-value"',
    );
    expect(statementIndex).toBeGreaterThanOrEqual(0);
    expect(questionIndex).toBeGreaterThan(statementIndex);
    expect(gaugeIndex).toBeGreaterThan(questionIndex);
    expect(valueIndex).toBeGreaterThan(gaugeIndex);
    expect(markup).toContain("Votre estimation");
    expect(markup).toContain("<strong>6</strong>");
  });
});
