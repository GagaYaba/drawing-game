import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  DRAWING_BACKGROUND_COLOR,
  DRAWING_MAX_POINTS_PER_STROKE,
  type DrawingColor,
  type DrawingPoint,
  type DrawingStroke,
  type DrawingStrokeWidth,
  type DrawingTool,
} from "@drawing-game/shared";

import { createDrawingDocument } from "./drawing-document";
import {
  normalizePointerPosition,
  shouldAddPoint,
} from "./drawing-geometry";
import {
  prepareCanvasForDisplay,
  renderDrawingDocument,
  renderDrawingStroke,
} from "./drawing-renderer";

interface DrawingCanvasProps {
  strokes: readonly DrawingStroke[];
  selectedTool: DrawingTool;
  selectedColor: DrawingColor;
  selectedWidth: DrawingStrokeWidth;
  remainingPointCapacity: number;
  disabled: boolean;
  describedBy?: string;
  onStrokeComplete: (stroke: DrawingStroke) => void;
  onStrokeActiveChange: (isActive: boolean) => void;
  onLimitReached: () => void;
}

export function DrawingCanvas({
  strokes,
  selectedTool,
  selectedColor,
  selectedWidth,
  remainingPointCapacity,
  disabled,
  describedBy,
  onStrokeComplete,
  onStrokeActiveChange,
  onLimitReached,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef(strokes);
  const activeStrokeRef = useRef<DrawingStroke | null>(null);
  const activePointerIdRef = useRef<number | null>(null);

  strokesRef.current = strokes;

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    const metrics = prepareCanvasForDisplay(canvas);
    if (metrics === null) {
      return;
    }

    renderDrawingDocument(
      metrics.context,
      createDrawingDocument(strokesRef.current),
      metrics.width,
      metrics.height,
    );

    const activeStroke = activeStrokeRef.current;
    if (activeStroke !== null) {
      renderDrawingStroke(
        metrics.context,
        activeStroke,
        metrics.width,
        metrics.height,
        DRAWING_BACKGROUND_COLOR,
      );
    }
  }, []);

  useLayoutEffect(() => {
    redrawCanvas();
  }, [redrawCanvas, strokes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(redrawCanvas);
    resizeObserver.observe(canvas);
    window.addEventListener("resize", redrawCanvas);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", redrawCanvas);
    };
  }, [redrawCanvas]);

  useEffect(() => {
    if (!disabled || activePointerIdRef.current === null) {
      return;
    }

    const pointerId = activePointerIdRef.current;
    activePointerIdRef.current = null;
    activeStrokeRef.current = null;
    onStrokeActiveChange(false);

    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
    redrawCanvas();
  }, [disabled, onStrokeActiveChange, redrawCanvas]);

  const drawStrokeIncrement = (
    stroke: DrawingStroke,
    points: DrawingPoint[],
  ) => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    const metrics = prepareCanvasForDisplay(canvas);
    if (metrics === null) {
      return;
    }

    renderDrawingStroke(
      metrics.context,
      { ...stroke, points },
      metrics.width,
      metrics.height,
      DRAWING_BACKGROUND_COLOR,
    );
  };

  const finishStroke = (pointerId: number) => {
    if (activePointerIdRef.current !== pointerId) {
      return;
    }

    const completedStroke = activeStrokeRef.current;
    activePointerIdRef.current = null;
    activeStrokeRef.current = null;
    onStrokeActiveChange(false);

    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }

    if (completedStroke !== null && completedStroke.points.length > 0) {
      onStrokeComplete({
        ...completedStroke,
        points: completedStroke.points.map((point) => ({ ...point })),
      });
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (
      disabled ||
      activePointerIdRef.current !== null ||
      !event.isPrimary ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }

    if (remainingPointCapacity < 1) {
      onLimitReached();
      return;
    }

    event.preventDefault();
    const point = normalizePointerPosition(event, event.currentTarget.getBoundingClientRect());
    const stroke: DrawingStroke = {
      tool: selectedTool,
      color:
        selectedTool === "eraser"
          ? DRAWING_BACKGROUND_COLOR
          : selectedColor,
      width: selectedWidth,
      points: [point],
    };

    activePointerIdRef.current = event.pointerId;
    activeStrokeRef.current = stroke;
    onStrokeActiveChange(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    drawStrokeIncrement(stroke, [point]);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const activeStroke = activeStrokeRef.current;
    if (activeStroke === null) {
      return;
    }

    const strokePointLimit = Math.min(
      DRAWING_MAX_POINTS_PER_STROKE,
      remainingPointCapacity,
    );
    if (activeStroke.points.length >= strokePointLimit) {
      onLimitReached();
      return;
    }

    const previousPoint = activeStroke.points.at(-1);
    if (previousPoint === undefined) {
      return;
    }

    const nextPoint = normalizePointerPosition(
      event,
      event.currentTarget.getBoundingClientRect(),
    );
    if (!shouldAddPoint(previousPoint, nextPoint)) {
      return;
    }

    activeStroke.points.push(nextPoint);
    drawStrokeIncrement(activeStroke, [previousPoint, nextPoint]);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== event.pointerId) {
      return;
    }

    event.preventDefault();
    finishStroke(event.pointerId);
  };

  return (
    <div
      className={`drawing-canvas-frame${disabled ? " drawing-canvas-frame--disabled" : ""}`}
      role="group"
      aria-label="Zone de dessin interactive au format quatre tiers"
      aria-describedby={describedBy}
      aria-disabled={disabled}
    >
      <canvas
        ref={canvasRef}
        className="drawing-canvas"
        aria-label="Zone de dessin interactive au format quatre tiers"
        aria-disabled={disabled}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handlePointerEnd}
        onContextMenu={(event) => event.preventDefault()}
      >
        Votre navigateur ne permet pas d’afficher la zone de dessin.
      </canvas>
    </div>
  );
}
