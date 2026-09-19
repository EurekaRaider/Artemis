import { APP_LOCALES } from "@artemis/protocol";
import { describe, expect, it } from "vitest";
import {
  localizedPluginCategory,
  localizedPluginText,
  parsePluginLocalizations,
} from "../src/shared/plugin-localization.js";

describe("plugin localization", () => {
  it.each(APP_LOCALES)(
    "selects the current %s translation without mutating cached metadata",
    (locale) => {
      const localizations = Object.fromEntries(
        APP_LOCALES.map((language) => [
          language,
          {
            displayName: `Plugin ${language}`,
            description: `Description ${language}`,
          },
        ]),
      );
      const plugin = {
        displayName: "Original",
        description: "Original description",
        localizations: parsePluginLocalizations(localizations),
      };
      const before = structuredClone(plugin);
      expect(localizedPluginText(plugin, locale)).toMatchObject(
        localizations[locale]!,
      );
      expect(localizedPluginText(plugin, "en").displayName).toBe("Plugin en");
      expect(plugin).toEqual(before);
    },
  );

  it("falls back per field to English and then to original metadata", () => {
    const plugin = {
      displayName: "Original",
      description: "Original description",
      shortDescription: "Original summary",
      localizations: parsePluginLocalizations({
        en: { displayName: "English" },
        ja: { description: "日本語の説明" },
      }),
    };
    expect(localizedPluginText(plugin, "ja")).toEqual({
      displayName: "English",
      description: "日本語の説明",
      shortDescription: "Original summary",
    });
    expect(localizedPluginText(plugin, "de").description).toBe(
      "Original description",
    );
    expect(localizedPluginText({ displayName: "Legacy" }, "zh-CN")).toEqual({
      displayName: "Legacy",
    });
    expect(parsePluginLocalizations(undefined)).toBeUndefined();
  });

  it.each([
    null,
    [],
    "text",
    { xx: {} },
    { en: [] },
    { en: { displayName: " " } },
    { en: { displayName: "x".repeat(121) } },
    { en: { description: "x".repeat(2001) } },
    { en: { shortDescription: "x".repeat(301) } },
    { en: { command: "ignored execution" } },
    { en: { defaultPrompt: "not an array" } },
    { en: { defaultPrompt: [null] } },
  ])("rejects malformed or excessive metadata: %j", (value) => {
    expect(() => parsePluginLocalizations(value)).toThrow(/Plugin/);
  });

  it("translates category labels without changing category identifiers", () => {
    expect(localizedPluginCategory("Communication", "zh-CN")).toBe("沟通");
    expect(localizedPluginCategory("Productivity", "ja")).toBe("仕事効率化");
    expect(localizedPluginCategory("Custom category", "ar")).toBe(
      "Custom category",
    );
  });
});
