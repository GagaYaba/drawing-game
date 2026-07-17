import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PublicGameState } from "@drawing-game/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DrawingScreen } from "../../client/src/components/DrawingScreen.js";
import {
  GuessConfirmationDialog,
} from "../../client/src/components/VotingScreen.js";
import { GameDialog } from "../../client/src/components/ui/GameDialog.js";

const CLIENT_SOURCE_DIRECTORY = fileURLToPath(
  new URL("../../client/src/", import.meta.url),
);
const DIALOG_STYLES = readFileSync(
  new URL(
    "../../client/src/components/ui/GameDialog.css",
    import.meta.url,
  ),
  "utf8",
);
const DRAWING_SCREEN_STYLES = readFileSync(
  new URL(
    "../../client/src/components/DrawingScreen.css",
    import.meta.url,
  ),
  "utf8",
);

function getClientTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(
    (entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        return getClientTypeScriptFiles(path);
      }

      return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : [];
    },
  );
}

function createDrawingGame(): PublicGameState {
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
      nickname: "Camille",
    },
    prompt: {
      id: "prompt-1",
      statement: "Dessinez un dragon du plus calme au plus féroce.",
      lowLabel: "Très calme",
      highLabel: "Très féroce",
    },
    phaseEndsAt: null,
    submittedDrawing: null,
    voting: null,
    reveal: null,
    finished: null,
  };
}

describe("GameDialog", () => {
  it("ne rend rien lorsqu'il est fermé", () => {
    const markup = renderToStaticMarkup(
      <GameDialog
        open={false}
        title="Dialogue fermé"
        description="Ce contenu ne doit pas être rendu."
        confirmLabel="Confirmer"
        cancelLabel="Annuler"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(markup).toBe("");
  });

  it("relie son titre et sa description à une modale accessible", () => {
    const markup = renderToStaticMarkup(
      <GameDialog
        open
        title="Valider le dessin ?"
        description="Cette action est définitive."
        confirmLabel="Valider mon dessin"
        cancelLabel="Continuer à dessiner"
        value={<span>8 / 10</span>}
        mascot={{ character: "pig", expression: "neutral" }}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const labelledBy = markup.match(/aria-labelledby="([^"]+)"/u)?.[1];
    const describedBy = markup.match(
      /aria-describedby="([^"]+)"/u,
    )?.[1]?.split(" ");

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-busy="false"');
    expect(labelledBy).toBeDefined();
    expect(describedBy).toBeDefined();
    expect(markup).toContain(`id="${labelledBy}"`);
    expect(describedBy).toHaveLength(2);
    for (const describedById of describedBy ?? []) {
      expect(markup).toContain(`id="${describedById}"`);
    }
    expect(markup).toContain("Valider le dessin ?");
    expect(markup).toContain("Cette action est définitive.");
    expect(markup).toContain("Valider mon dessin");
    expect(markup).toContain("Continuer à dessiner");
    expect(markup).toContain("8 / 10");
    expect(markup).toContain(
      'data-character="pig" data-expression="neutral"',
    );
  });

  it("reste sous l'overlay de reconnexion et conserve un focus visible", () => {
    expect(DIALOG_STYLES).toMatch(
      /\.game-dialog-overlay\s*\{[\s\S]*?z-index:\s*900;/u,
    );
    expect(DIALOG_STYLES).toMatch(
      /\.game-dialog-card \.button:focus-visible\s*\{[\s\S]*?outline:/u,
    );
    expect(DIALOG_STYLES).toMatch(
      /@media \(max-width: 520px\)[\s\S]*?\.game-dialog__actions\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/u,
    );
  });
});

describe("confirmation de l'estimation", () => {
  it("affiche la valeur mémorisée et les deux choix du jeu", () => {
    const markup = renderToStaticMarkup(
      <GuessConfirmationDialog
        value={8}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(markup).toContain("Valider votre estimation ?");
    expect(markup).toContain(
      "Votre estimation sera envoyée définitivement pour ce tour",
    );
    expect(markup).toContain(
      'aria-label="Estimation choisie : 8 sur 10"',
    );
    expect(markup).toContain("8 / 10");
    expect(markup).toContain("Valider mon estimation");
    expect(markup).toContain("Modifier mon choix");
    expect(markup).toContain(
      'data-character="poop" data-expression="confused"',
    );
  });

  it("ne conserve aucun dialogue natif dans le code client", () => {
    const violations = getClientTypeScriptFiles(
      CLIENT_SOURCE_DIRECTORY,
    ).filter((path) =>
      /\b(?:window\.)?confirm\s*\(/u.test(readFileSync(path, "utf8")),
    );

    expect(violations).toEqual([]);
  });
});

describe("attente du dessin", () => {
  it("affiche la mascotte volante et le message dans la surface centrale", () => {
    const markup = renderToStaticMarkup(
      <DrawingScreen
        game={createDrawingGame()}
        currentPlayerId="observer-id"
        secretLevel={null}
        pendingAction={null}
        errorMessage={null}
        onSubmitDrawing={() => false}
        onLeaveRoom={() => undefined}
      />,
    );

    expect(markup).toContain(
      "game-phase-layout__main game-media-viewport drawing-observer-viewport",
    );
    expect(markup).toContain('class="drawing-observer-stage"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('src="/mascots/poop/fly.png"');
    expect(markup).toContain(
      'data-character="poop" data-expression="fly"',
    );
    expect(markup).toContain(
      "Le dessin apparaîtra ici après sa validation.",
    );
    expect(markup).toContain(
      'class="visually-hidden">Niveau à représenter : secret</span>',
    );
    expect(markup).toContain(
      "scale-gauge__track-wrap--with-marker",
    );
    expect(markup).not.toContain("drawing-observer-stage__icon");
  });

  it("utilise un fond blanc harmonisé et neutralise le vol en mouvement réduit", () => {
    expect(DRAWING_SCREEN_STYLES).toMatch(
      /\.drawing-screen \.drawing-observer-stage\s*\{[\s\S]*?aspect-ratio:\s*4\s*\/\s*3;[\s\S]*?overflow:\s*hidden;[\s\S]*?background:\s*#fff;/u,
    );
    expect(DRAWING_SCREEN_STYLES).toMatch(
      /\.drawing-observer-stage__content\s*\{[\s\S]*?place-items:\s*center;/u,
    );
    expect(DRAWING_SCREEN_STYLES).toMatch(
      /\.drawing-screen \.drawing-observer-stage__mascot\s*\{[\s\S]*?animation:\s*drawing-observer-fly/u,
    );
    expect(DRAWING_SCREEN_STYLES).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.drawing-screen \.drawing-observer-stage__mascot\s*\{[\s\S]*?animation:\s*none !important;[\s\S]*?transform:\s*none !important;/u,
    );
  });
});
