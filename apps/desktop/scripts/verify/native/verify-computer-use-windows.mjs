import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { build } from "esbuild";
import { verificationOutput } from "../../../../../scripts/artifacts/output-path.mjs";

if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("Run this verification on Windows 11 with x64 Node.js.");
const desktop = fileURLToPath(new URL("../../..", import.meta.url));
const require = createRequire(import.meta.url);
const output = resolve(
  process.env.ARTEMIS_VERIFY_OUTPUT ??
    verificationOutput("computer-use-windows"),
);
await mkdir(output, { recursive: true });
const vswhere = join(
  process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
  "Microsoft Visual Studio/Installer/vswhere.exe",
);
const installation = execFileSync(
  vswhere,
  [
    "-latest",
    "-products",
    "*",
    "-requires",
    "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "-property",
    "installationPath",
  ],
  { encoding: "utf8" },
).trim();
if (!installation)
  throw new Error(
    "Install Visual Studio C++ build tools, CMake and the Windows SDK for native developer verification.",
  );
const cmake = join(
  installation,
  "Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe",
);
const nativeBuild = join(output, "native-build");
execFileSync(
  cmake,
  [
    "-S",
    join(desktop, "native/computer-use/windows"),
    "-B",
    nativeBuild,
    "-G",
    "Visual Studio 17 2022",
    "-A",
    "x64",
  ],
  { stdio: "inherit" },
);
execFileSync(cmake, ["--build", nativeBuild, "--config", "Debug"], {
  stdio: "inherit",
});
const fixtureFolder = join(output, "中文验证");
await mkdir(fixtureFolder, { recursive: true });
const fixture = join(fixtureFolder, "fixture.exe");
execFileSync(
  join(
    process.env.SystemRoot ?? "C:\\Windows",
    "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
  ),
  [
    "/nologo",
    "/target:exe",
    "/reference:System.Windows.Forms.dll",
    "/reference:System.Drawing.dll",
    "/out:" + fixture,
    join(desktop, "test/fixtures/computer-use-app-windows.cs"),
  ],
  { stdio: "inherit" },
);
const digest = createHash("sha256")
  .update(await readFile(fixture))
  .digest("hex");
const appId =
  "win-" +
  createHash("sha256")
    .update("\\\\?\\" + fixture.toLowerCase() + ":" + digest)
    .digest("hex");
const entry = join(output, "fixture.mjs");
await build({
  entryPoints: [join(desktop, "test/fixtures/computer-use-electron.ts")],
  outfile: entry,
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["electron"],
  banner: {
    js: 'import {createRequire} from "node:module";const require=createRequire(import.meta.url);',
  },
});
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
console.log("Computer Use evidence: " + output);
try {
  await new Promise((resolve, reject) => {
    const child = spawn(
      require("electron"),
      [
        entry,
        join(nativeBuild, "Debug/artemis-computer-use.exe"),
        output,
        fixture,
        appId,
      ],
      { env: environment, stdio: "inherit" },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Computer Use verification timed out"));
    }, 60000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve()
        : reject(new Error("Computer Use verification failed: " + code));
    });
  });
} finally {
  await rm(entry, { force: true });
}
