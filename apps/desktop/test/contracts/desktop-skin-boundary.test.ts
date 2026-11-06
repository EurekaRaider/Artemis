import {
  readPreloadBridgeSources,
  readSharedApiSources,
} from "../fixtures/application/api-source.js";
import { readDesktopStyles } from "../fixtures/application/styles-source.js";
import { readRendererAppSources } from "../fixtures/application/renderer-source.js";
import { readMainProcessSources } from "../fixtures/application/main-source.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = (path: string) =>
  readFileSync(resolve(desktopRoot, path), "utf8");

describe("Desktop skin production boundaries", () => {
  it("keeps the production registry finite and public-package-only", () => {
    const registry = source("src/renderer/appearance/desktop-skin-registry.ts");
    expect(registry).toContain(
      'import artemisManifest from "@artemis/theme-artemis/manifest.json"',
    );
    expect(registry).not.toMatch(
      /synthetic-stress|stress-skin-fixture|ui-gallery|fixture|window\.|globalThis/iu,
    );
  });

  it("installs the public CSS and complete default before createRoot", () => {
    const main = source("src/renderer/main.tsx");
    expect(main).toContain('import "@artemis/theme-artemis/theme.css"');
    expect(main.indexOf("await bootstrapDesktopSkin()")).toBeGreaterThan(
      main.indexOf("const root"),
    );
    expect(main.indexOf("await bootstrapDesktopSkin()")).toBeLessThan(
      main.indexOf("createRoot(root)"),
    );

    const bootstrap = source(
      "src/renderer/appearance/desktop-skin-bootstrap.ts",
    );
    expect(
      bootstrap.indexOf("completeDesktopSkinTokenSnapshot("),
    ).toBeGreaterThan(bootstrap.indexOf("await desktopSkinHost.bootstrap("));
    expect(bootstrap.indexOf("completeDesktopSkinTokenSnapshot(")).toBeLessThan(
      bootstrap.indexOf("resolveReady?.()"),
    );

    const app = readRendererAppSources();
    expect(app).toContain("desktopSkinHost.setTheme(theme)");
    expect(app).toContain("desktopSkinReady.then(() => {");
    expect(app).toContain("window.artemis.rendererReady()");
    expect(app).not.toMatch(/dataset\.(?:artemisSkin|artemisTheme|theme)\s*=/u);
  });

  it("keeps the resolver attribute-only and outside persistence and IPC", () => {
    const resolver = source("src/renderer/appearance/desktop-skin.ts");
    const bootstrap = source(
      "src/renderer/appearance/desktop-skin-bootstrap.ts",
    );
    for (const productionSource of [resolver, bootstrap]) {
      expect(productionSource).not.toMatch(
        /localStorage|sessionStorage|indexedDB|ipcRenderer|window\.artemis|URLSearchParams|location\.search|setProperty\(/u,
      );
      expect(productionSource).not.toMatch(/document\.body/u);
      expect(productionSource).not.toMatch(/@artemis\/ui-gallery/u);
    }
    expect(resolver).not.toMatch(/@artemis\/protocol/u);
    expect(resolver).toContain("(prefers-color-scheme: dark)");
    expect(resolver).toContain("(prefers-contrast: more)");
    expect(resolver).toContain("(forced-colors: active)");
    expect(resolver).toContain("setContrast(");
  });

  it("does not branch JSX or Desktop CSS on a skin selector", () => {
    expect(readRendererAppSources()).not.toMatch(
      /data-artemis-skin|artemisSkin/u,
    );
    expect(readDesktopStyles("styles")).not.toMatch(/data-artemis-skin/u);
  });

  it("builds renderer theme packages before every direct Desktop entry", () => {
    const rootPackage = JSON.parse(source("../../package.json")) as {
      scripts: Record<string, string>;
    };
    const desktopPackage = JSON.parse(source("package.json")) as {
      scripts: Record<string, string>;
    };
    for (const name of ["build", "dev"]) {
      expect(desktopPackage.scripts[name], name).toContain(
        "npm run build:renderer-dependencies",
      );
    }
    expect(rootPackage.scripts["verify:desktop-skin"]).toContain(
      "npm run verify:desktop-skin -w @artemis/desktop",
    );
  });

  it("keeps native chrome outside the skin graph and Terminal behind public tokens", () => {
    const terminal = source("src/renderer/terminal/TerminalPanel.tsx");
    const mainProcess = readMainProcessSources();
    const preload = readPreloadBridgeSources();
    const sharedApi = readSharedApiSources();
    for (const productionSource of [mainProcess, preload, sharedApi]) {
      expect(productionSource).not.toMatch(
        /desktop-skin|artemisSkin|data-artemis-skin|theme-contract|theme-artemis/iu,
      );
    }
    expect(terminal).not.toMatch(
      /desktop-skin|artemisSkin|theme-contract|theme-artemis/iu,
    );
    expect(terminal).toContain('"data-artemis-skin"');
    expect(terminal).toContain('"--artemis-color-terminal-background"');
    expect(terminal).toContain('"--artemis-color-terminal-foreground"');
    expect(terminal).toContain("const terminalThemes = {");
    expect(terminal).toContain(".openTerminal({");
    expect(mainProcess).toContain("nativeTheme.themeSource =");
    expect(mainProcess).toContain("backgroundColor: windowBackgroundColor()");
  });

  it("uses stable PTY evidence across runtime layout transitions", () => {
    const verifier = source("scripts/verify/ui/verify-desktop-skin.mjs");
    const instrumentation = source(
      "test/fixtures/preload/desktop-skin-instrumentation.ts",
    );
    expect(instrumentation).toContain("terminalData: () => data");
    expect(instrumentation).toContain(".slice(-16_384)");
    expect(verifier).toContain("terminalPromptReceived");
    expect(verifier).toContain("export PS1='Ar''temis> '; clear");
    expect(verifier).toContain("initial rendered synthetic PTY prompt");
    expect(verifier).not.toContain(
      "synthetic PTY prompt after environment layout",
    );
  });

  it("keeps the temporary smoke preload aligned with renderer security evidence", () => {
    const preload = readPreloadBridgeSources();
    const verifier = source("scripts/verify/ui/verify-desktop-skin.mjs");
    for (const marker of [
      "contextIsolated: process.contextIsolated === true",
      "sandboxed: process.sandboxed === true",
    ]) {
      expect(preload).toContain(marker);
      expect(verifier).not.toContain(marker);
    }
    const instrumentation = source(
      "test/fixtures/preload/desktop-skin-instrumentation.ts",
    );
    expect(verifier).toContain("instrumentDesktopSkinPreload(api, webFrame)");
    expect(verifier).toMatch(/productionSource\.replace\(\s*exposure,/u);
    expect(instrumentation).toContain("return original.rendererReady(...args)");
    expect(instrumentation).not.toMatch(
      /ipcRenderer|contextIsolated|sandboxed/u,
    );
  });
});
