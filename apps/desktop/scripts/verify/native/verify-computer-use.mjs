import { rm, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { build } from "esbuild";
import { buildComputerUse } from "../../build/build-computer-use.mjs";
import { verificationOutput } from "../../../../../scripts/artifacts/output-path.mjs";

if (process.platform === "win32") {
  await import("./verify-computer-use-windows.mjs");
  process.exit(0);
}
if (process.platform !== "darwin")
  throw new Error("Run Computer Use native validation on macOS or Windows 11.");
const require = createRequire(import.meta.url);
const desktop = fileURLToPath(new URL("../../..", import.meta.url));
buildComputerUse(process.arch, true);
const output = resolve(
  process.env.ARTEMIS_VERIFY_OUTPUT ?? verificationOutput("computer-use-macos"),
);
await mkdir(output, { recursive: true });
const entry = join(output, "fixture.mjs");
const fixtureApp = join(output, "Computer Use Fixture.app");
const fixtureBundle = `com.artemis.computer-use-fixture.${output.split("-").at(-1)}`;
await mkdir(join(fixtureApp, "Contents", "MacOS"), { recursive: true });
const policyTest = join(output, "input-policy-test");
execFileSync("xcrun", [
  "swiftc",
  "-parse-as-library",
  "-module-cache-path",
  join(desktop, "build/swift-module-cache"),
  join(desktop, "native/computer-use/macos/input-policy.swift"),
  join(desktop, "test/fixtures/computer-input-policy.swift"),
  "-o",
  policyTest,
]);
execFileSync(policyTest, [], { stdio: "inherit" });
await writeFile(
  join(fixtureApp, "Contents", "Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${fixtureBundle}</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundleName</key><string>Computer Use Fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`,
);
execFileSync("xcrun", [
  "swiftc",
  join(desktop, "test/fixtures/computer-use-app.swift"),
  "-o",
  join(fixtureApp, "Contents/MacOS/fixture"),
]);
execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", fixtureApp]);

await build({
  entryPoints: [join(desktop, "test/fixtures/computer-use-electron.ts")],
  outfile: entry,
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["electron"],
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
console.log(`Computer Use evidence: ${output}`);
try {
  await new Promise((resolve, reject) => {
    const child = spawn(
      require("electron"),
      [
        entry,
        join(desktop, "build/computer-use/development/artemis-computer-use"),
        output,
        fixtureApp,
        fixtureBundle,
      ],
      { env: environment, stdio: "inherit" },
    );
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Computer Use verification timed out"));
    }, 45000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      code === 0
        ? resolve()
        : reject(new Error(`Computer Use verification failed: ${code}`));
    });
  });
} finally {
  await rm(entry, { force: true });
}
