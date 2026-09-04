import { describe, expect, it } from "vitest";

import { evaluateScreenshotMatrixVisualEvidence } from "../scripts/screenshot-matrix-evidence.mjs";

describe("screenshot matrix visual evidence", () => {
  it("reports but accepts cross-locale and zoom-only matching hashes", () => {
    const evidence = evaluateScreenshotMatrixVisualEvidence([
      {
        id: "en-base",
        locale: "en",
        resolvedTheme: "light",
        width: 1_440,
        height: 900,
        screenshotSha256: "cross-locale",
      },
      {
        id: "fr-base",
        locale: "fr",
        resolvedTheme: "light",
        width: 1_440,
        height: 900,
        screenshotSha256: "cross-locale",
      },
      {
        id: "ar-base",
        locale: "ar",
        resolvedTheme: "dark",
        width: 1_440,
        height: 900,
        screenshotSha256: "zoom-only",
      },
      {
        id: "ar-dark-125",
        locale: "ar",
        resolvedTheme: "dark",
        width: 1_440,
        height: 900,
        screenshotSha256: "zoom-only",
      },
    ]);

    expect(evidence.violations).toEqual([]);
    expect(evidence.distinctScreenshotCount).toBe(2);
    expect(evidence.duplicateGroups).toEqual([
      {
        screenshotSha256: "cross-locale",
        variantIds: ["en-base", "fr-base"],
      },
      {
        screenshotSha256: "zoom-only",
        variantIds: ["ar-base", "ar-dark-125"],
      },
    ]);
    expect(evidence.requiredDistinctPairs).toEqual([]);
  });

  it("rejects a matching hash across resolved themes in one locale", () => {
    const evidence = evaluateScreenshotMatrixVisualEvidence([
      {
        id: "en-light",
        locale: "en",
        resolvedTheme: "light",
        width: 1_440,
        height: 900,
        screenshotSha256: "shared",
      },
      {
        id: "en-dark",
        locale: "en",
        resolvedTheme: "dark",
        width: 1_440,
        height: 900,
        screenshotSha256: "shared",
      },
    ]);

    expect(evidence.violations).toEqual([
      "en-light and en-dark share a screenshot despite different resolved-theme",
    ]);
    expect(evidence.requiredDistinctPairs).toEqual([
      {
        variantIds: ["en-light", "en-dark"],
        reasons: ["resolved-theme"],
        passed: false,
      },
    ]);
  });

  it("rejects a matching hash across physical viewports in one locale", () => {
    const evidence = evaluateScreenshotMatrixVisualEvidence([
      {
        id: "en-wide",
        locale: "en",
        resolvedTheme: "light",
        width: 1_440,
        height: 900,
        screenshotSha256: "shared",
      },
      {
        id: "en-narrow",
        locale: "en",
        resolvedTheme: "light",
        width: 980,
        height: 720,
        screenshotSha256: "shared",
      },
    ]);

    expect(evidence.violations).toEqual([
      "en-wide and en-narrow share a screenshot despite different physical-viewport",
    ]);
    expect(evidence.requiredDistinctPairs[0]).toEqual({
      variantIds: ["en-wide", "en-narrow"],
      reasons: ["physical-viewport"],
      passed: false,
    });
  });
});
