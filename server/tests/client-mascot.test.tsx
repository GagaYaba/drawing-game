import { existsSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HomeScreen } from "../../client/src/components/HomeScreen.js";
import {
  getMascotSource,
  Mascot,
  type MascotCharacter,
  type MascotExpression,
} from "../../client/src/components/Mascot.js";

const characters: readonly MascotCharacter[] = ["pig", "poop"];
const expressions: readonly MascotExpression[] = [
  "neutral",
  "angry",
  "sad",
  "happy",
  "surprised",
  "confused",
  "jump",
  "hide",
  "dance",
  "formal",
  "fly",
];

describe("Mascot", () => {
  it.each(
    characters.flatMap((character) =>
      expressions.map((expression) => [character, expression] as const),
    ),
  )(
    "associe %s/%s à un sprite présent",
    (character, expression) => {
      const source = getMascotSource(character, expression);
      const publicPath = new URL(
        `../../client/public${source}`,
        import.meta.url,
      );

      expect(existsSync(publicPath)).toBe(true);
      expect(
        renderToStaticMarkup(
          <Mascot
            character={character}
            expression={expression}
            decorative
          />,
        ),
      ).toContain(`src="${source}"`);
    },
  );

  it("adapte l’expression hide au nom de fichier hidden livré", () => {
    expect(getMascotSource("pig", "hide")).toBe(
      "/mascots/pig/hidden.png",
    );
    expect(getMascotSource("poop", "hide")).toBe(
      "/mascots/poop/hidden.png",
    );
  });

  it("distingue une illustration décorative d’un état informatif", () => {
    const decorative = renderToStaticMarkup(
      <Mascot
        character="pig"
        expression="neutral"
        decorative
      />,
    );
    const informative = renderToStaticMarkup(
      <Mascot
        character="poop"
        expression="sad"
        alt="La mascotte est triste après ce résultat."
      />,
    );

    expect(decorative).toContain('alt=""');
    expect(decorative).toContain('aria-hidden="true"');
    expect(informative).toContain(
      'alt="La mascotte est triste après ce résultat."',
    );
    expect(informative).not.toContain("aria-hidden");
  });
});

describe("HomeScreen mascots", () => {
  it("conserve le formulaire central entre les deux mascottes décoratives", () => {
    const markup = renderToStaticMarkup(
      <HomeScreen
        nickname="Camille"
        roomCode=""
        pendingAction={null}
        errorMessage={null}
        onNicknameChange={() => undefined}
        onRoomCodeChange={() => undefined}
        onCreateRoom={() => undefined}
        onJoinRoom={() => undefined}
      />,
    );
    const poopIndex = markup.lastIndexOf("/mascots/poop/neutral.png");
    const formIndex = markup.indexOf('class="game-card welcome-card"');
    const pigIndex = markup.lastIndexOf("/mascots/pig/neutral.png");

    expect(markup).toContain('class="home-table-layout"');
    expect(poopIndex).toBeGreaterThanOrEqual(0);
    expect(formIndex).toBeGreaterThan(poopIndex);
    expect(pigIndex).toBeGreaterThan(formIndex);
    expect(markup.match(/alt=""/g)).toHaveLength(2);
    expect(markup).toContain("Rejoignez la table de jeu");
  });

  it("associe une erreur visible à une mascotte sans retirer son texte", () => {
    const markup = renderToStaticMarkup(
      <HomeScreen
        nickname="Camille"
        roomCode="ABCDE"
        pendingAction={null}
        errorMessage="Impossible de rejoindre ce salon."
        onNicknameChange={() => undefined}
        onRoomCodeChange={() => undefined}
        onCreateRoom={() => undefined}
        onJoinRoom={() => undefined}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Impossible de rejoindre ce salon.");
    expect(markup).toContain("/mascots/poop/angry.png");
  });
});
