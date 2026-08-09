import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "@artemis/protocol";

import { mainText } from "../src/main/i18n.js";
import { I18N_RESOURCES } from "../src/shared/i18n-resources.js";

describe("i18n resources", () => {
  it("provides the same non-empty keys for every locale and namespace", () => {
    const namespaces = Object.keys(I18N_RESOURCES.en) as Array<
      keyof (typeof I18N_RESOURCES)["en"]
    >;
    for (const locale of APP_LOCALES) {
      expect(Object.keys(I18N_RESOURCES[locale])).toEqual(namespaces);
      for (const namespace of namespaces) {
        expect(Object.keys(I18N_RESOURCES[locale][namespace])).toEqual(
          Object.keys(I18N_RESOURCES.en[namespace]),
        );
        for (const value of Object.values(I18N_RESOURCES[locale][namespace])) {
          expect(value.trim()).not.toBe("");
        }
      }
    }
  });

  it("keeps interpolation placeholders aligned with English", () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/gu)]
        .map((match) => match[1])
        .sort();
    for (const locale of APP_LOCALES) {
      for (const namespace of Object.keys(I18N_RESOURCES.en) as Array<
        keyof (typeof I18N_RESOURCES)["en"]
      >) {
        for (const [key, source] of Object.entries(
          I18N_RESOURCES.en[namespace],
        )) {
          const translated = (
            I18N_RESOURCES[locale][namespace] as Record<string, string>
          )[key]!;
          expect(
            placeholders(translated),
            `${locale}.${namespace}.${key}`,
          ).toEqual(placeholders(source));
        }
      }
    }
  });

  it("does not expose English fallback copy for localized core prose", () => {
    const critical = [
      ["app", "emptyTitle"],
      ["settings", "languageDetail"],
      ["automations", "subtitle"],
      ["resources", "marketDescription"],
      ["main", "automationAuthorizationDetail"],
    ] as const;
    for (const locale of APP_LOCALES.filter((value) => value !== "en")) {
      for (const [namespace, key] of critical) {
        expect(
          (I18N_RESOURCES[locale][namespace] as Record<string, string>)[key],
          `${locale}.${namespace}.${key}`,
        ).not.toBe(
          (I18N_RESOURCES.en[namespace] as Record<string, string>)[key],
        );
      }
    }
  });

  it("keeps i18next plural forms paired when a namespace adds them", () => {
    for (const locale of APP_LOCALES) {
      for (const namespace of Object.values(I18N_RESOURCES[locale])) {
        const keys = new Set(Object.keys(namespace));
        for (const key of keys) {
          if (key.endsWith("_one")) {
            expect(keys.has(`${key.slice(0, -4)}_other`)).toBe(true);
          }
        }
      }
    }
  });

  it("keeps main-process translation lookup fixed to the requested locale", () => {
    expect(mainText("en", "openLink")).toBe("Open Link");
    expect(mainText("zh-TW", "openLink")).toBe("開啟連結");
    expect(mainText("de", "copyLink")).toBe("Link kopieren");
    expect(mainText("ar", "newTask")).toBe("مهمة جديدة");
  });
});
