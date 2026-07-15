import { useId, useLayoutEffect, useRef } from "react";

import type { DrawingDocument } from "@drawing-game/shared";

import {
  prepareCanvasForDisplay,
  renderDrawingDocument,
} from "./drawing-renderer";

interface DrawingPreviewProps {
  drawing: DrawingDocument;
  description: string;
}

export function DrawingPreview({
  drawing,
  description,
}: DrawingPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(drawing);
  const descriptionId = useId();

  drawingRef.current = drawing;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return undefined;
    }

    const redraw = () => {
      const metrics = prepareCanvasForDisplay(canvas);
      if (metrics === null) {
        return;
      }

      renderDrawingDocument(
        metrics.context,
        drawingRef.current,
        metrics.width,
        metrics.height,
      );
    };

    redraw();
    const resizeObserver = new ResizeObserver(redraw);
    resizeObserver.observe(canvas);
    window.addEventListener("resize", redraw);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", redraw);
    };
  }, [drawing]);

  return (
    <figure className="drawing-preview">
      <div className="drawing-preview-frame">
        <canvas
          ref={canvasRef}
          className="drawing-preview-canvas"
          role="img"
          aria-label="Dessin soumis par le dessinateur"
          aria-describedby={descriptionId}
        >
          Votre navigateur ne permet pas d’afficher le dessin soumis.
        </canvas>
      </div>
      <figcaption id={descriptionId}>{description}</figcaption>
    </figure>
  );
}
