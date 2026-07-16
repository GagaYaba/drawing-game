import {
  DRAWING_ALLOWED_STROKE_WIDTHS,
  DRAWING_ASPECT_RATIO,
  DRAWING_BACKGROUND_COLOR,
  DRAWING_COLOR_PALETTE,
  DRAWING_DOCUMENT_VERSION,
  type PlayerSessionCredentials,
} from "@drawing-game/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearStoredDrawingDraft,
  matchesDrawingDraftContext,
  readStoredDrawingDraft,
  STORED_DRAWING_DRAFT_KEY,
  type StoredDrawingDraft,
  writeStoredDrawingDraft,
} from "../../client/src/session/stored-drawing-draft.js";
import {
  clearStoredGuessDraft,
  matchesGuessDraftContext,
  readStoredGuessDraft,
  STORED_GUESS_DRAFT_KEY,
  type StoredGuessDraft,
  writeStoredGuessDraft,
} from "../../client/src/session/stored-guess-draft.js";
import {
  type BrowserStorage,
  clearStoredSession,
  readStoredSession,
  STORED_SESSION_KEY,
  writeStoredSession,
} from "../../client/src/session/stored-session.js";

class MemoryBrowserStorage implements BrowserStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const SESSION_TOKEN = "a".repeat(43);
const SESSION: PlayerSessionCredentials = {
  roomCode: "ABCDE",
  playerId: "player-1",
  token: SESSION_TOKEN,
};

const DRAWING_DRAFT: StoredDrawingDraft = {
  roomCode: SESSION.roomCode,
  gameId: "game-1",
  turnId: "turn-1",
  playerId: SESSION.playerId,
  drawing: {
    version: DRAWING_DOCUMENT_VERSION,
    aspectRatio: DRAWING_ASPECT_RATIO,
    backgroundColor: DRAWING_BACKGROUND_COLOR,
    strokes: [
      {
        tool: "pen",
        color: DRAWING_COLOR_PALETTE[1],
        width: DRAWING_ALLOWED_STROKE_WIDTHS[1],
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.8, y: 0.7 },
        ],
      },
    ],
  },
  selectedTool: "pen",
  selectedColor: DRAWING_COLOR_PALETTE[1],
  selectedWidth: DRAWING_ALLOWED_STROKE_WIDTHS[1],
  savedAt: 10_000,
};

const GUESS_DRAFT: StoredGuessDraft = {
  roomCode: SESSION.roomCode,
  gameId: "game-1",
  turnId: "turn-1",
  playerId: SESSION.playerId,
  value: 7,
  savedAt: 11_000,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stored player session", () => {
  it("écrit puis relit des credentials valides", () => {
    const storage = new MemoryBrowserStorage();

    expect(writeStoredSession(SESSION, storage)).toBe(true);
    expect(readStoredSession(storage)).toEqual(SESSION);
    expect(JSON.parse(storage.getItem(STORED_SESSION_KEY) ?? "null")).toEqual(
      SESSION,
    );
  });

  it.each([
    ["un JSON invalide", "{json-invalide"],
    [
      "une structure corrompue",
      JSON.stringify({ ...SESSION, token: "trop-court" }),
    ],
  ])("supprime %s sans lever d'erreur", (_label, serialized) => {
    const storage = new MemoryBrowserStorage();
    storage.setItem(STORED_SESSION_KEY, serialized);

    expect(readStoredSession(storage)).toBeNull();
    expect(storage.getItem(STORED_SESSION_KEY)).toBeNull();
  });

  it("ne journalise jamais le token pendant l'écriture ou la lecture", () => {
    const storage = new MemoryBrowserStorage();
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];

    expect(writeStoredSession(SESSION, storage)).toBe(true);
    expect(readStoredSession(storage)).toEqual(SESSION);

    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled();
      expect(JSON.stringify(spy.mock.calls)).not.toContain(SESSION_TOKEN);
    }
  });
});

describe("stored drawing draft", () => {
  it("écrit, relit et reconnaît un brouillon du tour actif", () => {
    const storage = new MemoryBrowserStorage();

    expect(writeStoredDrawingDraft(DRAWING_DRAFT, storage)).toBe(true);
    const restored = readStoredDrawingDraft(storage);

    expect(restored).toEqual(DRAWING_DRAFT);
    expect(
      restored === null
        ? false
        : matchesDrawingDraftContext(restored, DRAWING_DRAFT),
    ).toBe(true);
  });

  it("refuse le contexte d'un autre tour", () => {
    expect(
      matchesDrawingDraftContext(DRAWING_DRAFT, {
        roomCode: DRAWING_DRAFT.roomCode,
        gameId: DRAWING_DRAFT.gameId,
        turnId: "turn-2",
        playerId: DRAWING_DRAFT.playerId,
      }),
    ).toBe(false);
  });

  it("supprime un brouillon de dessin corrompu", () => {
    const storage = new MemoryBrowserStorage();
    const corruptedDraft = structuredClone(DRAWING_DRAFT);
    corruptedDraft.drawing.strokes[0]!.points[0]!.x = 2;
    storage.setItem(
      STORED_DRAWING_DRAFT_KEY,
      JSON.stringify(corruptedDraft),
    );

    expect(readStoredDrawingDraft(storage)).toBeNull();
    expect(storage.getItem(STORED_DRAWING_DRAFT_KEY)).toBeNull();
  });
});

describe("stored guess draft", () => {
  it("écrit, relit et reconnaît une sélection locale valide", () => {
    const storage = new MemoryBrowserStorage();

    expect(writeStoredGuessDraft(GUESS_DRAFT, storage)).toBe(true);
    const restored = readStoredGuessDraft(storage);

    expect(restored).toEqual(GUESS_DRAFT);
    expect(
      restored === null
        ? false
        : matchesGuessDraftContext(restored, GUESS_DRAFT),
    ).toBe(true);
  });

  it("refuse un brouillon provenant d'un autre contexte", () => {
    expect(
      matchesGuessDraftContext(GUESS_DRAFT, {
        roomCode: GUESS_DRAFT.roomCode,
        gameId: "game-2",
        turnId: GUESS_DRAFT.turnId,
        playerId: GUESS_DRAFT.playerId,
      }),
    ).toBe(false);
  });
});

describe("stored client state cleanup", () => {
  it("efface indépendamment la session et les deux brouillons", () => {
    const storage = new MemoryBrowserStorage();
    expect(writeStoredSession(SESSION, storage)).toBe(true);
    expect(writeStoredDrawingDraft(DRAWING_DRAFT, storage)).toBe(true);
    expect(writeStoredGuessDraft(GUESS_DRAFT, storage)).toBe(true);

    clearStoredSession(storage);
    clearStoredDrawingDraft(storage);
    clearStoredGuessDraft(storage);

    expect(storage.getItem(STORED_SESSION_KEY)).toBeNull();
    expect(storage.getItem(STORED_DRAWING_DRAFT_KEY)).toBeNull();
    expect(storage.getItem(STORED_GUESS_DRAFT_KEY)).toBeNull();
  });
});
