import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
const afterPackPath = fileURLToPath(
  new URL("../scripts/apply-package-permissions.cjs", import.meta.url),
);
const nativeVerifierPath = fileURLToPath(
  new URL("../scripts/verify-windows-native.mjs", import.meta.url),
);
const packageScriptPath = fileURLToPath(
  new URL("../scripts/package-windows-lite.mjs", import.meta.url),
);
const releaseFinalizerPath = fileURLToPath(
  new URL("../scripts/finalize-release.mjs", import.meta.url),
);
const sandboxHelperPath = fileURLToPath(
  new URL("../resources/windows-sandbox.ps1", import.meta.url),
);
const sandboxSetupPath = fileURLToPath(
  new URL("../resources/windows-sandbox-setup.ps1", import.meta.url),
);
const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
  scripts?: Record<string, string>;
  build: {
    afterPack?: string;
    nsis?: unknown;
    portable?: unknown;
    toolsets?: unknown;
    win?: {
      artifactName?: string;
      target?: Array<{ target: string; arch: string[] }>;
    };
  };
};

describe("Windows ZIP package and AppContainer ACL", () => {
  it("uses a native x64 ZIP as the only Windows package target", () => {
    expect(packageJson.build.win).toEqual({
      artifactName: "Artemis-Windows-${arch}-${version}.${ext}",
      target: [{ target: "zip", arch: ["x64"] }],
    });
    expect(packageJson.build.nsis).toBeUndefined();
    expect(packageJson.build.portable).toBeUndefined();
    expect(packageJson.build.toolsets).toBeUndefined();
    expect(packageJson.scripts?.["package:win"]).toBe(
      "node scripts/package-windows-lite.mjs",
    );
    const packageSource = readFileSync(packageScriptPath, "utf8");
    expect(packageSource).toContain('"--win"');
    expect(packageSource).toContain('"zip"');
    expect(packageSource).toContain('"--x64"');
    expect(packageJson.scripts?.["package:win"]).not.toMatch(
      /nsis|portable|runtime-marketplace/iu,
    );
  });

  it("applies ACLs natively and explicitly skips only a cross-built ZIP", () => {
    expect(packageJson.build.afterPack).toBe(
      "scripts/apply-package-permissions.cjs",
    );
    expect(existsSync(afterPackPath)).toBe(true);

    const source = readFileSync(afterPackPath, "utf8");
    expect(source).toContain('electronPlatformName !== "win32"');
    expect(source).toContain("ARTEMIS_ALLOW_CROSS_WINDOWS_ZIP");
    expect(source).toContain('process.platform !== "win32"');
    expect(source).toContain('"*S-1-15-2-1:(OI)(CI)(RX)"');
    expect(source).toContain('"*S-1-15-2-2:(OI)(CI)(RX)"');
    expect(source).toContain('"/T"');
    expect(source).toContain('"/C"');
    expect(source).toContain('"/Q"');
  });

  it("smoke-tests the final extracted ZIP and its effective ACLs on Windows", () => {
    expect(packageJson.scripts?.["release:win"]).toContain(
      "cross-env ARTEMIS_REQUIRE_SIGNATURE=1 npm run verify:win-native",
    );
    expect(packageJson.scripts?.["release:win"]).toContain(
      "node scripts/finalize-release.mjs --windows-zip",
    );
    expect(existsSync(nativeVerifierPath)).toBe(true);
    const finalizer = readFileSync(releaseFinalizerPath, "utf8");
    expect(finalizer).toContain("distribution: windowsZipOnly");
    expect(finalizer).toContain('"manual-windows-zip"');
    expect(finalizer).toContain(
      "Artemis-Windows-x64-${packageJson.version}.zip",
    );

    const source = readFileSync(nativeVerifierPath, "utf8");
    expect(source).toContain("Expand-Archive");
    expect(source).toContain("ARTEMIS_WINDOWS_ZIP");
    expect(source).toContain("extractedExecutablePath");
    expect(source).toContain(
      "GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])",
    );
    expect(source).toContain("assertAppContainerReadAcl(extractedRoot)");
    expect(source).toContain('join(extractedRoot, "resources", "app.asar")');
    expect(source).toContain("zipSmoke: true");
    expect(source).not.toMatch(/installerPath|uninstallerPath|\/S/gu);
  });

  it("grants only non-inheriting ancestor metadata access for non-system drives", () => {
    const helper = readFileSync(sandboxHelperPath, "utf8");
    const setup = readFileSync(sandboxSetupPath, "utf8");

    expect(helper).toContain("$requiresClassicAppContainer");
    expect(helper).toContain("Test-AppContainerAncestorAccess");
    expect(helper).toContain(
      "$accessPaths = @($workspace) + @($readOnlyPaths)",
    );
    expect(helper).toContain("-Verb RunAs");
    expect(helper).toContain("-WindowStyle Hidden");
    expect(helper).toContain("[Console]::OutputEncoding");
    expect(helper).toContain("UTF8Encoding]::new($false)");
    expect(setup).toContain("'artemisWorkspaceTraverse'");
    expect(setup).toContain("DeriveCapabilitySidsFromName");
    expect(setup).toContain("$decodedPaths = $json | ConvertFrom-Json");
    expect(setup).toContain("foreach ($decodedPath in $decodedPaths)");
    expect(setup).toContain(
      "[System.Security.AccessControl.FileSystemRights]::Traverse",
    );
    expect(setup).toContain(
      "[System.Security.AccessControl.FileSystemRights]::ReadAttributes",
    );
    expect(setup).toContain(
      "[System.Security.AccessControl.InheritanceFlags]::None",
    );
    expect(setup).not.toContain(
      "[System.Security.AccessControl.FileSystemRights]::Modify",
    );
    expect(setup).not.toContain(
      "[System.Security.AccessControl.FileSystemRights]::ReadAndExecute",
    );
    expect(setup).not.toContain(
      "[System.Security.AccessControl.FileSystemRights]::ReadData",
    );
    expect(setup).not.toContain(
      "[System.Security.AccessControl.FileSystemRights]::ListDirectory",
    );
    expect(setup).not.toContain(
      "[System.Security.AccessControl.FileSystemRights]::Write",
    );
  });

  it("does not add a redundant read ACL when the workspace is writable", () => {
    const helper = readFileSync(sandboxHelperPath, "utf8");

    expect(helper).toContain("var writablePathSet = new HashSet<string>(");
    expect(helper).toContain("if (!writablePathSet.Contains(workspace))");
  });
});
