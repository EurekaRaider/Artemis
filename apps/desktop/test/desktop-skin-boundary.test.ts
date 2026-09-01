import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) =>
  readFileSync(resolve(desktopRoot, path), "utf8");

describe("Desktop skin production boundaries", () => {
  it("keeps the production registry finite and public-package-only", () => {
    const registry = source("src/renderer/desktop-skin-registry.ts");
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

    const bootstrap = source("src/renderer/desktop-skin-bootstrap.ts");
    expect(
      bootstrap.indexOf("completeDesktopSkinTokenSnapshot("),
    ).toBeGreaterThan(bootstrap.indexOf("await desktopSkinHost.bootstrap("));
    expect(bootstrap.indexOf("completeDesktopSkinTokenSnapshot(")).toBeLessThan(
      bootstrap.indexOf("resolveReady?.()"),
    );

    const app = source("src/renderer/App.tsx");
    expect(app).toContain("desktopSkinHost.setTheme(theme)");
    expect(app).toContain("desktopSkinReady.then(() => {");
    expect(app).toContain("window.artemis.rendererReady()");
    expect(app).not.toMatch(/dataset\.(?:artemisSkin|artemisTheme|theme)\s*=/u);
  });

  it("keeps the resolver attribute-only and outside persistence and IPC", () => {
    const resolver = source("src/renderer/desktop-skin.ts");
    const bootstrap = source("src/renderer/desktop-skin-bootstrap.ts");
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
    expect(source("src/renderer/App.tsx")).not.toMatch(
      /data-artemis-skin|artemisSkin/u,
    );
    expect(source("src/renderer/styles.css")).not.toMatch(/data-artemis-skin/u);
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

  it("leaves Terminal and native chrome outside the skin dependency graph", () => {
    const terminal = source("src/renderer/TerminalPanel.tsx");
    const mainProcess = source("src/main/main.ts");
    const preload = source("src/preload/preload.ts");
    const sharedApi = source("src/shared/api.ts");
    for (const productionSource of [
      terminal,
      mainProcess,
      preload,
      sharedApi,
    ]) {
      expect(productionSource).not.toMatch(
        /desktop-skin|artemisSkin|data-artemis-skin|theme-contract|theme-artemis/iu,
      );
    }
    expect(terminal).toContain("const terminalThemes = {");
    expect(terminal).toContain(".openTerminal({");
    expect(mainProcess).toContain("nativeTheme.themeSource =");
    expect(mainProcess).toContain("backgroundColor: windowBackgroundColor()");
  });

  it("uses stable PTY evidence across runtime layout transitions", () => {
    const verifier = source("scripts/verify-desktop-skin.mjs");
    expect(verifier).toContain("desktopSkinSmokeTerminalData");
    expect(verifier).toContain("terminalPromptReceived");
    expect(verifier).toContain("export PS1='Ar''temis> '; clear");
    expect(verifier).toContain("initial rendered synthetic PTY prompt");
    expect(verifier).not.toContain(
      "synthetic PTY prompt after environment layout",
    );
  });

  it("keeps the temporary smoke preload aligned with renderer security evidence", () => {
    const preload = source("src/preload/preload.ts");
    const verifier = source("scripts/verify-desktop-skin.mjs");
    for (const marker of [
      "contextIsolated: process.contextIsolated === true",
      "sandboxed: process.sandboxed === true",
    ]) {
      expect(preload).toContain(marker);
      expect(verifier).toContain(marker);
    }
    expect(verifier).toContain("desktopSkinSmokeRendererReadyCount += 1");
    expect(verifier).toContain(
      "ipcRenderer.send(IPC.rendererReady, {\\n      contextIsolated:",
    );
  });
});
