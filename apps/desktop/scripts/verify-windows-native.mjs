import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error(
    "Windows native verification requires a real Windows x64 host",
  );
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: resolve("..", ".."),
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.error?.message ?? result.stderr ?? result.stdout ?? `exit ${String(result.status)}`}`,
    );
  }
  return result.stdout;
}

function peMachine(bytes) {
  if (bytes.readUInt16LE(0) !== 0x5a4d) throw new Error("Artifact is not PE");
  const header = bytes.readUInt32LE(0x3c);
  if (bytes.toString("ascii", header, header + 4) !== "PE\0\0") {
    throw new Error("Artifact has no PE signature");
  }
  return bytes.readUInt16LE(header + 4);
}

function assertX64Executable(path) {
  return readFile(path).then((bytes) => {
    const machine = peMachine(bytes);
    if (machine !== 0x8664) {
      throw new Error(`${path} is not an x64 PE artifact`);
    }
    return machine;
  });
}

function powershell(script, environment = {}) {
  return run(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
    { env: { ...process.env, ...environment } },
  );
}

function effectiveAclSids(path) {
  const output = powershell(
    "$acl = Get-Acl -LiteralPath $env:ARTEMIS_ACL_PATH; " +
      "$acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | " +
      "ForEach-Object { $_.IdentityReference.Value }",
    { ARTEMIS_ACL_PATH: path },
  );
  return new Set(
    output
      .split(/\r?\n/gu)
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function assertAppContainerReadAcl(path) {
  const sids = effectiveAclSids(path);
  for (const sid of ["S-1-15-2-1", "S-1-15-2-2"]) {
    if (!sids.has(sid)) {
      throw new Error(
        `Packaged path is missing AppContainer read ACL ${sid}: ${path}`,
      );
    }
  }
}

const { version: packageVersion } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const unpackedExecutablePath = resolve(
  process.env.ARTEMIS_WINDOWS_EXE ??
    join("release", "win-unpacked", "Artemis.exe"),
);
const archivePath = resolve(
  process.env.ARTEMIS_WINDOWS_ZIP ??
    join("release", `Artemis-Windows-x64-${packageVersion}.zip`),
);
const archiveBytes = await readFile(archivePath);
if (
  archiveBytes.length < 4 ||
  archiveBytes[0] !== 0x50 ||
  archiveBytes[1] !== 0x4b
) {
  throw new Error(`${archivePath} is not a ZIP archive`);
}
const archiveSha256 = createHash("sha256").update(archiveBytes).digest("hex");
const unpackedMachine = await assertX64Executable(unpackedExecutablePath);

const npmCliPath = process.env.npm_execpath;
if (!npmCliPath) {
  throw new Error("npm_execpath is unavailable for native integration tests");
}
run(process.execPath, [
  npmCliPath,
  "test",
  "--workspace",
  "@artemis/desktop",
  "--",
  "--run",
  "test/mcp-client-manager.test.ts",
  "test/terminal-service.integration.test.ts",
  "test/trusted-extension-manager.integration.test.ts",
]);

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-package-smoke-"),
);
try {
  const extractedRoot = join(temporaryDirectory, "archive");
  await mkdir(extractedRoot);
  powershell(
    "Expand-Archive -LiteralPath $env:ARTEMIS_ZIP_PATH -DestinationPath $env:ARTEMIS_ZIP_DESTINATION -Force",
    {
      ARTEMIS_ZIP_PATH: archivePath,
      ARTEMIS_ZIP_DESTINATION: extractedRoot,
    },
  );
  const extractedExecutablePath = join(extractedRoot, "Artemis.exe");
  if (!existsSync(extractedExecutablePath)) {
    throw new Error("Windows ZIP does not contain Artemis.exe at its root");
  }
  const extractedMachine = await assertX64Executable(extractedExecutablePath);

  const runtimePath = join(extractedRoot, "resources", "codex-primary-runtime");
  if (existsSync(runtimePath)) {
    throw new Error(
      "Windows Lite ZIP unexpectedly contains codex-primary-runtime",
    );
  }
  const bundledPluginsRoot = join(
    extractedRoot,
    "resources",
    "resources",
    "bundled-artifact-plugins",
  );
  for (const pluginName of [
    "documents",
    "pdf",
    "presentations",
    "spreadsheets",
  ]) {
    const manifestPath = join(
      bundledPluginsRoot,
      "plugins",
      pluginName,
      ".codex-plugin",
      "plugin.json",
    );
    if (!existsSync(manifestPath)) {
      throw new Error(
        `Windows Lite ZIP is missing ${pluginName}: ${manifestPath}`,
      );
    }
    const iconPath = join(
      bundledPluginsRoot,
      "plugins",
      pluginName,
      "assets",
      "icon.png",
    );
    const iconBytes = await readFile(iconPath);
    if (
      iconBytes.length < 24 ||
      !iconBytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      throw new Error(`Windows Lite ZIP has an invalid ${pluginName} icon`);
    }
  }

  const signtoolPath =
    process.env.ARTEMIS_SIGNTOOL ??
    join(
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "Windows Kits",
      "10",
      "App Certification Kit",
      "signtool.exe",
    );
  if (!existsSync(signtoolPath)) {
    throw new Error(`Windows SDK signtool was not found: ${signtoolPath}`);
  }
  const signatureResult = spawnSync(
    signtoolPath,
    ["verify", "/pa", "/all", "/v", extractedExecutablePath],
    { encoding: "utf8" },
  );
  const signatureOutput =
    `${signatureResult.stdout ?? ""}\n${signatureResult.stderr ?? ""}`.trim();
  const signature = {
    Status:
      signatureResult.status === 0
        ? "Valid"
        : /no signature found/iu.test(signatureOutput)
          ? "NotSigned"
          : "Invalid",
  };
  if (signature.Status === "Invalid") {
    throw new Error(`Authenticode verification failed:\n${signatureOutput}`);
  }
  if (
    process.env.ARTEMIS_REQUIRE_SIGNATURE === "1" &&
    signature.Status !== "Valid"
  ) {
    throw new Error(`Authenticode verification failed: ${signature.Status}`);
  }

  async function smokeExecutable(path, name) {
    const screenshotPath = join(temporaryDirectory, `${name}.png`);
    const userDataPath = join(temporaryDirectory, `${name}-user-data`);
    run(path, [`--user-data-dir=${userDataPath}`], {
      cwd: dirname(path),
      env: {
        ...process.env,
        ARTEMIS_SMOKE_SCREENSHOT: screenshotPath,
      },
      timeout: 45_000,
    });
    const screenshot = await readFile(screenshotPath);
    if ((await stat(screenshotPath)).size < 10_000) {
      throw new Error("Packaged renderer screenshot is unexpectedly small");
    }
    return createHash("sha256").update(screenshot).digest("hex");
  }

  const unpackedScreenshotSha256 = await smokeExecutable(
    unpackedExecutablePath,
    "win-unpacked",
  );
  const extractedScreenshotSha256 = await smokeExecutable(
    extractedExecutablePath,
    "zip-extracted",
  );
  assertAppContainerReadAcl(extractedRoot);
  assertAppContainerReadAcl(join(extractedRoot, "resources", "app.asar"));

  console.log(
    JSON.stringify(
      {
        archivePath,
        archiveSha256,
        unpackedExecutablePath,
        extractedExecutablePath,
        unpackedMachine,
        extractedMachine,
        signature,
        bundledPlugins: ["documents", "pdf", "presentations", "spreadsheets"],
        externalDocumentToolchainEmbedded: false,
        unpackedScreenshotSha256,
        extractedScreenshotSha256,
        zipSmoke: true,
        appContainerAcl: true,
      },
      undefined,
      2,
    ),
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
