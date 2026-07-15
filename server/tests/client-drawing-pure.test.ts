import {
  DRAWING_ALLOWED_STROKE_WIDTHS,
  DRAWING_ASPECT_RATIO,
  DRAWING_BACKGROUND_COLOR,
  DRAWING_COLOR_PALETTE,
  DRAWING_DOCUMENT_VERSION,
  type DrawingStroke,
} from "@drawing-game/shared";
import { describe, expect, it, vi } from "vitest";

import {
  countDrawingPoints,
  createDrawingDocument,
  removeLastStroke,
} from "../../client/src/components/drawing/drawing-document.js";
import {
  MIN_DRAWING_POINT_DISTANCE,
  distanceBetweenPoints,
  normalizePointerPosition,
  shouldAddPoint,
} from "../../client/src/components/drawing/drawing-geometry.js";
import {
  DRAWING_REFERENCE_HEIGHT,
  DRAWING_REFERENCE_WIDTH,
  renderDrawingDocument,
  renderDrawingStroke,
} from "../../client/src/components/drawing/drawing-renderer.js";

function createStroke(
  overrides: Partial<DrawingStroke> = {},
): DrawingStroke {
  return {
    tool: "pen",
    color: DRAWING_COLOR_PALETTE[0],
    width: DRAWING_ALLOWED_STROKE_WIDTHS[1],
    points: [
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0.5 },
    ],
    ...overrides,
  };
}

interface ContextDouble {
  context: CanvasRenderingContext2D;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
}

function createContextDouble(): ContextDouble {
  const save = vi.fn();
  const restore = vi.fn();
  const beginPath = vi.fn();
  const arc = vi.fn();
  const fill = vi.fn();
  const moveTo = vi.fn();
  const lineTo = vi.fn();
  const stroke = vi.fn();
  const clearRect = vi.fn();
  const fillRect = vi.fn();
  const context = {
    save,
    restore,
    beginPath,
    arc,
    fill,
    moveTo,
    lineTo,
    stroke,
    clearRect,
    fillRect,
    lineCap: "butt",
    lineJoin: "miter",
    lineWidth: 1,
    strokeStyle: "#000000",
    fillStyle: "#000000",
  } as unknown as CanvasRenderingContext2D;

  return {
    context,
    save,
    restore,
    beginPath,
    arc,
    fill,
    moveTo,
    lineTo,
    stroke,
    clearRect,
    fillRect,
  };
}

describe("client drawing geometry", () => {
  it("normalise le centre du rectangle visible", () => {
    expect(
      normalizePointerPosition(
        { clientX: 350, clientY: 250 },
        { left: 100, top: 50, width: 500, height: 400 },
      ),
    ).toEqual({ x: 0.5, y: 0.5 });
  });

  it("borne les positions extérieures entre zéro et un", () => {
    const bounds = { left: 100, top: 50, width: 500, height: 400 };

    expect(
      normalizePointerPosition({ clientX: -500, clientY: -500 }, bounds),
    ).toEqual({ x: 0, y: 0 });
    expect(
      normalizePointerPosition({ clientX: 2_000, clientY: 2_000 }, bounds),
    ).toEqual({ x: 1, y: 1 });
  });

  it("refuse les dimensions nulles et les valeurs non finies", () => {
    expect(() =>
      normalizePointerPosition(
        { clientX: 10, clientY: 10 },
        { left: 0, top: 0, width: 0, height: 100 },
      ),
    ).toThrow(RangeError);
    expect(() =>
      normalizePointerPosition(
        { clientX: Number.NaN, clientY: 10 },
        { left: 0, top: 0, width: 100, height: 100 },
      ),
    ).toThrow(RangeError);
  });

  it("calcule la distance euclidienne entre deux points", () => {
    expect(
      distanceBetweenPoints({ x: 0, y: 0 }, { x: 0.3, y: 0.4 }),
    ).toBeCloseTo(0.5);
  });

  it("ignore un micro-mouvement sous le seuil d'échantillonnage", () => {
    expect(
      shouldAddPoint(
        { x: 0, y: 0 },
        { x: MIN_DRAWING_POINT_DISTANCE / 2, y: 0 },
      ),
    ).toBe(false);
  });

  it("conserve un point situé exactement au seuil d'échantillonnage", () => {
    expect(
      shouldAddPoint(
        { x: 0, y: 0 },
        { x: MIN_DRAWING_POINT_DISTANCE, y: 0 },
      ),
    ).toBe(true);
  });
});

describe("client drawing document transformations", () => {
  it("crée le document canonique en conservant les coordonnées normalisées", () => {
    const strokes = [
      createStroke({
        points: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.75 },
          { x: 1, y: 1 },
        ],
      }),
    ];

    const document = createDrawingDocument(strokes);

    expect(document).toEqual({
      version: DRAWING_DOCUMENT_VERSION,
      aspectRatio: DRAWING_ASPECT_RATIO,
      backgroundColor: DRAWING_BACKGROUND_COLOR,
      strokes,
    });
    expect(document.strokes).not.toBe(strokes);
    expect(document.strokes[0]).not.toBe(strokes[0]);
    expect(document.strokes[0]?.points[0]).not.toBe(strokes[0]?.points[0]);
  });

  it("normalise la gomme dans le document client sans muter le trait source", () => {
    const eraser = createStroke({ tool: "eraser", color: "#E53935" });

    const document = createDrawingDocument([eraser]);

    expect(document.strokes[0]?.color).toBe(DRAWING_BACKGROUND_COLOR);
    expect(eraser.color).toBe("#E53935");
  });

  it("annuler supprime le dernier trait complet sans muter la liste source", () => {
    const first = createStroke({ color: DRAWING_COLOR_PALETTE[0] });
    const second = createStroke({ color: DRAWING_COLOR_PALETTE[1] });
    const strokes = [first, second];

    const undone = removeLastStroke(strokes);

    expect(undone).toEqual([first]);
    expect(strokes).toEqual([first, second]);
    expect(undone).not.toBe(strokes);
  });

  it("annuler une liste vide reste sans effet", () => {
    expect(removeLastStroke([])).toEqual([]);
  });

  it("compte les points de tous les traits", () => {
    expect(
      countDrawingPoints([
        createStroke({ points: [{ x: 0, y: 0 }] }),
        createStroke({
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.5 },
            { x: 1, y: 1 },
          ],
        }),
      ]),
    ).toBe(4);
  });
});

describe("client drawing renderer", () => {
  it("rend un trait d'un seul point sous forme de cercle visible", () => {
    const canvas = createContextDouble();
    const stroke = createStroke({
      width: DRAWING_ALLOWED_STROKE_WIDTHS[1],
      points: [{ x: 0.25, y: 0.5 }],
    });

    renderDrawingStroke(
      canvas.context,
      stroke,
      DRAWING_REFERENCE_WIDTH,
      DRAWING_REFERENCE_HEIGHT,
      DRAWING_BACKGROUND_COLOR,
    );

    expect(canvas.arc).toHaveBeenCalledOnce();
    expect(canvas.arc).toHaveBeenCalledWith(
      300,
      450,
      DRAWING_ALLOWED_STROKE_WIDTHS[1] / 2,
      0,
      Math.PI * 2,
    );
    expect(canvas.fill).toHaveBeenCalledOnce();
    expect(canvas.stroke).not.toHaveBeenCalled();
    expect(canvas.context.lineCap).toBe("round");
    expect(canvas.context.lineJoin).toBe("round");
    expect(canvas.restore).toHaveBeenCalledOnce();
  });

  it("rend la gomme avec la couleur du fond", () => {
    const canvas = createContextDouble();
    const stroke = createStroke({
      tool: "eraser",
      color: DRAWING_COLOR_PALETTE[1],
    });

    renderDrawingStroke(
      canvas.context,
      stroke,
      DRAWING_REFERENCE_WIDTH,
      DRAWING_REFERENCE_HEIGHT,
      DRAWING_BACKGROUND_COLOR,
    );

    expect(canvas.context.strokeStyle).toBe(DRAWING_BACKGROUND_COLOR);
    expect(canvas.moveTo).toHaveBeenCalledWith(300, 450);
    expect(canvas.lineTo).toHaveBeenCalledWith(900, 450);
    expect(canvas.stroke).toHaveBeenCalledOnce();
  });

  it("efface, peint le fond puis rend les traits du document", () => {
    const canvas = createContextDouble();
    const document = createDrawingDocument([createStroke()]);

    renderDrawingDocument(
      canvas.context,
      document,
      DRAWING_REFERENCE_WIDTH,
      DRAWING_REFERENCE_HEIGHT,
    );

    expect(canvas.clearRect).toHaveBeenCalledWith(
      0,
      0,
      DRAWING_REFERENCE_WIDTH,
      DRAWING_REFERENCE_HEIGHT,
    );
    expect(canvas.fillRect).toHaveBeenCalledWith(
      0,
      0,
      DRAWING_REFERENCE_WIDTH,
      DRAWING_REFERENCE_HEIGHT,
    );
    expect(canvas.stroke).toHaveBeenCalledOnce();
  });
});
