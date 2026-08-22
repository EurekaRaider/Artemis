import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "@artemis/protocol";

import { mainText } from "../src/main/i18n.js";
import { I18N_RESOURCES, localizedCopy } from "../src/shared/i18n-resources.js";

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
      ["app", "temporaryConversationPrompt"],
      ["app", "goalCommandDetail"],
      ["app", "compactCommandDetail"],
      ["app", "initCommandDetail"],
      ["app", "planCommandDetail"],
      ["app", "executeCommandDetail"],
      ["app", "reviewCommandDetail"],
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

  it("keeps the Artemis brand unchanged in every temporary welcome", () => {
    for (const locale of APP_LOCALES) {
      expect(
        I18N_RESOURCES[locale].app.temporaryConversationPrompt,
        locale,
      ).toContain("Artemis");
    }
  });

  it("localizes slash descriptions while preserving command keywords", () => {
    const fallback = {
      goalCommand: "/goal",
      goalCommandDetail: "Set a persistent task goal",
      compactCommand: "/compact",
      compactCommandDetail: "Summarize older context now",
      initCommand: "/init",
      initCommandDetail: "Create a project-level AGENTS.md file",
      planCommand: "/plan",
      planCommandDetail: "Switch to Plan mode",
      executeCommand: "/execute",
      executeCommandDetail: "Switch to Execute mode",
      reviewCommand: "/review",
      reviewCommandDetail: "Switch to Review mode",
    };

    for (const locale of APP_LOCALES) {
      const copy = localizedCopy(locale, "app", fallback);
      expect(copy.goalCommand).toBe("/goal");
      expect(copy.compactCommand).toBe("/compact");
      expect(copy.initCommand).toBe("/init");
      expect(copy.planCommand).toBe("/plan");
      expect(copy.executeCommand).toBe("/execute");
      expect(copy.reviewCommand).toBe("/review");
      if (locale !== "en") {
        expect(copy.goalCommandDetail).not.toBe(fallback.goalCommandDetail);
        expect(copy.compactCommandDetail).not.toBe(
          fallback.compactCommandDetail,
        );
        expect(copy.initCommandDetail).not.toBe(fallback.initCommandDetail);
        expect(copy.planCommandDetail).not.toBe(fallback.planCommandDetail);
        expect(copy.executeCommandDetail).not.toBe(
          fallback.executeCommandDetail,
        );
        expect(copy.reviewCommandDetail).not.toBe(fallback.reviewCommandDetail);
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
