import {
  DRAWING_ALLOWED_STROKE_WIDTHS,
  DRAWING_ASPECT_RATIO,
  DRAWING_BACKGROUND_COLOR,
  DRAWING_COLOR_PALETTE,
  DRAWING_DOCUMENT_VERSION,
  DRAWING_LEGACY_DOCUMENT_VERSION,
  DRAWING_MAX_FILL_OPERATIONS,
  DRAWING_MAX_POINTS_PER_STROKE,
  DRAWING_MAX_STROKES,
  DRAWING_MAX_TOTAL_POINTS,
  type DrawingDocument,
  type DrawingFillOperation,
  type DrawingPathStroke,
  type DrawingPoint,
  type DrawingStroke,
  type SubmitDrawingPayload,
} from "@drawing-game/shared";
import { describe, expect, it } from "vitest";

import {
  cloneDrawingDocument,
  validateSubmitDrawingPayload,
} from "../src/game/drawing-validation.js";

function createPoints(count: number): DrawingPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    x: count === 1 ? 0.25 : index / (count - 1),
    y: 0.5,
  }));
}

function createStroke(
  overrides: Partial<DrawingPathStroke> = {},
): DrawingPathStroke {
  return {
    tool: "pen",
    color: DRAWING_COLOR_PALETTE[0],
    width: DRAWING_ALLOWED_STROKE_WIDTHS[1],
    points: [{ x: 0.25, y: 0.75 }],
    ...overrides,
  };
}

function createFill(
  overrides: Partial<Omit<DrawingFillOperation, "tool" | "points">> & {
    points?: [DrawingPoint];
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

function createDocument(
  strokes: DrawingStroke[] = [createStroke()],
): DrawingDocument {
  return {
    version: DRAWING_DOCUMENT_VERSION,
    aspectRatio: DRAWING_ASPECT_RATIO,
    backgroundColor: DRAWING_BACKGROUND_COLOR,
    strokes,
  };
}

function createPayload(
  strokes: DrawingStroke[] = [createStroke()],
): SubmitDrawingPayload {
  return { drawing: createDocument(strokes) };
}

function expectValidationError(
  payload: unknown,
  expectedCode: "EMPTY_DRAWING" | "INVALID_DRAWING" | "DRAWING_TOO_LARGE",
): void {
  const result = validateSubmitDrawingPayload(payload);

  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("La validation aurait dû refuser le dessin.");
  }

  expect(result.error.code).toBe(expectedCode);
  expect(result.error.message.length).toBeGreaterThan(0);
}

describe("validateSubmitDrawingPayload", () => {
  it("accepte un document vectoriel valide et en produit une copie sûre", () => {
    const payload = createPayload([
      createStroke({
        color: DRAWING_COLOR_PALETTE[2],
        width: DRAWING_ALLOWED_STROKE_WIDTHS[2],
        points: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.25 },
          { x: 1, y: 1 },
        ],
      }),
    ]);

    const result = validateSubmitDrawingPayload(payload);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`Validation inattendue : ${result.error.code}`);
    }

    expect(result.document).toEqual(payload.drawing);
    expect(result.document).not.toBe(payload.drawing);
    expect(result.document.strokes[0]).not.toBe(payload.drawing.strokes[0]);
    expect(result.document.strokes[0]?.points[0]).not.toBe(
      payload.drawing.strokes[0]?.points[0],
    );
  });

  it.each(DRAWING_COLOR_PALETTE)(
    "accepte la couleur de stylo autorisée %s",
    (color) => {
      const result = validateSubmitDrawingPayload(
        createPayload([createStroke({ color })]),
      );

      expect(result.success).toBe(true);
    },
  );

  it.each(DRAWING_ALLOWED_STROKE_WIDTHS)(
    "accepte la largeur de trait autorisée %s",
    (width) => {
      const result = validateSubmitDrawingPayload(
        createPayload([createStroke({ width })]),
      );

      expect(result.success).toBe(true);
    },
  );

  it("accepte un remplissage v2 avec un unique seed normalisé", () => {
    const fill = createFill({
      color: "#FDD835",
      points: [{ x: 0.4, y: 0.6 }],
    });
    const result = validateSubmitDrawingPayload(createPayload([fill]));

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`Validation inattendue : ${result.error.code}`);
    }

    expect(result.document.version).toBe(DRAWING_DOCUMENT_VERSION);
    expect(result.document.strokes[0]).toEqual(fill);
    expect(result.document.strokes[0]).not.toBe(fill);
    expect(result.document.strokes[0]?.points[0]).not.toBe(fill.points[0]);
  });

  it("accepte un document v1 historique et le canonicalise en v2", () => {
    const legacyDrawing = {
      ...createDocument(),
      version: DRAWING_LEGACY_DOCUMENT_VERSION,
    };
    const result = validateSubmitDrawingPayload({ drawing: legacyDrawing });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`Validation inattendue : ${result.error.code}`);
    }

    expect(result.document.version).toBe(DRAWING_DOCUMENT_VERSION);
    expect(result.document.strokes).toEqual(legacyDrawing.strokes);
  });

  it("refuse un remplissage déclaré dans un document v1", () => {
    expectValidationError(
      {
        drawing: {
          ...createDocument([createFill()]),
          version: DRAWING_LEGACY_DOCUMENT_VERSION,
        },
      },
      "INVALID_DRAWING",
    );
  });

  it("normalise la couleur de la gomme vers le fond blanc", () => {
    const result = validateSubmitDrawingPayload(
      createPayload([
        createStroke({ tool: "eraser", color: DRAWING_COLOR_PALETTE[1] }),
      ]),
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`Validation inattendue : ${result.error.code}`);
    }
    expect(result.document.strokes[0]?.tool).toBe("eraser");
    expect(result.document.strokes[0]?.color).toBe(
      DRAWING_BACKGROUND_COLOR,
    );
  });

  it("refuse une couleur de gomme non canonique avant normalisation", () => {
    expectValidationError(
      createPayload([createStroke({ tool: "eraser", color: "x".repeat(100) })]),
      "INVALID_DRAWING",
    );
  });

  it("accepte exactement les bornes maximales de complexité", () => {
    const strokes = Array.from({ length: 100 }, () =>
      createStroke({ points: createPoints(DRAWING_MAX_POINTS_PER_STROKE) }),
    );

    expect(strokes.length).toBeLessThanOrEqual(DRAWING_MAX_STROKES);
    expect(
      strokes.reduce((total, stroke) => total + stroke.points.length, 0),
    ).toBe(DRAWING_MAX_TOTAL_POINTS);
    expect(validateSubmitDrawingPayload(createPayload(strokes)).success).toBe(
      true,
    );
  });

  it("accepte exactement 250 traits d'un point", () => {
    const strokes = Array.from(
      { length: DRAWING_MAX_STROKES },
      () => createStroke(),
    );

    const result = validateSubmitDrawingPayload(createPayload(strokes));

    expect(strokes).toHaveLength(DRAWING_MAX_STROKES);
    expect(result.success).toBe(true);
  });

  it("refuse un dessin sans trait", () => {
    expectValidationError(createPayload([]), "EMPTY_DRAWING");
  });

  it("refuse plus de 250 traits", () => {
    const strokes = Array.from(
      { length: DRAWING_MAX_STROKES + 1 },
      () => createStroke(),
    );

    expectValidationError(createPayload(strokes), "DRAWING_TOO_LARGE");
  });

  it("refuse plus de 300 points dans un trait", () => {
    const stroke = createStroke({
      points: createPoints(DRAWING_MAX_POINTS_PER_STROKE + 1),
    });

    expectValidationError(createPayload([stroke]), "DRAWING_TOO_LARGE");
  });

  it("refuse plus de 30 000 points au total", () => {
    const fullStrokes = Array.from({ length: 100 }, () =>
      createStroke({ points: createPoints(DRAWING_MAX_POINTS_PER_STROKE) }),
    );
    const strokes = [...fullStrokes, createStroke()];

    expect(strokes.length).toBeLessThanOrEqual(DRAWING_MAX_STROKES);
    expectValidationError(createPayload(strokes), "DRAWING_TOO_LARGE");
  });

  it("accepte exactement la limite de remplissages", () => {
    const fills = Array.from(
      { length: DRAWING_MAX_FILL_OPERATIONS },
      (_, index) =>
        createFill({
          points: [
            {
              x: index / DRAWING_MAX_FILL_OPERATIONS,
              y: 0.5,
            },
          ],
        }),
    );

    expect(validateSubmitDrawingPayload(createPayload(fills)).success).toBe(
      true,
    );
  });

  it("refuse un remplissage au-delà de la limite dédiée", () => {
    const fills = Array.from(
      { length: DRAWING_MAX_FILL_OPERATIONS + 1 },
      () => createFill(),
    );

    expectValidationError(createPayload(fills), "DRAWING_TOO_LARGE");
  });

  it.each([
    ["x négatif", { x: -0.001, y: 0.5 }],
    ["x supérieur à un", { x: 1.001, y: 0.5 }],
    ["y négatif", { x: 0.5, y: -0.001 }],
    ["y supérieur à un", { x: 0.5, y: 1.001 }],
  ] as const)("refuse une coordonnée hors limites : %s", (_label, point) => {
    expectValidationError(
      createPayload([createStroke({ points: [point] })]),
      "INVALID_DRAWING",
    );
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["une chaîne", "0.5"],
  ])("refuse une coordonnée non finie ou non numérique : %s", (_label, x) => {
    const payload = createPayload();
    const invalidPoint = { x, y: 0.5 };
    const invalidPayload = {
      drawing: {
        ...payload.drawing,
        strokes: [{ ...payload.drawing.strokes[0], points: [invalidPoint] }],
      },
    };

    expectValidationError(invalidPayload, "INVALID_DRAWING");
  });

  it("refuse une couleur de stylo inconnue", () => {
    expectValidationError(
      createPayload([createStroke({ color: "#000000" })]),
      "INVALID_DRAWING",
    );
  });

  it.each([
    ["aucun seed", []],
    [
      "plusieurs seeds",
      [
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.8 },
      ],
    ],
  ])("refuse un remplissage avec %s", (_label, points) => {
    const fill = createFill();
    expectValidationError(
      createPayload([{ ...fill, points } as DrawingStroke]),
      "INVALID_DRAWING",
    );
  });

  it("refuse une couleur de remplissage inconnue", () => {
    const fill = createFill();
    expectValidationError(
      createPayload([
        { ...fill, color: "#ABCDEF" } as DrawingStroke,
      ]),
      "INVALID_DRAWING",
    );
  });

  it("refuse une largeur inconnue", () => {
    const payload = createPayload();
    const invalidPayload = {
      drawing: {
        ...payload.drawing,
        strokes: [{ ...payload.drawing.strokes[0], width: 5 }],
      },
    };

    expectValidationError(invalidPayload, "INVALID_DRAWING");
  });

  it("refuse un outil inconnu", () => {
    const payload = createPayload();
    const invalidPayload = {
      drawing: {
        ...payload.drawing,
        strokes: [{ ...payload.drawing.strokes[0], tool: "spray" }],
      },
    };

    expectValidationError(invalidPayload, "INVALID_DRAWING");
  });

  it.each([
    ["version", { version: 999 }],
    ["ratio", { aspectRatio: "16:9" }],
    ["fond", { backgroundColor: "#000000" }],
  ])("refuse une constante de document incorrecte : %s", (_label, override) => {
    const payload = createPayload();

    expectValidationError(
      { drawing: { ...payload.drawing, ...override } },
      "INVALID_DRAWING",
    );
  });

  it.each([
    ["payload", (payload: SubmitDrawingPayload) => ({ ...payload, playerId: "forgé" })],
    [
      "document",
      (payload: SubmitDrawingPayload) => ({
        drawing: { ...payload.drawing, dataUrl: "data:image/png;base64,..." },
      }),
    ],
    [
      "trait",
      (payload: SubmitDrawingPayload) => ({
        drawing: {
          ...payload.drawing,
          strokes: [{ ...payload.drawing.strokes[0], opacity: 0.5 }],
        },
      }),
    ],
    [
      "point",
      (payload: SubmitDrawingPayload) => ({
        drawing: {
          ...payload.drawing,
          strokes: [
            {
              ...payload.drawing.strokes[0],
              points: [{ x: 0.5, y: 0.5, pressure: 1 }],
            },
          ],
        },
      }),
    ],
  ] as const)("refuse une propriété supplémentaire au niveau %s", (_label, mutate) => {
    expectValidationError(mutate(createPayload()), "INVALID_DRAWING");
  });

  it.each([
    ["payload absent", undefined],
    ["payload nul", null],
    ["payload tableau", []],
    ["document absent", {}],
    ["document nul", { drawing: null }],
    ["traits non tabulaires", { drawing: { ...createDocument(), strokes: {} } }],
    [
      "trait sans points",
      {
        drawing: {
          ...createDocument(),
          strokes: [{ tool: "pen", color: "#111111", width: 8 }],
        },
      },
    ],
    [
      "trait avec tableau de points vide",
      createPayload([createStroke({ points: [] })]),
    ],
  ])("refuse sans exception une structure malformée : %s", (_label, payload) => {
    expectValidationError(payload, "INVALID_DRAWING");
  });
});

describe("cloneDrawingDocument", () => {
  it("clone chaque niveau mutable du document", () => {
    const original = createDocument([
      createStroke({
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.3, y: 0.4 },
        ],
      }),
    ]);

    const clone = cloneDrawingDocument(original);
    original.strokes[0]!.points[0]!.x = 0.9;
    original.strokes.push(createStroke());

    expect(clone.strokes).toHaveLength(1);
    expect(clone.strokes[0]?.points[0]?.x).toBe(0.1);
    expect(clone).not.toBe(original);
    expect(clone.strokes[0]).not.toBe(original.strokes[0]);
  });

  it("clone profondément le seed d'un remplissage", () => {
    const fill = createFill({ points: [{ x: 0.25, y: 0.75 }] });
    const original = createDocument([fill]);
    const clone = cloneDrawingDocument(original);

    fill.points[0].x = 0.9;

    expect(clone.strokes[0]).toEqual(
      createFill({ points: [{ x: 0.25, y: 0.75 }] }),
    );
    expect(clone.strokes[0]?.points[0]).not.toBe(fill.points[0]);
  });
});
