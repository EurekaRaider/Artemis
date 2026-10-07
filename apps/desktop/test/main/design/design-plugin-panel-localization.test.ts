import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "@artemis/protocol";
import { designPanelLocaleMessage } from "../../../src/shared/i18n/design-panel-copy.js";

const html = readFileSync(
  new URL(
    "../../../resources/design-plugins/artemis-design/panel/index.html",
    import.meta.url,
  ),
  "utf8",
);

describe("Design panel localization", () => {
  it("switches all 14 languages in an open panel without rewriting user content", async () => {
    const errors: unknown[] = [];
    const console = new VirtualConsole();
    console.on("jsdomError", (error) => errors.push(error));
    const dom = new JSDOM(html, {
      runScripts: "dangerously",
      pretendToBeVisual: true,
      virtualConsole: console,
      beforeParse(window) {
        window.matchMedia = (() => ({
          matches: false,
          addEventListener() {},
          removeEventListener() {},
        })) as typeof window.matchMedia;
        window.ResizeObserver = class {
          observe() {}
          disconnect() {}
        };
        window.HTMLElement.prototype.scrollIntoView = () => {};
      },
    });
    const { window } = dom;
    const sent: any[] = [];
    let fromHost: (event: { data: unknown }) => void = () => {};
    const port = {
      start() {},
      postMessage(message: unknown) {
        sent.push(message);
      },
      addEventListener(_name: string, listener: typeof fromHost) {
        fromHost = listener;
      },
    };
    const event = new window.Event("artemis:port");
    Object.assign(event, { ports: [port] });
    window.dispatchEvent(event);
    try {
      fromHost({ data: designPanelLocaleMessage("en") });
      fromHost({
        data: {
          type: "snapshot",
          snapshot: {
            documents: [],
            projectFiles: [
              {
                path: "用户页面.html",
                bytes: 300,
                updatedAt: new Date().toISOString(),
              },
            ],
          },
        },
      });
      expect(
        window.document.querySelector(".design-file-name")?.textContent,
      ).toBe("用户页面.html");
      const draft =
        window.document.querySelector<HTMLTextAreaElement>("#dzNoteInput")!;
      expect(draft).toBeTruthy();
      draft.value = "Keep this user draft 原文";
      for (const locale of APP_LOCALES) {
        fromHost({ data: designPanelLocaleMessage(locale) });
        await Promise.resolve();
        expect(window.document.documentElement.lang).toBe(locale);
        expect(window.document.documentElement.dir).toBe(
          locale === "ar" ? "rtl" : "ltr",
        );
        expect(
          window.document
            .querySelector(".design-panel-root")
            ?.hasAttribute("data-localizing"),
        ).toBe(false);
        const messages = designPanelLocaleMessage(locale).messages;
        for (const node of window.document.querySelectorAll<HTMLElement>(
          "[data-dz-i18n]",
        )) {
          const key = node.dataset.dzI18n!;
          expect(messages[key], `${locale}:${key}`).toBeTruthy();
          if (node.parentElement?.id !== "dzDeviceLabel")
            expect(node.textContent, `${locale}:${key}`).toBe(messages[key]);
        }
        expect(
          window.document.querySelector(".design-file-name")?.textContent,
        ).toBe("用户页面.html");
        expect(draft.value).toBe("Keep this user draft 原文");
      }
      window.document.querySelector<HTMLButtonElement>("#dzStartBtn")!.click();
      const candidate = sent.findLast(
        (message) => message.type === "candidate-prompt",
      );
      expect(candidate?.text).toBe(
        designPanelLocaleMessage("id").messages.newDesignPrompt,
      );
      expect(errors).toEqual([]);
    } finally {
      window.close();
    }
  });
});
