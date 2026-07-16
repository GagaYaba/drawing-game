import { existsSync, readFileSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

const CLIENT_INDEX_URL = new URL("../../client/index.html", import.meta.url);

describe("client favicon", () => {
  it("référence un PNG public réel plutôt que la route favicon absente", () => {
    const indexHtml = readFileSync(CLIENT_INDEX_URL, "utf8");
    const href = indexHtml.match(
      /<link[\s\S]*?rel="icon"[\s\S]*?href="([^"]+)"/u,
    )?.[1];

    expect(href).toBe("/favicon.png");

    const faviconUrl = new URL(
      `../../client/public${href ?? ""}`,
      import.meta.url,
    );
    expect(existsSync(faviconUrl)).toBe(true);
    expect(statSync(faviconUrl).size).toBeGreaterThan(0);

    const signature = readFileSync(faviconUrl).subarray(0, 8);
    expect([...signature]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    const legacyFaviconUrl = new URL(
      "../../client/public/favicon.ico",
      import.meta.url,
    );
    expect(existsSync(legacyFaviconUrl)).toBe(true);
    expect([...readFileSync(legacyFaviconUrl).subarray(0, 4)]).toEqual([
      0x00, 0x00, 0x01, 0x00,
    ]);
  });
});
