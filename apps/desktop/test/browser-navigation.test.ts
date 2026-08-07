import { describe, expect, it } from "vitest";

import { normalizeBrowserAddress } from "../src/renderer/browser-navigation.js";

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
