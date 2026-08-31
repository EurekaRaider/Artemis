import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  validateSkinIntegrity,
  validateSkinPackage,
  type SkinIntegrity,
} from "@artemis/theme-contract";
import {
  artemisContrastTokens,
  artemisDarkTokens,
  artemisLightTokens,
  artemisThemeCss,
  artemisThemeFallbackTokens,
  artemisThemeManifest,
  artemisTokenDocuments,
} from "../src/index.js";

describe("default Artemis skin scaffold", () => {
  it("is a complete, compatible, validated token package", () => {
    const report = validateSkinPackage({
      manifest: artemisThemeManifest,
      tokenDocuments: artemisTokenDocuments,
    });
    expect(report.valid).toBe(true);
    expect(report.value?.modes).toHaveLength(4);
    expect(artemisThemeFallbackTokens).toEqual([
      "color.overlay.scrim",
      "color.selection.background",
      "color.selection.text",
      "opacity.disabled",
      "radius.pill",
      "shadow.overlay",
    ]);
  });

  it("generates only controlled root selectors and namespaced properties", () => {
    expect(artemisThemeCss).not.toMatch(/url\s*\(|@import|javascript:/iu);
    const meaningfulLines = artemisThemeCss
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const selectorLines = meaningfulLines.filter((line) => line.endsWith("{"));
    expect(selectorLines).toHaveLength(5);
    expect(selectorLines[0]).toBe("@layer artemis.theme {");
    for (const selector of selectorLines.slice(1)) {
      expect(selector).toMatch(
        /^:root\[data-artemis-skin="com\.artemis\.default"\]\[data-artemis-theme="(?:light|dark)"\]\[data-artemis-contrast="(?:normal|high)"\] \{$/u,
      );
    }
    for (const line of meaningfulLines) {
      if (line.startsWith("--")) {
        expect(line).toMatch(/^--artemis-[a-z0-9-]+: [^;]+;$/u);
      }
    }
  });

  it("writes public JSON/CSS artifacts from the validated exports", () => {
    const dist = fileURLToPath(new URL("../dist/", import.meta.url));
    const json = (relative: string) =>
      JSON.parse(readFileSync(`${dist}${relative}`, "utf8")) as unknown;
    expect(json("manifest.json")).toEqual(artemisThemeManifest);
    expect(json("tokens.light.json")).toEqual(artemisLightTokens);
    expect(json("tokens.dark.json")).toEqual(artemisDarkTokens);
    expect(json("tokens.contrast.json")).toEqual(artemisContrastTokens);
    const integrity = json("integrity.json") as SkinIntegrity;
    expect(validateSkinIntegrity(integrity, artemisThemeManifest).valid).toBe(
      true,
    );
    expect(Object.keys(integrity.files).sort()).toEqual(
      [
        "manifest.json",
        "tokens.light.json",
        "tokens.dark.json",
        "tokens.contrast.json",
      ].sort(),
    );
    for (const [file, expectedHash] of Object.entries(integrity.files)) {
      const actualHash = createHash("sha256")
        .update(readFileSync(`${dist}${file}`))
        .digest("hex");
      expect(actualHash).toBe(expectedHash);
    }
    expect(readFileSync(`${dist}theme.css`, "utf8")).toBe(artemisThemeCss);
  });
});
