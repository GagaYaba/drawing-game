import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GuessScale } from "../../client/src/components/scale/GuessScale.js";

const LOW_LABEL = "Très discret";
const HIGH_LABEL = "Très spectaculaire";

interface TestElementProps {
  children?: ReactNode;
  [key: string]: unknown;
}

function renderGuessScale(
  props: Partial<React.ComponentProps<typeof GuessScale>> = {},
): string {
  return renderToStaticMarkup(
    <GuessScale
      lowLabel={LOW_LABEL}
      highLabel={HIGH_LABEL}
      value={null}
      onChange={() => undefined}
      {...props}
    />,
  );
}

function findElements(
  node: ReactNode,
  predicate: (element: ReactElement<TestElementProps>) => boolean,
): ReactElement<TestElementProps>[] {
  const matches: ReactElement<TestElementProps>[] = [];

  Children.forEach(node, (child) => {
    if (!isValidElement<TestElementProps>(child)) {
      return;
    }

    if (predicate(child)) {
      matches.push(child);
    }

    matches.push(...findElements(child.props.children, predicate));
  });

  return matches;
}

function getOption(
  tree: ReactNode,
  level: number,
): ReactElement<TestElementProps> | undefined {
  return findElements(
    tree,
    (element) =>
      element.type === "button" &&
      element.props["aria-label"] === `Choisir ${level} sur 10`,
  )[0];
}

function countOccurrences(source: string, fragment: string): number {
  return source.split(fragment).length - 1;
}

describe("GuessScale markup", () => {
  it("rend dix boutons natifs accessibles et les deux extrémités", () => {
    const markup = renderGuessScale();

    expect(markup).toContain(
      'class="scale-gauge guess-scale guess-scale--full"',
    );
    expect(markup).toContain("guess-scale__full-control");
    expect(markup).toContain("guess-scale__full-options");
    expect(countOccurrences(markup, '<button class="scale-gauge__segment guess-scale__option" type="button"')).toBe(
      10,
    );
    expect(markup).toContain(LOW_LABEL);
    expect(markup).toContain(HIGH_LABEL);
    expect(markup).toContain(
      'src="/mascots/poop/neutral.png" alt="" aria-hidden="true"',
    );
    expect(markup).toContain(
      'src="/mascots/pig/neutral.png" alt="" aria-hidden="true"',
    );

    for (let level = 1; level <= 10; level += 1) {
      expect(markup).toContain(`aria-label="Choisir ${level} sur 10"`);
    }
  });

  it("expose un groupe accessible personnalisable", () => {
    const markup = renderGuessScale({
      ariaLabel: "Estimation du niveau du dessin",
    });

    expect(markup).toContain('role="group"');
    expect(markup).toContain(
      'aria-label="Estimation du niveau du dessin"',
    );
    expect(markup).toContain('aria-disabled="false"');
  });

  it("ne rend aucun repère ni texte lorsqu’aucune valeur n’est choisie", () => {
    const markup = renderGuessScale();

    expect(markup).not.toContain("scale-gauge__marker");
    expect(markup).not.toContain("guess-scale__value-text");
    expect(markup).not.toContain("--scale-gauge-marker-position");
    expect(countOccurrences(markup, 'aria-pressed="false"')).toBe(10);
    expect(markup).not.toContain("Votre estimation");
  });

  it.each([
    [1, "5%"],
    [5, "45%"],
    [10, "95%"],
  ])(
    "sélectionne %i, place son repère à %s et affiche sa valeur",
    (value, expectedPosition) => {
      const markup = renderGuessScale({ value });

      expect(markup).toContain('class="scale-gauge__marker"');
      expect(markup).toContain(
        `style="--scale-gauge-marker-position:${expectedPosition}"`,
      );
      expect(countOccurrences(markup, 'aria-pressed="true"')).toBe(1);
      expect(markup).toContain(
        `aria-label="Choisir ${value} sur 10" aria-pressed="true"`,
      );
      expect(markup).toContain("<span>Votre estimation :</span>");
      expect(markup).toContain(`<strong>${value}</strong>`);
      expect(markup).toContain("<span>/ 10</span>");
      expect(markup).toContain('role="status"');
      expect(markup).toContain('aria-live="polite"');
    },
  );

  it("désactive explicitement le groupe et ses dix boutons", () => {
    const markup = renderGuessScale({ disabled: true, value: 7 });

    expect(markup).toContain("guess-scale--disabled");
    expect(markup).toContain('aria-disabled="true"');
    expect(countOccurrences(markup, 'disabled=""')).toBe(10);
    expect(markup).toContain("<strong>7</strong>");
  });

  it("permet d'externaliser le texte de valeur sans perdre le repère sélectionné", () => {
    const markup = renderGuessScale({
      value: 6,
      showValueText: false,
      valueTextLabel: "Choix privé",
    });

    expect(markup).toContain("guess-scale--full");
    expect(markup).toContain('class="scale-gauge__marker"');
    expect(markup).toContain(
      'aria-label="Choisir 6 sur 10" aria-pressed="true"',
    );
    expect(markup).not.toContain("guess-scale__value-text");
    expect(markup).not.toContain("Choix privé");
  });

  it("propose une variante compacte sans perdre les dix choix ni la valeur sélectionnée", () => {
    const markup = renderGuessScale({ size: "compact", value: 6 });

    expect(markup).toContain(
      'class="scale-gauge guess-scale guess-scale--compact"',
    );
    expect(markup).toContain('class="guess-scale__option-grid"');
    expect(markup).toContain(
      'class="scale-gauge__track guess-scale__visual-track"',
    );
    expect(
      countOccurrences(
        markup,
        '<button class="scale-gauge__segment guess-scale__option" type="button"',
      ),
    ).toBe(10);
    expect(countOccurrences(markup, 'aria-pressed="true"')).toBe(1);
    expect(markup).toContain(
      'aria-label="Choisir 6 sur 10" aria-pressed="true"',
    );
    expect(markup).toContain(
      'style="--scale-gauge-marker-position:55',
    );
    expect(markup).toContain("<span>Votre estimation :</span>");
    expect(markup).toContain("<strong>6</strong>");
  });
});

describe("GuessScale interactions", () => {
  it("appelle onChange pour chacune des dix valeurs", () => {
    const onChange = vi.fn();
    const tree = GuessScale({
      lowLabel: LOW_LABEL,
      highLabel: HIGH_LABEL,
      value: null,
      onChange,
    });

    for (let level = 1; level <= 10; level += 1) {
      const onClick = getOption(tree, level)?.props.onClick;

      expect(onClick).toBeTypeOf("function");
      if (typeof onClick === "function") {
        onClick();
      }
    }

    expect(onChange).toHaveBeenCalledTimes(10);
    for (let level = 1; level <= 10; level += 1) {
      expect(onChange).toHaveBeenNthCalledWith(level, level);
    }
  });

  it("n’appelle jamais onChange lorsque la jauge est désactivée", () => {
    const onChange = vi.fn();
    const tree = GuessScale({
      lowLabel: LOW_LABEL,
      highLabel: HIGH_LABEL,
      value: 5,
      onChange,
      disabled: true,
    });

    for (let level = 1; level <= 10; level += 1) {
      const option = getOption(tree, level);
      const onClick = option?.props.onClick;

      expect(option?.props.disabled).toBe(true);
      if (typeof onClick === "function") {
        onClick();
      }
    }

    expect(onChange).not.toHaveBeenCalled();
  });
});
