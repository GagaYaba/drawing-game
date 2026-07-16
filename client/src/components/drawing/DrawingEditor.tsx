import { useEffect, useMemo, useRef, useState } from "react";

import {
  DRAWING_COLOR_PALETTE,
  DRAWING_MAX_STROKES,
  DRAWING_MAX_TOTAL_POINTS,
  type DrawingColor,
  type DrawingDocument,
  type DrawingStroke,
  type DrawingStrokeWidth,
  type DrawingTool,
} from "@drawing-game/shared";

import {
  countDrawingPoints,
  createDrawingDocument,
  removeLastStroke,
} from "./drawing-document";
import { DrawingCanvas } from "./DrawingCanvas";
import { DrawingToolbar } from "./DrawingToolbar";

interface DrawingEditorProps {
  disabled: boolean;
  isSubmitting: boolean;
  onSubmit: (drawing: DrawingDocument) => boolean;
}

const DEFAULT_TOOL: DrawingTool = "pen";
const DEFAULT_COLOR: DrawingColor = DRAWING_COLOR_PALETTE[0];
const DEFAULT_WIDTH: DrawingStrokeWidth = 8;

export function DrawingEditor({
  disabled,
  isSubmitting,
  onSubmit,
}: DrawingEditorProps) {
  const [strokes, setStrokes] = useState<DrawingStroke[]>([]);
  const [selectedTool, setSelectedTool] = useState<DrawingTool>(DEFAULT_TOOL);
  const [selectedColor, setSelectedColor] =
    useState<DrawingColor>(DEFAULT_COLOR);
  const [selectedWidth, setSelectedWidth] =
    useState<DrawingStrokeWidth>(DEFAULT_WIDTH);
  const [isStrokeActive, setIsStrokeActive] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const submissionRequestedRef = useRef(false);

  useEffect(() => {
    if (!isSubmitting) {
      submissionRequestedRef.current = false;
    }
  }, [isSubmitting]);

  const totalPointCount = useMemo(
    () => countDrawingPoints(strokes),
    [strokes],
  );
  const remainingPointCapacity = Math.max(
    0,
    DRAWING_MAX_TOTAL_POINTS - totalPointCount,
  );
  const canStartStroke =
    strokes.length < DRAWING_MAX_STROKES && remainingPointCapacity > 0;
  const editorIsDisabled = disabled || !canStartStroke;

  const handleStrokeComplete = (stroke: DrawingStroke) => {
    setStrokes((currentStrokes) => [...currentStrokes, stroke]);
    setLimitMessage(null);
  };

  const handleLimitReached = () => {
    setLimitMessage(
      "La limite de complexité du dessin est atteinte. Annulez un trait pour continuer.",
    );
  };

  const handleUndo = () => {
    setStrokes((currentStrokes) => removeLastStroke(currentStrokes));
    setLimitMessage(null);
  };

  const handleClear = () => {
    if (strokes.length === 0) {
      return;
    }

    if (!window.confirm("Effacer tous les traits du dessin ?")) {
      return;
    }

    setStrokes([]);
    setLimitMessage(null);
  };

  const handleSubmit = () => {
    if (
      disabled ||
      isSubmitting ||
      submissionRequestedRef.current ||
      strokes.length === 0
    ) {
      return;
    }

    if (!window.confirm("Valider définitivement ce dessin ?")) {
      return;
    }

    submissionRequestedRef.current = true;
    if (!onSubmit(createDrawingDocument(strokes))) {
      submissionRequestedRef.current = false;
    }
  };

  const handleColorChange = (color: DrawingColor) => {
    setSelectedColor(color);
    setSelectedTool("pen");
  };

  return (
    <section className="drawing-editor" aria-labelledby="drawing-editor-title">
      <div className="drawing-editor-heading">
        <div>
          <p className="card-label">Votre dessin</p>
          <h3 id="drawing-editor-title">Zone de dessin</h3>
        </div>
        <p>{strokes.length} trait{strokes.length > 1 ? "s" : ""}</p>
      </div>

      <p id="drawing-canvas-help" className="drawing-canvas-help">
        Dessinez avec la souris, le doigt ou un stylet. Le dessin reste dans ce
        navigateur jusqu’à sa validation.
      </p>

      <DrawingCanvas
        strokes={strokes}
        selectedTool={selectedTool}
        selectedColor={selectedColor}
        selectedWidth={selectedWidth}
        remainingPointCapacity={remainingPointCapacity}
        disabled={editorIsDisabled}
        describedBy="drawing-canvas-help"
        onStrokeComplete={handleStrokeComplete}
        onStrokeActiveChange={setIsStrokeActive}
        onLimitReached={handleLimitReached}
      />

      <DrawingToolbar
        selectedTool={selectedTool}
        selectedColor={selectedColor}
        selectedWidth={selectedWidth}
        canUndo={strokes.length > 0}
        disabled={disabled || isStrokeActive}
        onToolChange={setSelectedTool}
        onColorChange={handleColorChange}
        onWidthChange={setSelectedWidth}
        onUndo={handleUndo}
        onClear={handleClear}
      />

      {limitMessage !== null && (
        <p className="drawing-limit-message" role="status">
          {limitMessage}
        </p>
      )}

      <div className="drawing-submit-area">
        <p id="drawing-submit-help">
          La validation est définitive pour ce tour. Vérifiez votre dessin avant
          de l’envoyer.
        </p>
        <button
          className="button button--primary drawing-submit-button"
          type="button"
          disabled={
            disabled || isSubmitting || isStrokeActive || strokes.length === 0
          }
          aria-describedby="drawing-submit-help"
          onClick={handleSubmit}
        >
          {isSubmitting ? "Envoi du dessin…" : "Valider le dessin"}
        </button>
      </div>

      {isSubmitting && (
        <p className="visually-hidden" role="status" aria-live="polite">
          Envoi du dessin au serveur en cours.
        </p>
      )}
    </section>
  );
}
