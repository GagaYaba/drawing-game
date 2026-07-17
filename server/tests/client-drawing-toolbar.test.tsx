import {
  DRAWING_COLOR_PALETTE,
  type DrawingColor,
  type DrawingStrokeWidth,
  type DrawingTool,
} from "@drawing-game/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DrawingToolbar } from "../../client/src/components/drawing/DrawingToolbar.js";

interface RenderToolbarOptions {
  selectedTool?: DrawingTool;
  selectedColor?: DrawingColor;
  selectedWidth?: DrawingStrokeWidth;
  canUndo?: boolean;
  disabled?: boolean;
}

function renderToolbar(options: RenderToolbarOptions = {}): string {
  return renderToStaticMarkup(
    <DrawingToolbar
      selectedTool={options.selectedTool ?? "pen"}
      selectedColor={options.selectedColor ?? DRAWING_COLOR_PALETTE[0]}
      selectedWidth={options.selectedWidth ?? 8}
      canUndo={options.canUndo ?? true}
      disabled={options.disabled ?? false}
      onToolChange={vi.fn()}
      onColorChange={vi.fn()}
      onWidthChange={vi.fn()}
      onUndo={vi.fn()}
      onClear={vi.fn()}
    />,
  );
}

function countOccurrences(source: string, fragment: string): number {
  return source.split(fragment).length - 1;
}

describe("DrawingToolbar", () => {
  it("affiche les trois outils sous forme de boutons icônes accessibles", () => {
    const markup = renderToolbar();

    for (const label of ["Stylo", "Gomme", "Pot de peinture"]) {
      expect(markup).toContain(`aria-label="${label}"`);
      expect(markup).toContain(`title="${label}"`);
    }
    for (const icon of ["pen", "eraser", "fill", "undo", "trash"]) {
      expect(markup).toContain(`data-drawing-icon="${icon}"`);
    }
    expect(markup).not.toContain(">Stylo</button>");
    expect(markup).not.toContain(">Gomme</button>");
    expect(markup).toContain('aria-label="Annuler"');
    expect(markup).toContain('aria-label="Tout effacer"');
  });

  it("présente les seize couleurs avec leur nom accessible", () => {
    const markup = renderToolbar({ selectedColor: "#FFFFFF" });

    expect(DRAWING_COLOR_PALETTE).toHaveLength(16);
    expect(countOccurrences(markup, 'class="color-button')).toBe(16);
    expect(markup).toContain('aria-label="Couleur Noir"');
    expect(markup).toContain('aria-label="Couleur Blanc"');
    expect(markup).toContain('aria-label="Couleur Jaune"');
    expect(markup).toContain('aria-label="Couleur Turquoise"');
    expect(markup).toContain('aria-label="Couleur Violet"');
    expect(markup).toContain(
      'class="color-button color-button--light" style="--swatch-color:#FFFFFF" type="button" aria-label="Couleur Blanc" aria-pressed="true"',
    );
  });

  it("matérialise le pot sélectionné et rend la taille non pertinente", () => {
    const markup = renderToolbar({ selectedTool: "fill" });
    const fillButton = markup.match(
      /<button[^>]*aria-label="Pot de peinture"[^>]*>/,
    );

    expect(fillButton?.[0]).toContain('aria-pressed="true"');
    expect(markup).toContain(
      'class="toolbar-group toolbar-group--widths" aria-disabled="true"',
    );
    expect(countOccurrences(markup, 'class="tool-button" type="button"')).toBe(
      3,
    );
    expect(markup).toContain(
      "Outil : pot de peinture. Couleur : Noir.",
    );
    expect(markup).not.toContain("Taille : Moyen.");
  });

  it("désactive toutes les commandes lorsque l'éditeur est bloqué", () => {
    const markup = renderToolbar({ disabled: true });

    expect(countOccurrences(markup, 'disabled=""')).toBe(
      3 + DRAWING_COLOR_PALETTE.length + 3 + 2,
    );
  });
});
