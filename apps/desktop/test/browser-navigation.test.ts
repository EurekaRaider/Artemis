import { describe, expect, it, vi } from "vitest";

import {
  browserNavigationSnapshot,
  normalizeBrowserAddress,
} from "../src/renderer/browser-navigation.js";

describe("normalizeBrowserAddress", () => {
  it("adds HTTPS when the user enters a host without a scheme", () => {
    expect(normalizeBrowserAddress("example.com/docs")).toBe(
      "https://example.com/docs",
    );
  });

  it("keeps HTTP and HTTPS URLs", () => {
    expect(normalizeBrowserAddress("http://localhost:4173")).toBe(
      "http://localhost:4173/",
    );
    expect(normalizeBrowserAddress("https://example.com")).toBe(
      "https://example.com/",
    );
  });

  it.each(["javascript:alert(1)", "file:///C:/secret.txt", "data:text/html,x"])(
    "rejects non-web address %s",
    (address) => {
      expect(() => normalizeBrowserAddress(address)).toThrow(
        "Only HTTP and HTTPS addresses are supported.",
      );
    },
  );
});

describe("browserNavigationSnapshot", () => {
  it("does not call WebView methods before dom-ready", () => {
    const webview = {
      getURL: vi.fn(() => {
        throw new Error("The WebView is not ready.");
      }),
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
    };

    expect(browserNavigationSnapshot(webview, false)).toBeUndefined();
    expect(webview.getURL).not.toHaveBeenCalled();
    expect(webview.canGoBack).not.toHaveBeenCalled();
    expect(webview.canGoForward).not.toHaveBeenCalled();
  });

  it("reads navigation state after dom-ready and tolerates detachment races", () => {
    const webview = {
      getURL: vi.fn(() => "https://example.com/docs"),
      canGoBack: vi.fn(() => true),
      canGoForward: vi.fn(() => false),
    };

    expect(browserNavigationSnapshot(webview, true)).toEqual({
      url: "https://example.com/docs",
      canGoBack: true,
      canGoForward: false,
    });
    webview.getURL.mockImplementation(() => {
      throw new Error("The WebView was detached.");
    });
    expect(browserNavigationSnapshot(webview, true)).toBeUndefined();
  });
});
