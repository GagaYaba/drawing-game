export const DRAWING_DOCUMENT_VERSION = 1 as const;
export const DRAWING_ASPECT_RATIO = "4:3" as const;
export const DRAWING_BACKGROUND_COLOR = "#FFFFFF" as const;

export const DRAWING_COLOR_PALETTE = [
  "#111111",
  "#E53935",
  "#1E88E5",
  "#43A047",
  "#FB8C00",
  "#8E24AA",
] as const;

export const DRAWING_ALLOWED_STROKE_WIDTHS = [4, 8, 14] as const;

export const DRAWING_MAX_STROKES = 250;
export const DRAWING_MAX_POINTS_PER_STROKE = 300;
export const DRAWING_MAX_TOTAL_POINTS = 30_000;

export type DrawingTool = "pen" | "eraser";
export type DrawingColor = (typeof DRAWING_COLOR_PALETTE)[number];
export type DrawingStrokeWidth =
  (typeof DRAWING_ALLOWED_STROKE_WIDTHS)[number];

export interface DrawingPoint {
  x: number;
  y: number;
}

export interface DrawingStroke {
  tool: DrawingTool;
  color: string;
  width: DrawingStrokeWidth;
  points: DrawingPoint[];
}

export interface DrawingDocument {
  version: typeof DRAWING_DOCUMENT_VERSION;
  aspectRatio: typeof DRAWING_ASPECT_RATIO;
  backgroundColor: typeof DRAWING_BACKGROUND_COLOR;
  strokes: DrawingStroke[];
}
