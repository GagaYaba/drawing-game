import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  hashSessionToken,
  isValidSessionToken,
  SESSION_TOKEN_ENCODED_LENGTH,
  verifySessionToken,
} from "../src/sessions/session-token.js";

describe("session tokens", () => {
  it("génère des jetons privés imprévisibles au format base64url", () => {
    const first = createSessionToken();
    const second = createSessionToken();

    expect(first).toHaveLength(SESSION_TOKEN_ENCODED_LENGTH);
    expect(second).toHaveLength(SESSION_TOKEN_ENCODED_LENGTH);
    expect(isValidSessionToken(first)).toBe(true);
    expect(isValidSessionToken(second)).toBe(true);
    expect(second).not.toBe(first);
  });

  it("stocke un hash SHA-256 et vérifie le jeton sans conserver le brut", () => {
    const token = createSessionToken();
    const hash = hashSessionToken(token);

    expect(hash).not.toBe(token);
    expect(hash).toHaveLength(SESSION_TOKEN_ENCODED_LENGTH);
    expect(verifySessionToken(token, hash)).toBe(true);
    expect(verifySessionToken(createSessionToken(), hash)).toBe(false);
    expect(verifySessionToken(token, "hash-invalide")).toBe(false);
  });
});
