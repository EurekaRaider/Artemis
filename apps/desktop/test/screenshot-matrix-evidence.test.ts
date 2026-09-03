import { describe, expect, it } from "vitest";

import { evaluateScreenshotMatrixVisualEvidence } from "../scripts/screenshot-matrix-evidence.mjs";

describe("screenshot matrix visual evidence", () => {
  it("reports but accepts matching hashes across different locales", () => {
    const evidence = evaluateScreenshotMatrixVisualEvidence([
      { id: "en-base", locale: "en", screenshotSha256: "shared" },
      { id: "en-dark-125", locale: "en", screenshotSha256: "en-dark" },
      { id: "fr-base", locale: "fr", screenshotSha256: "shared" },
      { id: "fr-dark-125", locale: "fr", screenshotSha256: "fr-dark" },
    ]);

    expect(evidence.violations).toEqual([]);
    expect(evidence.distinctScreenshotCount).toBe(3);
    expect(evidence.duplicateGroups).toEqual([
      {
        screenshotSha256: "shared",
        variantIds: ["en-base", "fr-base"],
      },
    ]);
  });

  it("rejects matching hashes within a same-locale visual contract group", () => {
    const evidence = evaluateScreenshotMatrixVisualEvidence([
      { id: "en-base", locale: "en", screenshotSha256: "shared" },
      { id: "en-dark-125", locale: "en", screenshotSha256: "shared" },
      { id: "fr-base", locale: "fr", screenshotSha256: "shared" },
    ]);

    expect(evidence.violations).toEqual([
      "locale en: en-base, en-dark-125 share screenshot shared",
    ]);
    expect(evidence.requiredDistinctGroups).toEqual([
      {
        basis: "locale",
        value: "en",
        variantIds: ["en-base", "en-dark-125"],
        distinctScreenshotCount: 1,
        duplicateGroups: [
          {
            screenshotSha256: "shared",
            variantIds: ["en-base", "en-dark-125"],
          },
        ],
      },
    ]);
  });
});
