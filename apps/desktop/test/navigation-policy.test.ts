import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  externalHttpUrl,
  isRendererNavigationAllowed,
} from "../src/main/navigation-policy.js";

const mainSource = readFileSync(
  fileURLToPath(new URL("../src/main/main.ts", import.meta.url)),
  "utf8",
);

describe("renderer navigation policy", () => {
  it("allows only the packaged renderer entry in production", () => {
    const entry = "file:///D:/Artemis/resources/app.asar/index.html";

    expect(isRendererNavigationAllowed(entry, entry, false)).toBe(true);
    expect(
      isRendererNavigationAllowed(
        "file:///D:/Artemis/secrets.html",
        entry,
        false,
      ),
    ).toBe(false);
    expect(
      isRendererNavigationAllowed("https://example.com/", entry, false),
    ).toBe(false);
  });

  it("allows the configured development origin only", () => {
    const entry = "http://127.0.0.1:5173/";

    expect(
      isRendererNavigationAllowed(
        "http://127.0.0.1:5173/thread/123",
        entry,
        true,
      ),
    ).toBe(true);
    expect(
      isRendererNavigationAllowed("http://localhost:5173/", entry, true),
    ).toBe(false);
  });

  it("accepts only HTTP and HTTPS URLs for external opening", () => {
    expect(externalHttpUrl("https://drive.google.com/drive/folders/abc")).toBe(
      "https://drive.google.com/drive/folders/abc",
    );
    expect(externalHttpUrl("HTTP://example.com/path")).toBe(
      "http://example.com/path",
    );
    expect(externalHttpUrl("mailto:owner@example.com")).toBeUndefined();
    expect(externalHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(externalHttpUrl("not a URL")).toBeUndefined();
  });

  it("opens and copies validated links from the native context menu", () => {
    expect(mainSource).toContain('window.webContents.on("context-menu"');
    expect(mainSource).toContain("Menu.buildFromTemplate(");
    expect(mainSource).toContain("shell.openExternal(linkUrl)");
    expect(mainSource).toContain("clipboard.writeText(linkUrl)");
    expect(mainSource).toContain('mainText(locale, "openLink")');
    expect(mainSource).toContain('mainText(locale, "copyLink")');
  });
});

it("allows only the built-in PDF viewer's own child stream", async () => {
  const { isPdfViewerStreamNavigationAllowed: allowed } =
    await import("../src/main/navigation-policy.js");
  const origin = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai";
  const stream = `${origin}/89ca1d7b-9440-4cdf-841f-c1d2a865b770`;
  expect(allowed(stream, `${origin}/index.html`, false)).toBe(true);
  expect(allowed(stream, `${origin}/index.html`, true)).toBe(false);
  expect(allowed(stream, "https://example.com", false)).toBe(false);
  expect(allowed("file:///secret.pdf", `${origin}/index.html`, false)).toBe(
    false,
  );
  expect(
    allowed("chrome-extension://other/stream", `${origin}/index.html`, false),
  ).toBe(false);
  expect(allowed(`${origin}/index.html`, `${origin}/index.html`, false)).toBe(
    false,
  );
});
