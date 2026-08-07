import { describe, expect, it } from "vitest";

import {
  BROWSER_SESSION_PARTITION,
  browserAcceptLanguage,
  isRemoteBrowserUrl,
  shouldReloadBrowserForLocaleChange,
  withBrowserAcceptLanguage,
} from "../src/shared/browser-locale.js";

describe("browser locale negotiation", () => {
  it("maps each resolved Artemis locale to an ordered language preference", () => {
    expect(browserAcceptLanguage("zh-CN")).toBe(
      "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    );
    expect(browserAcceptLanguage("en")).toBe("en-US,en;q=0.9");
  });

  it("replaces Accept-Language case-insensitively and preserves other headers", () => {
    expect(
      withBrowserAcceptLanguage(
        {
          "accept-language": "fr-FR,fr;q=0.9",
          "Accept-Language": "de-DE,de;q=0.9",
          "X-Artemis-Test": "preserved",
        },
        "zh-CN",
      ),
    ).toEqual({
      "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
      "X-Artemis-Test": "preserved",
    });
  });

  it("adds Accept-Language when the request does not already have it", () => {
    expect(withBrowserAcceptLanguage({ Accept: "text/html" }, "en")).toEqual({
      Accept: "text/html",
      "Accept-Language": "en-US,en;q=0.9",
    });
  });

  it("recognizes only external HTTP and HTTPS pages", () => {
    expect(isRemoteBrowserUrl("https://example.com/path")).toBe(true);
    expect(isRemoteBrowserUrl("http://127.0.0.1:4173/")).toBe(true);
    expect(isRemoteBrowserUrl("data:text/html,hello")).toBe(false);
    expect(isRemoteBrowserUrl("about:blank")).toBe(false);
    expect(isRemoteBrowserUrl("not a URL")).toBe(false);
  });

  it("reloads only remote pages when the resolved locale changes", () => {
    expect(
      shouldReloadBrowserForLocaleChange("en", "zh-CN", "https://example.com/"),
    ).toBe(true);
    expect(
      shouldReloadBrowserForLocaleChange(
        "zh-CN",
        "zh-CN",
        "https://example.com/",
      ),
    ).toBe(false);
    expect(
      shouldReloadBrowserForLocaleChange("en", "zh-CN", "data:text/html,hello"),
    ).toBe(false);
    expect(
      shouldReloadBrowserForLocaleChange("en", "zh-CN", "about:blank"),
    ).toBe(false);
  });

  it("uses the same persistent partition as the Browser webview", () => {
    expect(BROWSER_SESSION_PARTITION).toBe("persist:artemis-browser");
  });
});
