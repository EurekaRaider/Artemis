import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  mainProcessSource,
  macPackageScriptPath,
  macPackageScriptSource,
  macIconBuildSource,
  macIconPngPath,
  windowsPackageScriptSource,
  engineeringBuilderSource,
  releaseBuilderSource,
  bundledMarketplaceSource,
  desktopPackage,
  rootPackage,
  macIconSource,
} from "../../fixtures/application/layout-contract.js";
describe("renderer layout contract", () => {
  it("uses a prebuilt multi-resolution icon for macOS packages", () => {
    expect(mainProcessSource).toContain("function applyMacDockIcon()");
    expect(mainProcessSource).toContain('process.platform !== "darwin"');
    expect(mainProcessSource).toContain("app.isPackaged");
    expect(mainProcessSource).toContain("app.dock?.setIcon(iconPath)");
    expect(mainProcessSource).not.toContain(
      'join(process.resourcesPath, "icon.png")',
    );
    expect(desktopPackage.build.mac.icon).toBe("build/icon.icns");
    expect(desktopPackage.build.extraResources).not.toContainEqual({
      from: "build/icon.png",
      to: "icon.png",
    });
    expect(macIconSource.subarray(0, 4).toString("ascii")).toBe("icns");
    expect(existsSync(macIconPngPath)).toBe(true);
    expect(macIconBuildSource).toContain('"icon-macos.png"');
    expect(macIconBuildSource).toContain('"icon.icns"');
    expect(macIconBuildSource).toContain('type: "ic10"');
    expect(macIconBuildSource).toContain("writeUInt32BE");
    expect(macPackageScriptSource).toContain(
      '["scripts/build/build-macos-icon.mjs"]',
    );
  });
  it("packages four runtime-free Lite artifact plugins on macOS and Windows", () => {
    expect(rootPackage.scripts["package:mac"]).toBe(
      "npm run package:mac -w @artemis/desktop",
    );
    expect(rootPackage.scripts["package:mac:arm64"]).toBe(
      "npm run package:mac:arm64 -w @artemis/desktop",
    );
    expect(rootPackage.scripts["package:mac:x64"]).toBe(
      "npm run package:mac:x64 -w @artemis/desktop",
    );
    expect(desktopPackage.scripts["package:mac"]).toBe(
      "node scripts/packaging/package-mac-lite.mjs all",
    );
    expect(desktopPackage.scripts["package:mac:arm64"]).toBe(
      "node scripts/packaging/package-mac-lite.mjs arm64",
    );
    expect(desktopPackage.scripts["package:mac:x64"]).toBe(
      "node scripts/packaging/package-mac-lite.mjs x64",
    );
    for (const target of desktopPackage.build.mac.target) {
      expect(target.arch).toEqual(["arm64", "x64"]);
    }
    expect(desktopPackage.scripts["release:mac"]).toBe(
      "node scripts/packaging/package-mac-lite.mjs all --release",
    );
    expect(macPackageScriptSource).toContain(
      '"scripts/packaging/release-builder.config.cjs"',
    );
    expect(macPackageScriptSource).toContain(
      '["scripts/release/validate-release-env.mjs", "mac"]',
    );
    expect(macPackageScriptSource).toContain(
      '["scripts/release/finalize-release.mjs"]',
    );
    expect(releaseBuilderSource).toContain(
      "...(process.env.ARTEMIS_WINDOWS_PUBLISHER",
    );
    expect(releaseBuilderSource).toContain(
      "? { publisherName: process.env.ARTEMIS_WINDOWS_PUBLISHER }",
    );
    const invalidArchitecture = spawnSync(
      process.execPath,
      [macPackageScriptPath, "universal"],
      { encoding: "utf8" },
    );
    expect(invalidArchitecture.status).not.toBe(0);
    expect(invalidArchitecture.stderr).toContain(
      "Unsupported macOS package architecture: universal. Expected arm64, x64 or all.",
    );
    expect(macPackageScriptSource).toContain(
      'const packageName = "@napi-rs/canvas-darwin-x64"',
    );
    expect(macPackageScriptSource).toContain(
      "await cleanupStagedDependencies()",
    );
    expect(desktopPackage.scripts["package:win"]).toBe(
      "node scripts/packaging/package-windows-lite.mjs",
    );
    expect(windowsPackageScriptSource).toContain(
      '[npmCli, "run", "verify:bundled-plugins"]',
    );
    expect(windowsPackageScriptSource).toContain('"--win"');
    expect(windowsPackageScriptSource).toContain('"zip"');
    expect(windowsPackageScriptSource).toContain('"--x64"');
    expect(desktopPackage.scripts["package:win:portable"]).toBeUndefined();
    expect(desktopPackage.scripts["release:win"]).toContain(
      "node scripts/packaging/package-windows-lite.mjs --release",
    );
    for (const plugin of [
      "documents",
      "pdf",
      "spreadsheets",
      "presentations",
    ]) {
      expect(bundledMarketplaceSource).toContain(`"${plugin}"`);
    }
    expect(macPackageScriptSource).toContain('"build:core"');
    expect(macPackageScriptSource).toContain('"verify:bundled-plugins"');
    expect(macPackageScriptSource).not.toContain("actool");
    expect(macPackageScriptSource).not.toContain("Xcode 26");
    expect(engineeringBuilderSource).toContain('icon: "build/icon.icns"');
    expect(engineeringBuilderSource).toContain("identity: null");
    expect(engineeringBuilderSource).toContain(
      'afterPack: "scripts/packaging/apply-engineering-package-permissions.cjs"',
    );
    expect(
      `${macPackageScriptSource}\n${windowsPackageScriptSource}\n${engineeringBuilderSource}\n${JSON.stringify(desktopPackage.scripts)}`,
    ).not.toContain("codex-primary-runtime");
  });
});
