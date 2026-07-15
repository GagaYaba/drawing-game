import type { CSSProperties } from "react";

import {
  DRAWING_ALLOWED_STROKE_WIDTHS,
  DRAWING_COLOR_PALETTE,
  type DrawingColor,
  type DrawingStrokeWidth,
  type DrawingTool,
} from "@drawing-game/shared";

const COLOR_LABELS: Record<DrawingColor, string> = {
  "#111111": "Noir",
  "#E53935": "Rouge",
  "#1E88E5": "Bleu",
  "#43A047": "Vert",
  "#FB8C00": "Orange",
  "#8E24AA": "Violet",
};

const WIDTH_LABELS: Record<DrawingStrokeWidth, string> = {
  4: "Fin",
  8: "Moyen",
  14: "Épais",
};

interface DrawingToolbarProps {
  selectedTool: DrawingTool;
  selectedColor: DrawingColor;
  selectedWidth: DrawingStrokeWidth;
  canUndo: boolean;
  disabled: boolean;
  onToolChange: (tool: DrawingTool) => void;
  onColorChange: (color: DrawingColor) => void;
  onWidthChange: (width: DrawingStrokeWidth) => void;
  onUndo: () => void;
  onClear: () => void;
}

export function DrawingToolbar({
  selectedTool,
  selectedColor,
  selectedWidth,
  canUndo,
  disabled,
  onToolChange,
  onColorChange,
  onWidthChange,
  onUndo,
  onClear,
}: DrawingToolbarProps) {
  return (
    <div className="drawing-toolbar" aria-label="Outils de dessin">
      <fieldset className="toolbar-group">
        <legend>Outil</legend>
        <div className="toolbar-options">
          <button
            className="tool-button"
            type="button"
            aria-pressed={selectedTool === "pen"}
            disabled={disabled}
            onClick={() => onToolChange("pen")}
          >
            Stylo
          </button>
          <button
            className="tool-button"
            type="button"
            aria-pressed={selectedTool === "eraser"}
            disabled={disabled}
            onClick={() => onToolChange("eraser")}
          >
            Gomme
          </button>
        </div>
      </fieldset>

      <fieldset className="toolbar-group toolbar-group--colors">
        <legend>Couleur</legend>
        <div className="toolbar-options toolbar-color-options">
          {DRAWING_COLOR_PALETTE.map((color) => {
            const isSelected = selectedColor === color;
            const style = { "--swatch-color": color } as CSSProperties;

            return (
              <button
                key={color}
                className="color-button"
                style={style}
                type="button"
                aria-label={`Couleur ${COLOR_LABELS[color]}`}
                aria-pressed={isSelected}
                disabled={disabled}
                onClick={() => onColorChange(color)}
              >
                <span className="color-swatch" aria-hidden="true" />
                <span className="color-selection-mark" aria-hidden="true">
                  {isSelected ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="toolbar-group">
        <legend>Taille</legend>
        <div className="toolbar-options">
          {DRAWING_ALLOWED_STROKE_WIDTHS.map((width) => (
            <button
              key={width}
              className="tool-button"
              type="button"
              aria-pressed={selectedWidth === width}
              disabled={disabled}
              onClick={() => onWidthChange(width)}
            >
              {WIDTH_LABELS[width]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="toolbar-history-actions">
        <button
          className="tool-button"
          type="button"
          disabled={disabled || !canUndo}
          onClick={onUndo}
        >
          Annuler
        </button>
        <button
          className="tool-button tool-button--danger"
          type="button"
          disabled={disabled || !canUndo}
          onClick={onClear}
        >
          Tout effacer
        </button>
      </div>

      <p className="toolbar-selection" aria-live="polite">
        Outil : {selectedTool === "pen" ? "stylo" : "gomme"}. Couleur :{" "}
        {COLOR_LABELS[selectedColor]}. Taille : {WIDTH_LABELS[selectedWidth]}.
      </p>
    </div>
  );
}
