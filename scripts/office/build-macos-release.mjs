import { execFileSync } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  canonicalCapabilityJson,
  capabilityPackManifestSchema,
} from "@artemis/protocol";
import { inventoryTree } from "../design-pack/pack.mjs";
import { withMacSigningKeychain } from "../release/macos-capability-signing.mjs";
import { notarizeExistingMacApp } from "../../apps/desktop/scripts/release/notarize-macos-app.mjs";

const [source, bridge] = process.argv.slice(2);
const version = process.env.OFFICE_RUNTIME_VERSION;
if (
  process.platform !== "darwin" ||
  !["arm64", "x64"].includes(process.arch) ||
  !source ||
  !bridge ||
  !/^\d+\.\d+\.\d+$/.test(version ?? "")
)
  throw new Error(
    "Use OFFICE_RUNTIME_VERSION=x.y.z build-macos-release.mjs <LibreOffice.app> <office-bridge> on native macOS",
  );
const target = "darwin-" + process.arch;
const output = resolve("artifacts/office/macos-release");
const catalog = JSON.parse(
  await readFile("apps/desktop/resources/office-runtime/catalog.json", "utf8"),
);
const key = createPrivateKey(
  process.env.OFFICE_RUNTIME_ED25519_PRIVATE_KEY ?? "",
);
const publicDer = createPublicKey(key).export({ type: "spki", format: "der" });
const keyId = Object.entries(catalog.publicKeys).find(([, value]) =>
  createPublicKey(value)
    .export({ type: "spki", format: "der" })
    .equals(publicDer),
)?.[0];
if (!keyId || key.asymmetricKeyType !== "ed25519")
  throw new Error("Office release key does not match the host trust root");
const scratch = await mkdtemp(join(tmpdir(), "artemis-office-macos-"));
const payload = join(scratch, "payload");
const app = join(payload, "ArtemisOfficeRuntime.app");
const run = (command, args) => {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    if (
      [
        "/usr/bin/codesign",
        "/usr/bin/lipo",
        "/usr/bin/install_name_tool",
      ].includes(command)
    )
      process.stderr.write(error.stderr ?? "");
    throw new Error(command + " failed while building the Office runtime");
  }
};
try {
  await cp(resolve(source), app, {
    recursive: true,
    dereference: true,
    filter: (path) =>
      !/(?:^|\/)(?:_CodeSignature|sdk|help|gallery|template|Scripts|python(?:-core-[^/]+|[0-9.]*|\.bin)|LibreOfficePython\.framework)(?:\/|$)|\/(?:libpython[^/]*|pyuno\.so|libpyuno[^/]*|libpythonloader[^/]*)$/iu.test(
        path,
      ),
  });
  await copyFile(resolve(bridge), join(app, "Contents/MacOS/office-bridge"));
  run("/usr/bin/install_name_tool", [
    "-rpath",
    resolve(source) + "/Contents/Frameworks",
    "@executable_path/../Frameworks",
    join(app, "Contents/MacOS/office-bridge"),
  ]);
  const plist = join(app, "Contents/Info.plist");
  for (const [name, value] of Object.entries({
    CFBundleIdentifier: "com.artemis.office-runtime",
    CFBundleName: "Artemis Office Runtime",
    CFBundleShortVersionString: version,
    CFBundleVersion: version,
  }))
    run("/usr/libexec/PlistBuddy", ["-c", `Set :${name} ${value}`, plist]);
  const macho = [];
  const bundles = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        if (/\.(?:app|framework|xpc)$/u.test(entry.name)) bundles.push(path);
      } else if (entry.isFile()) {
        const handle = await open(path, "r");
        const header = Buffer.alloc(4);
        try {
          await handle.read(header, 0, 4, 0);
        } finally {
          await handle.close();
        }
        if (
          [
            0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe,
            0xbebafeca, 0xcafebabf,
          ].includes(header.readUInt32BE())
        )
          macho.push(path);
      } else throw new Error("Unexpected runtime link or device");
    }
  }
  await visit(app);
  await withMacSigningKeychain(
    scratch,
    process.env,
    async ({ identity, keychain }) => {
      const nativeArch = process.arch === "x64" ? "x86_64" : "arm64";
      for (const path of macho) {
        run("/usr/bin/lipo", [path, "-verify_arch", nativeArch]);
        run("/usr/bin/codesign", [
          "--force",
          "--timestamp",
          "--options",
          "runtime",
          "--keychain",
          keychain,
          "--sign",
          identity,
          path,
        ]);
      }
      for (const path of [...bundles, app])
        run("/usr/bin/codesign", [
          "--force",
          "--timestamp",
          "--options",
          "runtime",
          "--keychain",
          keychain,
          "--sign",
          identity,
          path,
        ]);
      await notarizeExistingMacApp(app, version, process.env);
    },
  );
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  run("/usr/sbin/spctl", ["--assess", "--type", "execute", app]);
  await mkdir(output, { recursive: true });
  const name = `office-core-${target}-${version}`;
  const archive = join(output, name + ".zip");
  // ZIP32, dereferenced regular files, Unix execute bits; accepted by the installer.
  run("python3", [
    "-c",
    "import pathlib,sys,zipfile\nroot=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=False) as z:\n for p in sorted(root.rglob('*')):\n  if p.is_file(): z.write(p,p.relative_to(root).as_posix())",
    payload,
    archive,
  ]);
  const files = await inventoryTree(payload);
  for (const file of files)
    file.executable = Boolean(
      (await stat(join(payload, file.path))).mode & 0o111,
    );
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const unsigned = {
    schemaVersion: 1,
    id: "office-core",
    version,
    hostRange: process.arch === "x64" ? ">=1.7.14 <2" : ">=1.6.9 <2",
    platform: "darwin",
    arch: process.arch,
    sourceDigest: digest(await readFile("scripts/office/sources.json")),
    archive: {
      url: `https://github.com/EurekaRaider/Artemis/releases/download/office-runtime-v${version}/${name}.zip`,
      sha256: digest(await readFile(archive)),
      downloadBytes: (await stat(archive)).size,
      unpackedBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    },
    entrypoint: "ArtemisOfficeRuntime.app/Contents/MacOS/office-bridge",
    officeExecutable: "ArtemisOfficeRuntime.app/Contents/MacOS/soffice",
    files,
    native: {
      signer: process.env.APPLE_TEAM_ID,
      notarization: "accepted-stapled",
    },
  };
  const manifest = capabilityPackManifestSchema.parse({
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
  const manifestPath = join(output, name + ".manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
  });
  if (process.arch === "x64")
    catalog.additionalManifests = [
      ...(catalog.additionalManifests ?? []).filter(
        (m) => m.platform !== "darwin" || m.arch !== "x64",
      ),
      manifest,
    ];
  else
    catalog.manifests = [
      ...catalog.manifests.filter(
        (m) => m.platform !== "darwin" || m.arch !== process.arch,
      ),
      manifest,
    ];
  await writeFile(
    join(output, "catalog.json"),
    JSON.stringify(catalog, null, 2) + "\n",
  );
  await copyFile("scripts/office/sources.json", join(output, "sources.json"));
  run(process.execPath, [
    "scripts/office/create-offline-pack.mjs",
    manifestPath,
    archive,
    join(output, name + ".artemis-office"),
  ]);
  await writeFile(
    join(output, "native-acceptance.json"),
    JSON.stringify(
      {
        sourceCommit: process.env.GITHUB_SHA,
        target,
        version,
        archiveSha256: manifest.archive.sha256,
        developerId: process.env.APPLE_TEAM_ID,
        notarization: "accepted-stapled",
        binaries: macho.length,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Built, signed, notarized and stapled Office ${version} ${target}`,
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
