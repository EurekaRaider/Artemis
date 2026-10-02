import { describe, expect, it } from "vitest";
import {
  artemisThemeManifest,
  artemisTokenDocuments,
  artemisThemeCss,
} from "../../theme-artemis/src/index.js";
import { generateSkinCss } from "../src/css.js";
import { validateSkinManifest } from "../src/validate.js";
import {
  validateVisualSkinPackage,
  validateVisualSkinIntegrity,
} from "../src/visual-skin.js";

function fixture() {
  return {
    manifest: {
      ...artemisThemeManifest,
      schemaVersion: 2,
      assets: {
        wallpaper: { path: "assets/light.webp", kind: "image" },
        poster: { path: "assets/poster.png", kind: "image" },
        video: { path: "assets/dark.webm", kind: "video" },
        font: { path: "assets/ui.woff2", kind: "font" },
      },
      backgrounds: {
        light: {
          type: "image",
          asset: "wallpaper",
          fit: "cover",
          position: [50, 50],
          opacity: 0.3,
          blur: 0,
          scrim: "#00000000",
        },
        dark: {
          type: "video",
          asset: "video",
          poster: "poster",
          fit: "cover",
          position: [50, 50],
          opacity: 0.3,
          blur: 0,
          scrim: "#00000000",
        },
      },
      fonts: { ui: [{ asset: "font", weight: 400, style: "normal" }] },
      icons: "icons.json",
      motion: "motion.json",
    },
    tokenDocuments: artemisTokenDocuments,
    icons: {
      schemaVersion: 1,
      icons: { send: [{ type: "path", d: "M2 2L22 12L2 22Z", fill: true }] },
    },
    motion: {
      schemaVersion: 1,
      targets: {
        background: { preset: "float", duration: 500, distance: 8, loop: true },
      },
    },
  };
}

describe("Skin v2 visual contract", () => {
  it("produces the unchanged default CSS", () => {
    const report = validateVisualSkinPackage({
      manifest: artemisThemeManifest,
      tokenDocuments: artemisTokenDocuments,
    });
    expect(generateSkinCss(report.value!)).toBe(artemisThemeCss);
  });
  it("accepts resources while the original v1 validator still rejects them", () => {
    const input = fixture();
    expect(validateVisualSkinPackage(input).valid).toBe(true);
    expect(validateSkinManifest(input.manifest).valid).toBe(false);
  });
  it.each([
    "../outside.webp",
    "/tmp/a.webp",
    "https://example.com/a.webp",
    "assets/a\\b.webp",
    "assets/%2e%2e/a.webp",
  ])("rejects unsafe path %s", (path) => {
    const input = fixture();
    input.manifest.assets.wallpaper.path = path;
    expect(validateVisualSkinPackage(input).valid).toBe(false);
  });
  it("requires poster and declared resource kinds", () => {
    const input = fixture();
    input.manifest.backgrounds.dark.poster = "video";
    expect(validateVisualSkinPackage(input).valid).toBe(false);
  });
  it("keeps brand logos outside skin icon contributions", () => {
    const input = fixture();
    expect(
      validateVisualSkinPackage({
        ...input,
        icons: {
          schemaVersion: 1,
          icons: { artemis: [{ type: "path", d: "M0 0 L24 24" }] },
        },
      }).valid,
    ).toBe(false);
  });
  it("rejects arbitrary styles, executable geometry and unbounded movement", () => {
    const input = fixture();
    expect(
      validateVisualSkinPackage({
        ...input,
        icons: {
          schemaVersion: 1,
          icons: { send: [{ type: "path", d: "M0 0", onload: "evil()" }] },
        },
      }).valid,
    ).toBe(false);
    expect(
      validateVisualSkinPackage({
        ...input,
        motion: {
          schemaVersion: 1,
          targets: {
            surface: {
              preset: "slide",
              duration: 501,
              distance: 13,
              loop: true,
            },
          },
        },
      }).valid,
    ).toBe(false);
    expect(
      validateVisualSkinPackage({
        ...input,
        manifest: { ...input.manifest, css: "body{}" },
      }).valid,
    ).toBe(false);
  });
  it("requires integrity to cover exactly every declared file", () => {
    const manifest = fixture().manifest;
    const files = Object.fromEntries(
      [
        "manifest.json",
        ...Object.values(manifest.tokens),
        "icons.json",
        "motion.json",
        ...Object.values(manifest.assets).map((a) => a.path),
      ].map((p) => [p, "a".repeat(64)]),
    );
    expect(
      validateVisualSkinIntegrity(
        { schemaVersion: 2, algorithm: "sha256", files },
        manifest,
      ).valid,
    ).toBe(true);
    delete files["assets/dark.webm"];
    expect(
      validateVisualSkinIntegrity(
        { schemaVersion: 2, algorithm: "sha256", files },
        manifest,
      ).valid,
    ).toBe(false);
  });
});
