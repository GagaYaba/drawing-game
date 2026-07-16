import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ScaleGauge } from "../../client/src/components/scale/ScaleGauge.js";
import {
  getScaleGaugeMarkerPosition,
  isScaleGaugeValue,
} from "../../client/src/components/scale/scale-gauge.js";

const LOW_LABEL = "Moins puissante";
const HIGH_LABEL = "Plus puissante";

function renderGauge(
  props: Partial<React.ComponentProps<typeof ScaleGauge>> = {},
): string {
  return renderToStaticMarkup(
    <ScaleGauge
      lowLabel={LOW_LABEL}
      highLabel={HIGH_LABEL}
      {...props}
    />,
  );
}

function countOccurrences(source: string, fragment: string): number {
  return source.split(fragment).length - 1;
}

describe("ScaleGauge calculations", () => {
  it.each([
    [1, 5],
    [5, 45],
    [10, 95],
  ])("centre le repère du niveau %i à %i %%", (value, expectedPosition) => {
    expect(getScaleGaugeMarkerPosition(value)).toBe(expectedPosition);
  });

  it.each([null, undefined, 0, 11, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuse la valeur invalide %s",
    (value) => {
      expect(isScaleGaugeValue(value)).toBe(false);
      expect(getScaleGaugeMarkerPosition(value)).toBeNull();
    },
  );
});

describe("ScaleGauge markup", () => {
  it("utilise la variante pleine largeur par défaut et conserve la variante compacte", () => {
    expect(renderGauge()).toContain(
      'class="scale-gauge scale-gauge--full"',
    );
    expect(renderGauge({ size: "compact" })).toContain(
      'class="scale-gauge scale-gauge--compact"',
    );
  });

  it("rend dix segments et les dix graduations", () => {
    const markup = renderGauge();

    expect(countOccurrences(markup, 'class="scale-gauge__segment"')).toBe(10);
    for (let level = 1; level <= 10; level += 1) {
      expect(markup).toContain(`<li>${level}</li>`);
    }
  });

  it("affiche les deux libellés d’extrémité et une description accessible", () => {
    const markup = renderGauge();

    expect(markup).toContain(LOW_LABEL);
    expect(markup).toContain(HIGH_LABEL);
    expect(markup).toContain(
      `aria-label="Échelle de ${LOW_LABEL}, niveau 1, à ${HIGH_LABEL}, niveau 10. Le niveau est secret."`,
    );
  });

  it("n’affiche aucun repère ni texte secret sans valeur", () => {
    const markup = renderGauge({ showValueText: true });

    expect(markup).not.toContain("scale-gauge__marker");
    expect(markup).not.toContain("scale-gauge__value-text");
    expect(markup).not.toContain("Niveau secret :");
  });

  it.each([
    [1, "5%"],
    [5, "45%"],
    [10, "95%"],
  ])(
    "affiche le repère du niveau %i au centre attendu",
    (value, expectedPosition) => {
      const markup = renderGauge({ value });

      expect(markup).toContain('class="scale-gauge__marker"');
      expect(markup).toContain(
        `style="--scale-gauge-marker-position:${expectedPosition}"`,
      );
    },
  );

  it.each([0, 11, 2.5, Number.NaN])(
    "ne rend aucun repère pour la valeur invalide %s",
    (value) => {
      const markup = renderGauge({ value, showValueText: true });

      expect(markup).not.toContain("scale-gauge__marker");
      expect(markup).not.toContain("scale-gauge__value-text");
      expect(markup).not.toContain("--scale-gauge-marker-position");
    },
  );

  it("affiche le niveau secret en texte lorsque demandé", () => {
    const markup = renderGauge({ value: 7, showValueText: true });

    expect(markup).toContain('class="scale-gauge__value-text"');
    expect(markup).toContain("<span>Niveau secret :</span>");
    expect(markup).toContain("<strong>7</strong>");
    expect(markup).toContain("<span>/ 10</span>");
    expect(markup).toContain("Niveau secret actuel : 7 sur 10.");
  });

  it("permet de personnaliser le libellé textuel de la valeur", () => {
    const markup = renderGauge({
      value: 7,
      showValueText: true,
      valueTextLabel: "Niveau à représenter",
    });

    expect(markup).toContain("<span>Niveau à représenter :</span>");
    expect(markup).toContain("Niveau à représenter : 7 sur 10.");
    expect(markup).not.toContain("<span>Niveau secret :</span>");
  });

  it("garde le texte secret masqué quand son affichage n’est pas demandé", () => {
    const markup = renderGauge({ value: 7 });

    expect(markup).toContain('class="scale-gauge__marker"');
    expect(markup).not.toContain("scale-gauge__value-text");
    expect(markup).not.toContain("<span>Niveau secret :</span>");
  });
});
