import { describe, expect, it } from "vitest";

import { APP_LOCALES } from "@artemis/protocol";

import {
  LOCALE_METADATA,
  SUPPORTED_LOCALES,
  localeDirection,
  matchKnownLocale,
  matchSupportedLocale,
  resolveAppLocale,
} from "../src/shared/locales.js";

describe("Artemis locales", () => {
  it("keeps metadata complete and aligned with the protocol", () => {
    expect(SUPPORTED_LOCALES).toEqual(APP_LOCALES);
    expect(Object.keys(LOCALE_METADATA)).toEqual([...APP_LOCALES]);
    for (const locale of APP_LOCALES) {
      expect(LOCALE_METADATA[locale]).toMatchObject({ id: locale });
      expect(LOCALE_METADATA[locale].nativeName.trim()).not.toBe("");
      expect(LOCALE_METADATA[locale].systemAliases.length).toBeGreaterThan(0);
      expect(LOCALE_METADATA[locale].acceptLanguage).toContain(
        locale.split("-", 1)[0],
      );
    }
  });

  it("matches exact, regional, underscore, and base-language variants", () => {
    expect(matchKnownLocale("de-DE")).toBe("de");
    expect(matchKnownLocale("pt_PT")).toBe("pt-BR");
    expect(matchKnownLocale("es-419")).toBe("es");
    expect(matchKnownLocale("ID-id")).toBe("id");
    expect(matchKnownLocale("nl-NL")).toBeUndefined();
    expect(matchSupportedLocale("fr-CA")).toBe("fr");
  });

  it("distinguishes Simplified and Traditional Chinese", () => {
    for (const locale of ["zh-Hans", "zh-CN", "zh-SG"]) {
      expect(matchKnownLocale(locale)).toBe("zh-CN");
    }
    for (const locale of ["zh-Hant", "zh-TW", "zh-HK", "zh-MO"]) {
      expect(matchKnownLocale(locale)).toBe("zh-TW");
    }
  });

  it("uses the first supported system preference and falls back to English", () => {
    expect(resolveAppLocale("system", ["nl-NL", "fr-CA", "en-US"])).toBe("fr");
    expect(resolveAppLocale("system", ["not_a_locale", "uk-UA"])).toBe("en");
    expect(resolveAppLocale("ja", ["fr-FR"])).toBe("ja");
  });

  it("marks only Arabic as right-to-left", () => {
    expect(localeDirection("ar")).toBe("rtl");
    for (const locale of APP_LOCALES.filter(
      (candidate) => candidate !== "ar",
    )) {
      expect(localeDirection(locale)).toBe("ltr");
    }
  });
});
