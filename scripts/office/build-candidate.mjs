// Build a reviewable Windows candidate. Candidate keys are ephemeral and never
// added to the application's production trust catalog.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  cp,
  copyFile,
  mkdir,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import {
  canonicalCapabilityJson,
  capabilityPackManifestSchema,
} from "@artemis/protocol";

const [office, bridge, destination = "artifacts/office/candidate"] =
  process.argv.slice(2);
if (process.platform !== "win32" || !office || !bridge)
  throw Error(
    "Windows only: build-candidate.mjs <soffice.exe> <bridge.exe> [output]",
  );
const out = resolve(destination);
await mkdir(out, { recursive: true });
const payload = join(out, "payload");
await mkdir(payload); // Never replace a previous candidate in place.
const runtime = dirname(dirname(resolve(office)));
const omitted = new Set([
  "help",
  "sdk",
  "share/gallery",
  "share/template",
  "share/Scripts/python",
]);
const removed = [];
await cp(runtime, join(payload, "runtime"), {
  recursive: true,
  filter: (path) => {
    const name = relative(runtime, path).replaceAll("\\", "/");
    const skip =
      omitted.has(name) ||
      /^program\/(?:python(?:-core-[^/]+|[0-9.]*(?:\.exe|\.dll)|loader\.uno\.dll)|pyuno\.pyd)$/iu.test(
        name,
      );
    if (skip) removed.push(name);
    return !skip;
  },
});
await copyFile(resolve(bridge), join(payload, "office-bridge.exe"));
const hash = async (path) => {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
};
const files = [];
async function inventory(path, prefix = "") {
  for (const entry of (await readdir(path, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const name = prefix + entry.name,
      absolute = join(path, entry.name);
    if (entry.isDirectory()) await inventory(absolute, name + "/");
    else if (entry.isFile())
      files.push({
        path: name,
        bytes: (await stat(absolute)).size,
        sha256: await hash(absolute),
        executable: /\.(exe|dll|com|bin)$/iu.test(name),
      });
    else throw Error(`Unexpected runtime link or device: ${name}`);
  }
}
await inventory(payload);
if (
  files.some((file) =>
    /(?:^|\/)(?:node|python[0-9.]*|java|chrome|chromium)\.exe$/iu.test(
      file.path,
    ),
  )
)
  throw Error("Candidate includes an additional language or browser runtime");
const archivePath = join(out, "office-core-win32-x64.zip");
execFileSync(
  "python",
  [
    "-c",
    `
import pathlib, sys, zipfile
root=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=False) as archive:
    for path in sorted(root.rglob('*')):
        if path.is_file(): archive.write(path, path.relative_to(root).as_posix())
`,
    payload,
    archivePath,
  ],
  { stdio: "inherit" },
);
const signatures = JSON.parse(
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference='Stop'; @('office-bridge.exe','runtime/program/soffice.exe','runtime/program/soffice.bin') | ForEach-Object { $p=Join-Path $env:OFFICE_CANDIDATE_PAYLOAD $_; if(Test-Path -LiteralPath $p){$s=Get-AuthenticodeSignature -LiteralPath $p; if($s.Status -notin @('Valid','NotSigned')){throw 'Invalid native signature'}; @{path=$_; signer=if($s.Status -eq 'Valid'){$s.SignerCertificate.Thumbprint}else{$null}}}} | ConvertTo-Json -Compress",
    ],
    {
      encoding: "utf8",
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) => name.toLowerCase() !== "psmodulepath",
          ),
        ),
        OFFICE_CANDIDATE_PAYLOAD: payload,
      },
    },
  ),
);
const keys = generateKeyPairSync("ed25519");
const keyId = "office-candidate";
const common = {
  schemaVersion: 1,
  id: "office-core",
  hostRange: ">=1.6.8 <2",
  platform: "win32",
  arch: "x64",
  sourceDigest: await hash(resolve("scripts/office/sources.json")),
  entrypoint: "office-bridge.exe",
  officeExecutable: "runtime/program/soffice.exe",
  files,
  native: {
    signer: "inventory",
    notarization: "not-applicable",
    windows: signatures,
  },
};
const manifests = [];
for (const version of ["1.0.0", "1.0.1"]) {
  const unsigned = {
    ...common,
    version,
    archive: {
      url: `https://github.com/EurekaRaider/Artemis/releases/download/office-runtime-v${version}/office-core-win32-x64.zip`,
      sha256: await hash(archivePath),
      downloadBytes: (await stat(archivePath)).size,
      unpackedBytes: files.reduce((total, file) => total + file.bytes, 0),
    },
  };
  manifests.push(
    capabilityPackManifestSchema.parse({
      ...unsigned,
      signature: {
        keyId,
        value: sign(
          null,
          Buffer.from(canonicalCapabilityJson(unsigned)),
          keys.privateKey,
        ).toString("base64"),
      },
    }),
  );
}
await writeFile(
  join(out, "catalog.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      publicKeys: {
        [keyId]: keys.publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
      },
      manifests,
    },
    null,
    2,
  ),
);
const report = {
  schemaVersion: 1,
  commit: process.env.GITHUB_SHA,
  candidate: true,
  productionTrusted: false,
  windowsCertificateRequired: false,
  files: files.length,
  removedOptionalPaths: removed,
  archive: manifests[0].archive,
  signatures,
};
await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
