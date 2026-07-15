import type {
  DrawingDocument,
  DrawingStroke,
} from "@drawing-game/shared";

export const DRAWING_REFERENCE_WIDTH = 1_200;
export const DRAWING_REFERENCE_HEIGHT = 900;

export interface CanvasDisplayMetrics {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
}

function getScaledStrokeWidth(
  stroke: DrawingStroke,
  width: number,
  height: number,
): number {
  const displayScale = Math.min(
    width / DRAWING_REFERENCE_WIDTH,
    height / DRAWING_REFERENCE_HEIGHT,
  );
  return stroke.width * displayScale;
}

export function renderDrawingStroke(
  context: CanvasRenderingContext2D,
  stroke: DrawingStroke,
  width: number,
  height: number,
  backgroundColor: string,
): void {
  const [firstPoint, ...remainingPoints] = stroke.points;

  if (firstPoint === undefined || width <= 0 || height <= 0) {
    return;
  }

  const color = stroke.tool === "eraser" ? backgroundColor : stroke.color;
  const lineWidth = getScaledStrokeWidth(stroke, width, height);
  const firstX = firstPoint.x * width;
  const firstY = firstPoint.y * height;

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = lineWidth;
  context.strokeStyle = color;
  context.fillStyle = color;

  if (remainingPoints.length === 0) {
    context.beginPath();
    context.arc(firstX, firstY, lineWidth / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }

  context.beginPath();
  context.moveTo(firstX, firstY);
  for (const point of remainingPoints) {
    context.lineTo(point.x * width, point.y * height);
  }
  context.stroke();
  context.restore();
}

export function renderDrawingDocument(
  context: CanvasRenderingContext2D,
  drawing: DrawingDocument,
  width: number,
  height: number,
): void {
  context.clearRect(0, 0, width, height);
  context.fillStyle = drawing.backgroundColor;
  context.fillRect(0, 0, width, height);

  for (const stroke of drawing.strokes) {
    renderDrawingStroke(
      context,
      stroke,
      width,
      height,
      drawing.backgroundColor,
    );
  }
}

export function prepareCanvasForDisplay(
  canvas: HTMLCanvasElement,
): CanvasDisplayMetrics | null {
  const bounds = canvas.getBoundingClientRect();

  if (bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }

  const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const backingWidth = Math.max(1, Math.round(bounds.width * devicePixelRatio));
  const backingHeight = Math.max(
    1,
    Math.round(bounds.height * devicePixelRatio),
  );

  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }

  const context = canvas.getContext("2d");
  if (context === null) {
    return null;
  }

  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  return { context, width: bounds.width, height: bounds.height };
}
