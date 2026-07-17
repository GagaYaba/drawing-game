import {
  DRAWING_ALLOWED_STROKE_WIDTHS,
  DRAWING_ASPECT_RATIO,
  DRAWING_BACKGROUND_COLOR,
  DRAWING_COLOR_PALETTE,
  DRAWING_DOCUMENT_VERSION,
  type DrawingFillOperation,
  type DrawingPathStroke,
  type DrawingStroke,
} from "@drawing-game/shared";
import { describe, expect, it, vi } from "vitest";

import {
  countDrawingFillOperations,
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
import { floodFillImageData } from "../../client/src/components/drawing/drawing-fill.js";
import {
  copyDrawingRenderCache,
  DRAWING_REFERENCE_HEIGHT,
  DRAWING_REFERENCE_WIDTH,
  getDrawingReferenceMetrics,
  renderDrawingDocument,
  renderDrawingStroke,
  updateDrawingRenderCache,
  type CanvasDisplayMetrics,
} from "../../client/src/components/drawing/drawing-renderer.js";

function createStroke(
  overrides: Partial<DrawingPathStroke> = {},
): DrawingPathStroke {
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

function createFill(
  overrides: Partial<Omit<DrawingFillOperation, "tool" | "points">> & {
    points?: [DrawingFillOperation["points"][number]];
  } = {},
): DrawingFillOperation {
  return {
    tool: "fill",
    color: DRAWING_COLOR_PALETTE[1],
    width: DRAWING_ALLOWED_STROKE_WIDTHS[1],
    points: [{ x: 0.5, y: 0.5 }],
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
  getImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
}

function createImageData(
  width: number,
  height: number,
  color = [255, 255, 255, 255] as const,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
    data[offset + 3] = color[3];
  }

  return { data, width, height } as ImageData;
}

function createContextDouble(
  imageData = createImageData(8, 6),
): ContextDouble {
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
  const getImageData = vi.fn(() => imageData);
  const putImageData = vi.fn();
  const setTransform = vi.fn();
  const drawImage = vi.fn();
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
    getImageData,
    putImageData,
    setTransform,
    drawImage,
    canvas: {
      width: imageData.width,
      height: imageData.height,
    },
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
    getImageData,
    putImageData,
    setTransform,
    drawImage,
  };
}

function createDisplayMetrics(
  context: CanvasRenderingContext2D,
  overrides: Partial<Omit<CanvasDisplayMetrics, "context">> = {},
): CanvasDisplayMetrics {
  const width = overrides.width ?? 8;
  const height = overrides.height ?? 6;
  const devicePixelRatio = overrides.devicePixelRatio ?? 1;

  return {
    context,
    width,
    height,
    backingWidth:
      overrides.backingWidth ?? Math.max(1, Math.round(width * devicePixelRatio)),
    backingHeight:
      overrides.backingHeight ??
      Math.max(1, Math.round(height * devicePixelRatio)),
    devicePixelRatio,
    resized: overrides.resized ?? false,
  };
}

function setPixel(
  imageData: ImageData,
  x: number,
  y: number,
  color: readonly [number, number, number, number],
): void {
  const offset = (y * imageData.width + x) * 4;
  imageData.data.set(color, offset);
}

function getPixel(
  imageData: ImageData,
  x: number,
  y: number,
): number[] {
  const offset = (y * imageData.width + x) * 4;
  return Array.from(imageData.data.slice(offset, offset + 4));
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

describe("client bucket fill", () => {
  it("remplit uniquement la zone blanche fermée autour du point choisi", () => {
    const imageData = createImageData(7, 7);
    const black = [17, 17, 17, 255] as const;

    for (let coordinate = 1; coordinate <= 5; coordinate += 1) {
      setPixel(imageData, coordinate, 1, black);
      setPixel(imageData, coordinate, 5, black);
      setPixel(imageData, 1, coordinate, black);
      setPixel(imageData, 5, coordinate, black);
    }

    expect(
      floodFillImageData(
        imageData,
        { x: 0.5, y: 0.5 },
        "#E53935",
      ),
    ).toBe(true);
    expect(getPixel(imageData, 3, 3)).toEqual([229, 57, 53, 255]);
    expect(getPixel(imageData, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(getPixel(imageData, 1, 3)).toEqual([...black]);
  });

  it("borne un seed placé exactement sur le bord inférieur droit", () => {
    const imageData = createImageData(3, 2);

    expect(
      floodFillImageData(
        imageData,
        { x: 1, y: 1 },
        "#1E88E5",
      ),
    ).toBe(true);
    expect(getPixel(imageData, 2, 1)).toEqual([30, 136, 229, 255]);
    expect(getPixel(imageData, 0, 0)).toEqual([30, 136, 229, 255]);
  });

  it("ignore un remplissage dont la couleur est déjà celle de la zone", () => {
    const imageData = createImageData(4, 3);
    const originalPixels = imageData.data.slice();

    expect(
      floodFillImageData(
        imageData,
        { x: 0.25, y: 0.75 },
        DRAWING_BACKGROUND_COLOR,
      ),
    ).toBe(false);
    expect(imageData.data).toEqual(originalPixels);
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

  it("clone et annule un remplissage comme une opération ordonnée", () => {
    const fill = createFill({ points: [{ x: 0.2, y: 0.3 }] });
    const document = createDrawingDocument([createStroke(), fill]);

    expect(document.strokes[1]).toEqual(fill);
    expect(document.strokes[1]).not.toBe(fill);
    expect(document.strokes[1]?.points[0]).not.toBe(fill.points[0]);
    expect(removeLastStroke(document.strokes)).toEqual([
      document.strokes[0],
    ]);
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

  it("compte séparément les opérations de remplissage", () => {
    expect(
      countDrawingFillOperations([
        createStroke(),
        createFill(),
        createStroke(),
        createFill({ color: DRAWING_COLOR_PALETTE[2] }),
      ]),
    ).toBe(2);
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

  it("rend un remplissage depuis le seed sur le backing store", () => {
    const imageData = createImageData(5, 5);
    const canvas = createContextDouble(imageData);

    renderDrawingStroke(
      canvas.context,
      createFill({
        color: "#43A047",
        points: [{ x: 0.5, y: 0.5 }],
      }),
      500,
      500,
      DRAWING_BACKGROUND_COLOR,
    );

    expect(canvas.getImageData).toHaveBeenCalledWith(0, 0, 5, 5);
    expect(canvas.putImageData).toHaveBeenCalledOnce();
    expect(getPixel(imageData, 4, 4)).toEqual([67, 160, 71, 255]);
    expect(canvas.stroke).not.toHaveBeenCalled();
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

  it("met en cache le document et ne rejoue que les actions ajoutées", () => {
    const canvas = createContextDouble();
    const metrics = createDisplayMetrics(canvas.context);
    const firstFill = createFill({ color: "#43A047" });

    const initialUpdate = updateDrawingRenderCache(
      canvas.context,
      createDrawingDocument([firstFill]),
      metrics,
      null,
    );

    expect(initialUpdate.strategy).toBe("full");
    expect(canvas.getImageData).toHaveBeenCalledOnce();
    expect(canvas.fillRect).toHaveBeenCalledOnce();

    const appendedPathUpdate = updateDrawingRenderCache(
      canvas.context,
      createDrawingDocument([firstFill, createStroke()]),
      metrics,
      initialUpdate.state,
    );

    expect(appendedPathUpdate.strategy).toBe("append");
    expect(canvas.getImageData).toHaveBeenCalledOnce();
    expect(canvas.fillRect).toHaveBeenCalledOnce();
    expect(canvas.stroke).toHaveBeenCalledOnce();

    const appendedFillUpdate = updateDrawingRenderCache(
      canvas.context,
      createDrawingDocument([
        firstFill,
        createStroke(),
        createFill({ color: "#1E88E5" }),
      ]),
      metrics,
      appendedPathUpdate.state,
    );

    expect(appendedFillUpdate.strategy).toBe("append");
    expect(canvas.getImageData).toHaveBeenCalledTimes(2);
    expect(canvas.fillRect).toHaveBeenCalledOnce();
  });

  it("ignore un redraw identique, y compris avec des objets clonés", () => {
    const canvas = createContextDouble();
    const metrics = createDisplayMetrics(canvas.context);
    const strokes = [createFill({ color: "#43A047" }), createStroke()];
    const initialUpdate = updateDrawingRenderCache(
      canvas.context,
      createDrawingDocument(strokes),
      metrics,
      null,
    );

    canvas.clearRect.mockClear();
    canvas.fillRect.mockClear();
    canvas.getImageData.mockClear();
    canvas.stroke.mockClear();

    const identicalUpdate = updateDrawingRenderCache(
      canvas.context,
      createDrawingDocument(strokes),
      metrics,
      initialUpdate.state,
    );

    expect(identicalUpdate.strategy).toBe("unchanged");
    expect(canvas.clearRect).not.toHaveBeenCalled();
    expect(canvas.fillRect).not.toHaveBeenCalled();
    expect(canvas.getImageData).not.toHaveBeenCalled();
    expect(canvas.stroke).not.toHaveBeenCalled();
  });

  it("copie le cache canonique vers tout backing visible, DPR compris", () => {
    const canvas = createContextDouble();
    const referenceMetrics = getDrawingReferenceMetrics(canvas.context);
    const source = {
      width: DRAWING_REFERENCE_WIDTH,
      height: DRAWING_REFERENCE_HEIGHT,
    } as HTMLCanvasElement;

    expect(referenceMetrics).toMatchObject({
      width: DRAWING_REFERENCE_WIDTH,
      height: DRAWING_REFERENCE_HEIGHT,
      backingWidth: DRAWING_REFERENCE_WIDTH,
      backingHeight: DRAWING_REFERENCE_HEIGHT,
      devicePixelRatio: 1,
      resized: true,
    });

    copyDrawingRenderCache(canvas.context, source, 2_400, 1_800);

    expect(canvas.setTransform).toHaveBeenLastCalledWith(1, 0, 0, 1, 0, 0);
    expect(canvas.clearRect).toHaveBeenLastCalledWith(0, 0, 2_400, 1_800);
    expect(canvas.drawImage).toHaveBeenCalledWith(
      source,
      0,
      0,
      DRAWING_REFERENCE_WIDTH,
      DRAWING_REFERENCE_HEIGHT,
      0,
      0,
      2_400,
      1_800,
    );

    canvas.drawImage.mockClear();
    copyDrawingRenderCache(canvas.context, source, 800, 600);
    expect(canvas.drawImage).toHaveBeenCalledWith(
      source,
      0,
      0,
      DRAWING_REFERENCE_WIDTH,
      DRAWING_REFERENCE_HEIGHT,
      0,
      0,
      800,
      600,
    );
    expect(canvas.restore).toHaveBeenCalledTimes(2);
  });

  it("reconstruit le cache après undo, clear, mutation, resize ou changement de DPR", () => {
    const canvas = createContextDouble();
    const mutableStroke = createStroke();
    const initialMetrics = createDisplayMetrics(canvas.context);
    const initialUpdate = updateDrawingRenderCache(
      canvas.context,
      createDrawingDocument([createFill(), mutableStroke]),
      initialMetrics,
      null,
    );

    const undoUpdate = updateDrawingRenderCache(
      canvas.context,
      createDrawingDocument([createFill()]),
      initialMetrics,
      initialUpdate.state,
    );
    expect(undoUpdate.strategy).toBe("full");

    const appendAfterUndoUpdate = updateDrawingRenderCache(
      canvas.context,
      createDrawingDocument([createFill(), mutableStroke]),
      initialMetrics,
      undoUpdate.state,
    );
    expect(appendAfterUndoUpdate.strategy).toBe("append");

    const clearUpdate = updateDrawingRenderCache(
      canvas.context,
      createDrawingDocument([]),
      initialMetrics,
      appendAfterUndoUpdate.state,
    );
    expect(clearUpdate.strategy).toBe("full");

    const restoredUpdate = updateDrawingRenderCache(
      canvas.context,
      createDrawingDocument([createFill(), mutableStroke]),
      initialMetrics,
      clearUpdate.state,
    );
    expect(restoredUpdate.strategy).toBe("append");

    const firstMutablePoint = mutableStroke.points[0];
    expect(firstMutablePoint).toBeDefined();
    if (firstMutablePoint === undefined) {
      throw new Error("Le trait de test doit contenir un point.");
    }
    firstMutablePoint.x = 0.1;
    const mutatedUpdate = updateDrawingRenderCache(
      canvas.context,
      createDrawingDocument([createFill(), mutableStroke]),
      initialMetrics,
      restoredUpdate.state,
    );
    expect(mutatedUpdate.strategy).toBe("full");

    const resizedMetrics = createDisplayMetrics(canvas.context, {
      width: 10,
      height: 7.5,
      backingWidth: 10,
      backingHeight: 8,
      resized: true,
    });
    const resizedUpdate = updateDrawingRenderCache(
      canvas.context,
      createDrawingDocument([createFill(), mutableStroke]),
      resizedMetrics,
      mutatedUpdate.state,
    );
    expect(resizedUpdate.strategy).toBe("full");
    expect(canvas.context.canvas.width).toBe(10);
    expect(canvas.context.canvas.height).toBe(8);

    const highDprMetrics = createDisplayMetrics(canvas.context, {
      width: 5,
      height: 4,
      backingWidth: 10,
      backingHeight: 8,
      devicePixelRatio: 2,
    });
    const highDprUpdate = updateDrawingRenderCache(
      canvas.context,
      createDrawingDocument([createFill(), mutableStroke]),
      highDprMetrics,
      resizedUpdate.state,
    );
    expect(highDprUpdate.strategy).toBe("full");
    expect(canvas.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
  });
});
