import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { macosAppRuntimeReadOnlyPaths } from "../src/main/macos-app-runtime.js";

const mcpClientManagerSource = readFileSync(
  new URL("../src/main/mcp-client-manager.ts", import.meta.url),
  "utf8",
);
const trustedExtensionManagerSource = readFileSync(
  new URL("../src/main/trusted-extension-manager.ts", import.meta.url),
  "utf8",
);

describe("macOS app runtime sandbox paths", () => {
  it("allows only the packaged Electron runtime directories", () => {
    expect(
      macosAppRuntimeReadOnlyPaths(
        "darwin",
        "/Applications/Artemis.app/Contents/MacOS/Artemis",
      ),
    ).toEqual([
      "/Applications/Artemis.app/Contents/MacOS",
      "/Applications/Artemis.app/Contents/Frameworks",
      "/Applications/Artemis.app/Contents/Resources",
    ]);
  });

  it("does not broaden ordinary executables or non-macOS platforms", () => {
    expect(
      macosAppRuntimeReadOnlyPaths("darwin", "/opt/homebrew/bin/node"),
    ).toEqual([]);
    expect(
      macosAppRuntimeReadOnlyPaths(
        "darwin",
        "/Applications/Artemis.app/Contents/Helpers/tool",
      ),
    ).toEqual([]);
    expect(
      macosAppRuntimeReadOnlyPaths(
        "win32",
        "/Applications/Artemis.app/Contents/MacOS/Artemis",
      ),
    ).toEqual([]);
  });

  it("applies the packaged runtime paths to MCP and trusted extensions", () => {
    expect(mcpClientManagerSource).toContain(
      "macosAppRuntimeReadOnlyPaths(platform, command.executable)",
    );
    expect(trustedExtensionManagerSource).toContain(
      "macosAppRuntimeReadOnlyPaths(this.platform, process.execPath)",
    );
  });
});
