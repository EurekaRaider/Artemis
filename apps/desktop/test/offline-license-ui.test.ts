import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
// @ts-expect-error The isolated license page runs plain browser JavaScript.
import { messages } from "../src/license/ui/locales.js";
const directory = new URL("../src/license/ui/", import.meta.url);
const html = readFileSync(new URL("index.html", directory), "utf8");
const script = readFileSync(new URL("ui.js", directory), "utf8").replace(
  'import { messages } from "./locales.js";',
  `const messages = ${JSON.stringify(messages)};`,
);
async function page(saved?: string, systemLanguage = "en-US") {
  const dom = new JSDOM(html, {
    url: `https://license.test?systemLanguage=${encodeURIComponent(systemLanguage)}`,
    runScripts: "outside-only",
  });
  const window = dom.window;
  if (saved) window.localStorage.setItem("artemis-license-language", saved);
  Object.assign(window, {
    license: {
      status: async () => ({
        state: "storage_error",
        device: "AM1-fixture",
        expiresAt: Date.UTC(2027, 0, 1),
      }),
      onStatus: () => {},
      activate: async () => {
        throw new Error("invalid_license");
      },
    },
  });
  window.eval(script);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return dom;
}
describe("offline activation language selection", () => {
  it.each([
    ["en-GB", "en"],
    ["zh-Hans-CN", "zh-CN"],
    ["zh-Hant-HK", "zh-TW"],
    ["ja-JP", "ja"],
    ["ko-KR", "ko"],
    ["es-419", "es"],
    ["fr-CA", "fr"],
    ["de-DE", "de"],
    ["pt-PT", "pt-BR"],
    ["it-IT", "it"],
    ["ru-RU", "ru"],
    ["ar-SA", "ar"],
    ["hi-IN", "hi"],
    ["id-ID", "id"],
    ["nl-NL", "en"],
    ["", "en"],
    ["FR_ca", "fr"],
  ])(
    "defaults OS language %s to %s even when Chromium uses English",
    async (systemLanguage, expected) => {
      const dom = await page(undefined, systemLanguage);
      try {
        expect(dom.window.document.documentElement.lang).toBe(expected);
        expect(
          dom.window.document.querySelector<HTMLSelectElement>("#language")!
            .value,
        ).toBe(expected);
      } finally {
        dom.window.close();
      }
    },
  );
  it("keeps a manually saved choice ahead of the OS default", async () => {
    const dom = await page("de", "ja-JP");
    try {
      expect(dom.window.document.documentElement.lang).toBe("de");
    } finally {
      dom.window.close();
    }
  });
  it("translates every supported language, errors, dates and title without losing user input", async () => {
    const dom = await page("zh-CN");
    try {
      const { document, Event } = dom.window;
      const selector = document.querySelector<HTMLSelectElement>("#language")!;
      const token = document.querySelector<HTMLTextAreaElement>("#token")!;
      token.value = "ART1.user-input";
      expect(selector.options).toHaveLength(14);
      for (const [locale, copy] of Object.entries(messages) as [
        string,
        Record<string, string>,
      ][]) {
        expect(Object.keys(copy).sort()).toEqual(
          Object.keys(messages.en).sort(),
        );
        selector.value = locale;
        selector.dispatchEvent(new Event("change"));
        expect(document.documentElement.lang).toBe(locale);
        expect(document.documentElement.dir).toBe(
          locale === "ar" ? "rtl" : "ltr",
        );
        expect(document.title).toBe(`Artemis · ${copy.title}`);
        expect(document.querySelector("h1")!.textContent).toBe(copy.heading);
        expect(document.querySelector("#status")!.textContent).toBe(
          copy.storage_error,
        );
        expect(document.querySelector("#expiry")!.textContent).not.toContain(
          "{date}",
        );
        expect(token.value).toBe("ART1.user-input");
        expect(
          dom.window.localStorage.getItem("artemis-license-language"),
        ).toBe(locale);
      }
    } finally {
      dom.window.close();
    }
  });
  it("restores the selection and translates an activation error again when switching", async () => {
    const dom = await page("de");
    try {
      const { document, Event } = dom.window;
      expect(document.documentElement.lang).toBe("de");
      document
        .querySelector("#activate")!
        .dispatchEvent(new Event("submit", { cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(document.querySelector("#status")!.textContent).toBe(
        messages.de.invalid_license,
      );
      const selector = document.querySelector<HTMLSelectElement>("#language")!;
      selector.value = "en";
      selector.dispatchEvent(new Event("change"));
      expect(document.querySelector("#status")!.textContent).toBe(
        messages.en.invalid_license,
      );
    } finally {
      dom.window.close();
    }
  });
});
