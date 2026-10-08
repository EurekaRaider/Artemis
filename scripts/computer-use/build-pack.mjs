import { execFileSync } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
} from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalCapabilityJson,
  computerUsePackManifestSchema,
} from "@artemis/protocol";
import { inventoryTree, zipEntries } from "../design-pack/pack.mjs";
import { buildComputerUse } from "../../apps/desktop/scripts/build/build-computer-use.mjs";
import { notarizeExistingMacApp } from "../../apps/desktop/scripts/release/notarize-macos-app.mjs";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const version = process.env.COMPUTER_USE_VERSION ?? process.argv[2];
if (!/^\d+\.\d+\.\d+$/u.test(version ?? ""))
  throw new Error("COMPUTER_USE_VERSION must be x.y.z");
if (!(
  (process.platform === "darwin" && process.arch === "arm64") ||
  (process.platform === "win32" && process.arch === "x64")
))
  throw new Error("Build on macOS arm64 or Windows x64");
const output = resolve(
  process.env.COMPUTER_USE_OUTPUT ??
    join(repo, "artifacts", "computer-use", version),
);
const catalog = JSON.parse(
  await readFile(
    join(repo, "apps/desktop/resources/computer-use/catalog.json"),
    "utf8",
  ),
);
const key = createPrivateKey(
  process.env.COMPUTER_USE_ED25519_PRIVATE_KEY ?? "",
);
const publicDer = createPublicKey(key).export({ type: "spki", format: "der" });
const keyId = Object.entries(catalog.publicKeys).find(([, value]) =>
  createPublicKey(value)
    .export({ type: "spki", format: "der" })
    .equals(publicDer),
)?.[0];
if (!keyId || key.asymmetricKeyType !== "ed25519")
  throw new Error("Computer Use Ed25519 signing key is not pinned by Artemis");
const scratch = await mkdtemp(join(tmpdir(), "artemis-computer-pack-"));
const payload = join(scratch, "payload");
const run = (command, args) => {
  try {
    return execFileSync(command, args, {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    if (command === "cmake") {
      process.stderr.write(error.stdout ?? "");
      process.stderr.write(error.stderr ?? "");
    }
    throw new Error(
      command +
        " failed while building Computer Use; inspect the native build in CI.",
    );
  }
};
try {
  await mkdir(payload);
  let signer = null,
    notarization = "not-applicable",
    entrypoint = "artemis-computer-use.exe";
  if (process.platform === "darwin") {
    if (
      !process.env.APPLE_TEAM_ID ||
      !process.env.CSC_LINK ||
      !process.env.CSC_KEY_PASSWORD
    )
      throw new Error("macOS signing credentials are required");
    buildComputerUse("arm64");
    const app = join(payload, "ArtemisComputerUse.app");
    await mkdir(join(app, "Contents", "MacOS"), { recursive: true });
    await cp(
      join(repo, "apps/desktop/build/computer-use/arm64/artemis-computer-use"),
      join(app, "Contents/MacOS/artemis-computer-use"),
    );
    await writeFile(
      join(app, "Contents/Info.plist"),
      '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.artemis.computer-use</string><key>CFBundleExecutable</key><string>artemis-computer-use</string><key>CFBundleName</key><string>Artemis Computer Use</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/><key>LSMinimumSystemVersion</key><string>14.0</string><key>CFBundleShortVersionString</key><string>' +
        version +
        "</string><key>CFBundleVersion</key><string>" +
        version +
        "</string><key>NSScreenCaptureUsageDescription</key><string>Capture the application window you authorize for Computer Use.</string></dict></plist>",
    );
    const certificate = join(scratch, "certificate.p12"),
      keychain = join(scratch, "signing.keychain-db");
    const password = randomBytes(32).toString("hex");
    const previousKeychains = [
      ...run("/usr/bin/security", ["list-keychains", "-d", "user"]).matchAll(
        /"([^"]+)"/gu,
      ),
    ].map((match) => match[1]);
    await writeFile(certificate, Buffer.from(process.env.CSC_LINK, "base64"), {
      mode: 0o600,
    });
    run("/usr/bin/security", ["create-keychain", "-p", password, keychain]);
    try {
      run("/usr/bin/security", ["unlock-keychain", "-p", password, keychain]);
      run("/usr/bin/security", ["set-keychain-settings", keychain]);
      run("/usr/bin/security", [
        "list-keychains",
        "-d",
        "user",
        "-s",
        keychain,
        ...previousKeychains,
      ]);
      run("/usr/bin/security", [
        "import",
        certificate,
        "-k",
        keychain,
        "-P",
        process.env.CSC_KEY_PASSWORD,
        "-T",
        "/usr/bin/codesign",
      ]);
      run("/usr/bin/security", [
        "set-key-partition-list",
        "-S",
        "apple-tool:,apple:",
        "-s",
        "-k",
        password,
        keychain,
      ]);
      const identities = run("/usr/bin/security", [
        "find-identity",
        "-v",
        "-p",
        "codesigning",
        keychain,
      ]);
      const identity = [...identities.matchAll(/"([^"]+)"/gu)]
        .map((match) => match[1])
        .find(
          (name) =>
            name.startsWith("Developer ID Application:") &&
            name.endsWith("(" + process.env.APPLE_TEAM_ID + ")"),
        );
      if (!identity)
        throw new Error(
          "Developer ID Application identity does not match APPLE_TEAM_ID",
        );
      run("/usr/bin/codesign", [
        "--force",
        "--timestamp",
        "--options",
        "runtime",
        "--keychain",
        keychain,
        "--sign",
        identity,
        app,
      ]);
      await notarizeExistingMacApp(app, version, process.env);
    } finally {
      run("/usr/bin/security", [
        "list-keychains",
        "-d",
        "user",
        "-s",
        ...previousKeychains,
      ]);
      run("/usr/bin/security", ["delete-keychain", keychain]);
    }
    signer = process.env.APPLE_TEAM_ID;
    notarization = "accepted-stapled";
    entrypoint = "ArtemisComputerUse.app/Contents/MacOS/artemis-computer-use";
  } else {
    const build = join(scratch, "build");
    run("cmake", [
      "-S",
      join(repo, "apps/desktop/native/computer-use/windows"),
      "-B",
      build,
      "-A",
      "x64",
    ]);
    run("cmake", ["--build", build, "--config", "Release"]);
    await cp(
      join(build, "Release", "artemis-computer-use.exe"),
      join(payload, entrypoint),
    );
    // Authenticode can be applied by an external signing step. A declared signer is always verified on install.
    if (process.env.COMPUTER_USE_SIGNED_WINDOWS_HELPER) {
      await cp(
        process.env.COMPUTER_USE_SIGNED_WINDOWS_HELPER,
        join(payload, entrypoint),
      );
      signer = process.env.COMPUTER_USE_WINDOWS_SIGNER;
      if (!/^[a-f0-9]{40}$/iu.test(signer ?? ""))
        throw new Error("A Windows certificate thumbprint is required");
    }
  }
  await cp(
    join(repo, "apps/desktop/resources/computer-use"),
    join(payload, "plugin"),
    { recursive: true, filter: (path) => !path.endsWith("catalog.json") },
  );
  const pluginPath = join(payload, "plugin/artemis.plugin.json");
  const plugin = JSON.parse(await readFile(pluginPath, "utf8"));
  plugin.version = version;
  await writeFile(pluginPath, JSON.stringify(plugin, null, 2) + "\n");
  const files = (await inventoryTree(payload)).map((file) => ({
    ...file,
    executable: file.path === entrypoint,
  }));
  const entries = await Promise.all(
    files.map(async (file) => ({
      name: file.path,
      bytes: await readFile(join(payload, file.path)),
      executable: file.executable,
    })),
  );
  const archive = zipEntries(entries),
    name = "computer-use-" + process.platform + "-" + process.arch + ".zip";
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const unsigned = {
    schemaVersion: 1,
    id: "computer-use",
    version,
    hostRange: ">=1.7.6 <2",
    platform: process.platform,
    arch: process.arch,
    minimumOS: process.platform === "darwin" ? "14" : "11",
    helperProtocol: 1,
    entrypoint,
    pluginRoot: "plugin",
    sourceDigest: sha(run("git", ["rev-parse", "HEAD"]).trim()),
    archive: {
      url:
        "https://github.com/EurekaRaider/Artemis/releases/download/computer-use-v" +
        version +
        "/" +
        name,
      sha256: sha(archive),
      downloadBytes: archive.length,
      unpackedBytes: files.reduce((total, file) => total + file.bytes, 0),
    },
    files,
    native: { signer, notarization },
  };
  const manifest = computerUsePackManifestSchema.parse({
    ...unsigned,
    signature: {
      keyId,
      value: sign(
        null,
        Buffer.from(canonicalCapabilityJson(unsigned)),
        key,
      ).toString("base64"),
    },
  });
  await mkdir(output, { recursive: true });
  await writeFile(join(output, name), archive);
  await writeFile(
    join(output, "manifest-" + process.platform + "-" + process.arch + ".json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    "Computer Use " +
      version +
      " " +
      process.platform +
      "-" +
      process.arch +
      " pack built and signed.",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
