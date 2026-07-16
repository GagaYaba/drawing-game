import {
  DRAWING_ASPECT_RATIO,
  DRAWING_BACKGROUND_COLOR,
  DRAWING_DOCUMENT_VERSION,
  type PublicGameState,
} from "@drawing-game/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DrawingScreen } from "../../client/src/components/DrawingScreen.js";
import { RevealScreen } from "../../client/src/components/RevealScreen.js";
import { RoundIntroScreen } from "../../client/src/components/RoundIntroScreen.js";
import { VotingScreen } from "../../client/src/components/VotingScreen.js";
import type { ClientGuessState } from "../../client/src/hooks/useRoomSession.js";

const DRAWER_ID = "drawer-id";
const OBSERVER_ID = "observer-id";
const SECRET_LEVEL = 7;
const PROMPT_STATEMENT =
  "Représente un dragon du plus puissant (10) au moins puissant (1).";

const submittedDrawing: NonNullable<PublicGameState["submittedDrawing"]> = {
  submittedAt: 1_000,
  document: {
    version: DRAWING_DOCUMENT_VERSION,
    aspectRatio: DRAWING_ASPECT_RATIO,
    backgroundColor: DRAWING_BACKGROUND_COLOR,
    strokes: [],
  },
};

function createGame(
  phase: PublicGameState["phase"],
): PublicGameState {
  return {
    phase,
    totalRounds: 2,
    currentRound: 1,
    currentTurnNumber: 1,
    totalTurns: 6,
    currentDrawer: {
      id: DRAWER_ID,
      nickname: "Camille",
    },
    prompt: {
      id: "test-prompt",
      statement: PROMPT_STATEMENT,
      lowLabel: "Moins puissant",
      highLabel: "Plus puissant",
    },
    phaseEndsAt: null,
    submittedDrawing:
      phase === "VOTING" || phase === "REVEAL"
        ? submittedDrawing
        : null,
    voting:
      phase === "VOTING"
        ? {
            eligibleVoterCount: 2,
            submittedGuessCount: 1,
          }
        : null,
    reveal:
      phase === "REVEAL"
        ? {
            secretLevel: SECRET_LEVEL,
            guesses: [
              {
                player: {
                  id: OBSERVER_ID,
                  nickname: "Élodie",
                },
                value: SECRET_LEVEL,
                distance: 0,
              },
              {
                player: {
                  id: "second-observer-id",
                  nickname: "Noé",
                },
                value: 4,
                distance: 3,
              },
            ],
          }
        : null,
  };
}

function createGuessState(
  overrides: Partial<ClientGuessState> = {},
): ClientGuessState {
  return {
    selected: null,
    submitted: null,
    isSubmitting: false,
    error: null,
    ...overrides,
  };
}

const commonProps = {
  pendingAction: null,
  errorMessage: null,
  onLeaveRoom: () => undefined,
} as const;

const votingCallbacks = {
  onSelectGuess: () => undefined,
  onSubmitGuess: () => false,
} as const;

function expectPublicGaugeWithoutSecret(markup: string): void {
  expect(markup).toContain("scale-gauge__track");
  expect(markup).toContain("Moins puissant");
  expect(markup).toContain("Plus puissant");
  expect(markup).toContain("Le niveau est secret.");
  expect(markup).not.toContain("scale-gauge__marker");
  expect(markup).not.toContain("Niveau secret :");
  expect(markup).not.toContain("Niveau secret actuel");
  expect(markup).not.toContain(`<strong>${SECRET_LEVEL}</strong>`);
}

function getVisibleText(markup: string): string {
  return markup
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getGuessSubmitButton(markup: string): string {
  const button = markup.match(
    /<button[^>]*class="button button--primary guess-submit-button"[^>]*>/,
  );

  expect(button).not.toBeNull();
  return button?.[0] ?? "";
}

function countOccurrences(source: string, fragment: string): number {
  return source.split(fragment).length - 1;
}

function expectCompactStatusPanel(markup: string): void {
  expect(markup).toContain(
    '<dl class="game-status-panel" aria-label="Progression de la partie">',
  );
  expect(markup).toContain("<dt>Manche</dt><dd>1 / 2</dd>");
  expect(markup).toContain("<dt>Tour</dt><dd>1 / 6</dd>");
  expect(markup).toContain("<dt>Dessinateur</dt>");
  expect(markup).toContain(
    '<dd class="game-status-panel__drawer" title="Camille">Camille</dd>',
  );
}

function expectSharedGamePhaseLayout(
  markup: string,
  phaseClass: string,
): void {
  const promptTextIndex = markup.indexOf('class="game-prompt-text"');
  const promptGaugeIndex = markup.indexOf(
    'class="game-prompt-header__gauge"',
  );
  const bodyIndex = markup.indexOf('class="game-phase-layout__body"');

  expect(markup).toContain(
    `class="game-card game-phase game-phase-layout ${phaseClass}"`,
  );
  expect(markup).toContain('class="game-prompt-header');
  expect(markup).toContain('<h2 class="card-label">Consigne</h2>');
  expect(markup).toContain(PROMPT_STATEMENT);
  expect(markup).toContain('class="game-phase-layout__body"');
  expect(markup).toContain('class="game-phase-layout__main');
  expect(markup).toContain('class="game-phase-layout__sidebar');
  expect(promptTextIndex).toBeGreaterThanOrEqual(0);
  expect(promptGaugeIndex).toBeGreaterThan(promptTextIndex);
  expect(bodyIndex).toBeGreaterThan(promptGaugeIndex);
  expectCompactStatusPanel(markup);
}

function expectFullScaleGaugeInPrompt(markup: string): void {
  const promptGaugeIndex = markup.indexOf(
    'class="game-prompt-header__gauge"',
  );
  const scaleGaugeIndex = markup.indexOf(
    'class="scale-gauge scale-gauge--full"',
  );
  const bodyIndex = markup.indexOf('class="game-phase-layout__body"');

  expect(scaleGaugeIndex).toBeGreaterThan(promptGaugeIndex);
  expect(scaleGaugeIndex).toBeLessThan(bodyIndex);
}

function getVotingSidebar(markup: string): string {
  const sidebarIndex = markup.indexOf(
    '<aside class="game-phase-layout__sidebar voting-sidebar">',
  );

  expect(sidebarIndex).toBeGreaterThanOrEqual(0);
  return markup.slice(sidebarIndex);
}

describe("compact game phase structure", () => {
  it("partage le shell, la consigne et le panneau de statut entre les quatre phases", () => {
    const introMarkup = renderToStaticMarkup(
      <RoundIntroScreen
        {...commonProps}
        game={createGame("ROUND_INTRO")}
        currentPlayerId={OBSERVER_ID}
        secretLevel={SECRET_LEVEL}
      />,
    );
    const drawingMarkup = renderToStaticMarkup(
      <DrawingScreen
        {...commonProps}
        game={createGame("DRAWING")}
        currentPlayerId={DRAWER_ID}
        secretLevel={SECRET_LEVEL}
        onSubmitDrawing={() => false}
      />,
    );
    const votingMarkup = renderToStaticMarkup(
      <VotingScreen
        {...commonProps}
        {...votingCallbacks}
        game={createGame("VOTING")}
        currentPlayerId={OBSERVER_ID}
        secretLevel={SECRET_LEVEL}
        guessState={createGuessState()}
      />,
    );
    const revealMarkup = renderToStaticMarkup(
      <RevealScreen
        {...commonProps}
        game={createGame("REVEAL")}
      />,
    );

    expectSharedGamePhaseLayout(introMarkup, "round-intro");
    expectSharedGamePhaseLayout(drawingMarkup, "drawing-screen");
    expectSharedGamePhaseLayout(votingMarkup, "voting-screen");
    expectSharedGamePhaseLayout(revealMarkup, "reveal-screen");
    expectFullScaleGaugeInPrompt(introMarkup);
    expectFullScaleGaugeInPrompt(drawingMarkup);
    expectFullScaleGaugeInPrompt(revealMarkup);
  });

  it("conserve le canvas, les outils et la soumission sans les grands titres redondants pendant DRAWING", () => {
    const markup = renderToStaticMarkup(
      <DrawingScreen
        {...commonProps}
        game={createGame("DRAWING")}
        currentPlayerId={DRAWER_ID}
        secretLevel={SECRET_LEVEL}
        onSubmitDrawing={() => false}
      />,
    );
    const text = getVisibleText(markup);

    expect(markup).toContain("drawing-canvas-viewport");
    expect(markup).toContain(
      'aria-label="Zone de dessin interactive au format quatre tiers"',
    );
    expect(markup).toContain('aria-label="Outils de dessin"');
    expect(text).toContain("Gomme");
    expect(text).toContain("Annuler");
    expect(text).toContain("Tout effacer");
    expect(markup).toContain("drawing-submit-button");
    expect(text).toContain("Valider le dessin");
    expect(text).toContain("Niveau à représenter : 7 / 10");
    expectFullScaleGaugeInPrompt(markup);
    expect(markup).not.toContain("phase-heading");
    expect(text).not.toContain("À vous de dessiner");
    expect(text).not.toContain("Dessin en cours");
  });

  it("place le message d'attente de DRAWING dans la sidebar sans exposer le secret", () => {
    const markup = renderToStaticMarkup(
      <DrawingScreen
        {...commonProps}
        game={createGame("DRAWING")}
        currentPlayerId={OBSERVER_ID}
        secretLevel={SECRET_LEVEL}
        onSubmitDrawing={() => false}
      />,
    );
    const text = getVisibleText(markup);

    expect(markup).toContain(
      'class="game-sidebar-card game-sidebar-card--waiting"',
    );
    expect(text).toContain("Dessin en cours Camille dessine actuellement.");
    expect(markup).not.toContain("phase-heading");
    expect(markup).not.toContain("drawing-editor");
    expectPublicGaugeWithoutSecret(markup);
  });

  it("conserve dessin, vote pleine largeur, validation et progression dans VOTING sans grand titre redondant", () => {
    const markup = renderToStaticMarkup(
      <VotingScreen
        {...commonProps}
        {...votingCallbacks}
        game={createGame("VOTING")}
        currentPlayerId={OBSERVER_ID}
        secretLevel={SECRET_LEVEL}
        guessState={createGuessState({ selected: 4 })}
      />,
    );
    const text = getVisibleText(markup);
    const promptGaugeIndex = markup.indexOf(
      'class="game-prompt-header__gauge"',
    );
    const guessScaleIndex = markup.indexOf(
      'class="scale-gauge guess-scale guess-scale--full"',
    );
    const bodyIndex = markup.indexOf('class="game-phase-layout__body"');
    const sidebar = getVotingSidebar(markup);

    expect(markup).toContain("game-media-viewport");
    expect(markup).toContain("drawing-preview-canvas");
    expect(markup).toContain("voting-sidebar");
    expect(guessScaleIndex).toBeGreaterThan(promptGaugeIndex);
    expect(guessScaleIndex).toBeLessThan(bodyIndex);
    expect(markup).toContain("guess-scale__full-control");
    expect(markup).toContain("guess-scale__full-options");
    expect(markup).toContain("guess-submit-button");
    expect(text).toContain("Valider mon estimation");
    expect(markup).toContain('class="vote-progress"');
    expect(text).toContain("1 estimation reçue sur 2");
    expect(sidebar).toContain("guess-submit-button");
    expect(sidebar).toContain('class="vote-progress"');
    expect(sidebar).not.toContain("guess-scale");
    expect(markup).not.toContain("phase-heading");
    expect(text).not.toContain("À vous d’estimer le niveau");
    expect(text).not.toContain(
      "Les autres joueurs observent votre dessin",
    );
  });
});

describe("game phase gauge confidentiality", () => {
  it("ne rend ni repère ni niveau privé pour un observateur pendant ROUND_INTRO", () => {
    const markup = renderToStaticMarkup(
      <RoundIntroScreen
        {...commonProps}
        game={createGame("ROUND_INTRO")}
        currentPlayerId={OBSERVER_ID}
        secretLevel={SECRET_LEVEL}
      />,
    );

    expectPublicGaugeWithoutSecret(markup);
    expectSharedGamePhaseLayout(markup, "round-intro");
    expectFullScaleGaugeInPrompt(markup);
    expect(markup).toContain("Camille va dessiner");
    expect(markup).toContain("Son niveau reste secret");
  });

  it("ne rend ni repère ni niveau privé pour un observateur pendant DRAWING", () => {
    const markup = renderToStaticMarkup(
      <DrawingScreen
        {...commonProps}
        game={createGame("DRAWING")}
        currentPlayerId={OBSERVER_ID}
        secretLevel={SECRET_LEVEL}
        onSubmitDrawing={() => false}
      />,
    );

    expectPublicGaugeWithoutSecret(markup);
    expectSharedGamePhaseLayout(markup, "drawing-screen");
    expectFullScaleGaugeInPrompt(markup);
    expect(markup).not.toContain("drawing-editor");
    expect(markup).toContain(
      "Le dessin apparaîtra seulement après sa validation",
    );
  });

  it("rend le repère et le texte privé pour le dessinateur avant la révélation", () => {
    const introMarkup = renderToStaticMarkup(
      <RoundIntroScreen
        {...commonProps}
        game={createGame("ROUND_INTRO")}
        currentPlayerId={DRAWER_ID}
        secretLevel={SECRET_LEVEL}
      />,
    );
    const drawingMarkup = renderToStaticMarkup(
      <DrawingScreen
        {...commonProps}
        game={createGame("DRAWING")}
        currentPlayerId={DRAWER_ID}
        secretLevel={SECRET_LEVEL}
        onSubmitDrawing={() => false}
      />,
    );
    const votingMarkup = renderToStaticMarkup(
      <VotingScreen
        {...commonProps}
        {...votingCallbacks}
        game={createGame("VOTING")}
        currentPlayerId={DRAWER_ID}
        secretLevel={SECRET_LEVEL}
        guessState={createGuessState()}
      />,
    );

    for (const markup of [introMarkup, drawingMarkup, votingMarkup]) {
      expectFullScaleGaugeInPrompt(markup);
      expect(markup).toContain('class="scale-gauge__marker"');
      expect(markup).toContain(`<strong>${SECRET_LEVEL}</strong>`);
      expect(markup).toContain("7 sur 10.");
    }
    expect(getVisibleText(introMarkup)).toContain(
      "Niveau à représenter : 7 / 10",
    );
    expect(getVisibleText(drawingMarkup)).toContain(
      "Niveau à représenter : 7 / 10",
    );
    expect(getVisibleText(votingMarkup)).toContain(
      "Votre niveau secret : 7 / 10",
    );
  });
});

describe("VotingScreen", () => {
  it("désactive la validation tant qu'aucune estimation n'est choisie", () => {
    const markup = renderToStaticMarkup(
      <VotingScreen
        {...commonProps}
        {...votingCallbacks}
        game={createGame("VOTING")}
        currentPlayerId={OBSERVER_ID}
        secretLevel={SECRET_LEVEL}
        guessState={createGuessState()}
      />,
    );

    expect(getGuessSubmitButton(markup)).toContain('disabled=""');
    expectSharedGamePhaseLayout(markup, "voting-screen");
    expect(markup).toContain(
      'class="scale-gauge guess-scale guess-scale--full"',
    );
    expect(markup).toContain("guess-scale__full-options");
    expect(markup).toContain("Valider mon estimation");
    expect(markup).not.toContain("scale-gauge__marker");
  });

  it("active la validation et matérialise uniquement le choix local", () => {
    const markup = renderToStaticMarkup(
      <VotingScreen
        {...commonProps}
        {...votingCallbacks}
        game={createGame("VOTING")}
        currentPlayerId={OBSERVER_ID}
        secretLevel={SECRET_LEVEL}
        guessState={createGuessState({ selected: 4 })}
      />,
    );
    const text = getVisibleText(markup);

    expect(getGuessSubmitButton(markup)).not.toContain("disabled");
    expect(markup).toContain('aria-label="Choisir 4 sur 10"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("scale-gauge__marker");
    expect(markup).toContain(
      'class="scale-gauge guess-scale guess-scale--full"',
    );
    expect(getVotingSidebar(markup)).toContain("guess-submit-button");
    expect(getVotingSidebar(markup)).not.toContain("guess-scale");
    expect(text).toContain("Votre estimation : 4 / 10");
  });

  it("affiche l'attente et conserve la jauge verrouillée après l'ack privé", () => {
    const markup = renderToStaticMarkup(
      <VotingScreen
        {...commonProps}
        {...votingCallbacks}
        game={createGame("VOTING")}
        currentPlayerId={OBSERVER_ID}
        secretLevel={SECRET_LEVEL}
        guessState={createGuessState({
          selected: 4,
          submitted: {
            value: 4,
            submittedAt: 1_500,
          },
        })}
      />,
    );
    const text = getVisibleText(markup);

    expect(text).toContain("Votre réponse est enregistrée");
    expect(text).toContain("Votre estimation : 4 / 10");
    expect(text).toContain("En attente des autres joueurs…");
    expect(markup).toContain(
      'class="scale-gauge guess-scale guess-scale--full guess-scale--disabled"',
    );
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain(
      'aria-label="Choisir 4 sur 10" aria-pressed="true" disabled=""',
    );
    expect(countOccurrences(markup, 'disabled=""')).toBe(10);
    expect(markup).toContain("scale-gauge__marker");
    expect(markup).not.toContain("guess-submit-button");
    expect(getVotingSidebar(markup)).not.toContain("guess-scale");
    expect(getVotingSidebar(markup)).toContain('class="vote-progress"');
  });

  it("n'expose publiquement que la progression agrégée pendant VOTING", () => {
    const markup = renderToStaticMarkup(
      <VotingScreen
        {...commonProps}
        {...votingCallbacks}
        game={createGame("VOTING")}
        currentPlayerId={OBSERVER_ID}
        secretLevel={SECRET_LEVEL}
        guessState={createGuessState()}
      />,
    );
    const text = getVisibleText(markup);

    expect(text).toContain("1 estimation reçue sur 2");
    expect(text).not.toContain("Le niveau secret était");
    expect(text).not.toContain("Élodie");
    expect(text).not.toContain("Noé");
    expect(text).not.toContain("Exact !");
    expect(text).not.toContain("Écart :");
    expect(markup).not.toContain("reveal-result-list");
    expect(markup).not.toContain("Niveau secret actuel");
  });

  it("ne présente aucun contrôle d'estimation au dessinateur et lui garde son secret", () => {
    const markup = renderToStaticMarkup(
      <VotingScreen
        {...commonProps}
        {...votingCallbacks}
        game={createGame("VOTING")}
        currentPlayerId={DRAWER_ID}
        secretLevel={SECRET_LEVEL}
        guessState={createGuessState()}
      />,
    );
    const text = getVisibleText(markup);

    expect(markup).toContain('class="scale-gauge__marker"');
    expectFullScaleGaugeInPrompt(markup);
    expect(markup).toContain(`<strong>${SECRET_LEVEL}</strong>`);
    expect(markup).not.toContain("guess-scale");
    expect(markup).not.toContain("guess-submit-button");
    expect(markup).not.toContain('aria-label="Choisir ');
    expect(text).toContain(
      "Les autres joueurs essaient de deviner votre niveau.",
    );
    expect(text).toContain("1 estimation reçue sur 2");
    expect(getVotingSidebar(markup)).toContain("voting-wait-state");
    expect(getVotingSidebar(markup)).toContain('class="vote-progress"');
  });
});

describe("RevealScreen", () => {
  it("révèle le secret et toutes les estimations dans l'ordre stable du salon", () => {
    const markup = renderToStaticMarkup(
      <RevealScreen
        {...commonProps}
        game={createGame("REVEAL")}
      />,
    );
    const text = getVisibleText(markup);

    expect(text).toContain("Le niveau secret était 7 / 10");
    expectSharedGamePhaseLayout(markup, "reveal-screen");
    expectFullScaleGaugeInPrompt(markup);
    expect(countOccurrences(markup, "scale-gauge--full")).toBe(1);
    expect(markup).toContain("drawing-preview-canvas");
    expect(markup).toContain('class="scale-gauge__marker"');
    expect(markup).toContain("<strong>7</strong>");
    expect(text).toContain("Élodie 7 / 10 Exact !");
    expect(text).toContain("Noé 4 / 10 Écart : 3");
    expect(markup.indexOf("Élodie")).toBeLessThan(markup.indexOf("Noé"));
  });

  it("reste une révélation terminale sans score ni action de tour suivant", () => {
    const markup = renderToStaticMarkup(
      <RevealScreen
        {...commonProps}
        game={createGame("REVEAL")}
      />,
    );
    const normalizedMarkup = markup.toLocaleLowerCase("fr");

    expect(normalizedMarkup).not.toContain("score");
    expect(normalizedMarkup).not.toContain("point");
    expect(normalizedMarkup).not.toContain("continuer");
    expect(markup).not.toContain("Prochain tour");
    expect(markup).toContain("Quitter la partie");
  });
});
