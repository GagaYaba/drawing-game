import {
  DRAWING_ASPECT_RATIO,
  DRAWING_BACKGROUND_COLOR,
  DRAWING_DOCUMENT_VERSION,
  type PublicGameState,
} from "@drawing-game/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DrawingScreen } from "../../client/src/components/DrawingScreen.js";
import { RoundIntroScreen } from "../../client/src/components/RoundIntroScreen.js";
import { VotingScreen } from "../../client/src/components/VotingScreen.js";

const DRAWER_ID = "drawer-id";
const OBSERVER_ID = "observer-id";
const SECRET_LEVEL = 7;

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
      statement:
        "Représente un dragon du plus puissant (10) au moins puissant (1).",
      lowLabel: "Moins puissant",
      highLabel: "Plus puissant",
    },
    phaseEndsAt: phase === "ROUND_INTRO" ? null : null,
    submittedDrawing:
      phase === "VOTING"
        ? {
            submittedAt: 1_000,
            document: {
              version: DRAWING_DOCUMENT_VERSION,
              aspectRatio: DRAWING_ASPECT_RATIO,
              backgroundColor: DRAWING_BACKGROUND_COLOR,
              strokes: [],
            },
          }
        : null,
  };
}

const commonProps = {
  pendingAction: null,
  errorMessage: null,
  onLeaveRoom: () => undefined,
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
    expect(markup).not.toContain("drawing-editor");
    expect(markup).toContain("Le dessin apparaîtra seulement après sa validation");
  });

  it("ne rend ni contrôle, ni repère, ni niveau privé pour un observateur pendant VOTING", () => {
    const markup = renderToStaticMarkup(
      <VotingScreen
        {...commonProps}
        game={createGame("VOTING")}
        currentPlayerId={OBSERVER_ID}
        secretLevel={SECRET_LEVEL}
      />,
    );

    expectPublicGaugeWithoutSecret(markup);
    expect(markup).toContain("Aucun contrôle de vote n’est encore disponible");
    expect(markup).not.toContain("input");
    expect(markup).not.toContain("slider");
  });

  it("rend le repère et le texte privé pour le dessinateur dans les trois phases", () => {
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
        game={createGame("VOTING")}
        currentPlayerId={DRAWER_ID}
        secretLevel={SECRET_LEVEL}
      />,
    );

    for (const markup of [introMarkup, drawingMarkup, votingMarkup]) {
      expect(markup).toContain('class="scale-gauge__marker"');
      expect(markup).toContain(`<strong>${SECRET_LEVEL}</strong>`);
      expect(markup).toContain("7 sur 10.");
    }
    expect(introMarkup).toContain("Niveau secret actuel : 7 sur 10.");
    expect(drawingMarkup).toContain("Niveau à représenter : 7 sur 10.");
    expect(votingMarkup).toContain("Niveau secret actuel : 7 sur 10.");
  });
});
