import { describe, expect, it } from "vitest";
import {
  parseMaterialPreference,
  shouldUseSolidMaterial,
} from "../../src/shared/window-material.js";

const preferences = {
  material: "glass" as const,
  reducedTransparency: false,
  highContrast: false,
  forcedColors: false,
};
describe("interface material accessibility", () => {
  it("keeps the glass preference unless opacity is requested", () => {
    expect(shouldUseSolidMaterial(preferences)).toBe(false);
    expect(shouldUseSolidMaterial({ ...preferences, material: "solid" })).toBe(
      true,
    );
  });
  it.each(["reducedTransparency", "highContrast", "forcedColors"] as const)(
    "gives the system %s preference priority over glass",
    (key) => {
      expect(shouldUseSolidMaterial({ ...preferences, [key]: true })).toBe(
        true,
      );
    },
  );
  it.each([undefined, null, 0, {}, "transparent"])(
    "rejects unsupported material %j at the host boundary",
    (value) => {
      expect(() => parseMaterialPreference(value)).toThrow(
        "Invalid interface material",
      );
    },
  );
});
