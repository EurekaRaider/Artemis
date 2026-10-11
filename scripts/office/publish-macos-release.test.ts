import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalCapabilityJson } from "@artemis/protocol";
import { expect, it } from "vitest";
const publisher = fileURLToPath(
  new URL("./publish-macos-release.mjs", import.meta.url),
);
const sha = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const commit = "e".repeat(40);
function publish(
  options: {
    corrupt?: boolean;
    stale?: boolean;
    existing?: boolean;
    badUpload?: boolean;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "office-mac-publisher-"));
  const output = join(root, "artifacts/office/macos-release");
  const keys = generateKeyPairSync("ed25519");
  const bytes = Buffer.from("verified native archive");
  const name = `office-core-darwin-${process.arch}-1.0.2`;
  const unsigned = {
    schemaVersion: 1,
    id: "office-core",
    version: "1.0.2",
    hostRange: ">=1.7.14 <2",
    platform: "darwin",
    arch: process.arch,
    sourceDigest: "f".repeat(64),
    archive: {
      url: `https://github.com/EurekaRaider/Artemis/releases/download/office-runtime-v1.0.2/${name}.zip`,
      sha256: sha(bytes),
      downloadBytes: bytes.length,
      unpackedBytes: 2,
    },
    entrypoint: "ArtemisOfficeRuntime.app/Contents/MacOS/office-bridge",
    officeExecutable: "ArtemisOfficeRuntime.app/Contents/MacOS/soffice",
    files: ["office-bridge", "soffice"].map((file) => ({
      path: "ArtemisOfficeRuntime.app/Contents/MacOS/" + file,
      bytes: 1,
      sha256: sha("x"),
      executable: true,
    })),
    native: { signer: "TEAM", notarization: "accepted-stapled" },
  };
  const manifest = {
    ...unsigned,
    signature: {
      keyId: "fixture",
      value: sign(
        null,
        Buffer.from(canonicalCapabilityJson(unsigned)),
        keys.privateKey,
      ).toString("base64"),
    },
  };
  const catalog = {
    schemaVersion: 1,
    publicKeys: {
      fixture: keys.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    },
    manifests: [],
    additionalManifests: [manifest],
  };
  mkdirSync(output, { recursive: true });
  mkdirSync(join(root, "apps/desktop/resources/office-runtime"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "apps/desktop/resources/office-runtime/catalog.json"),
    JSON.stringify(catalog),
  );
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ version: "1.7.14" }),
  );
  for (const [file, value] of Object.entries({
    "catalog.json": catalog,
    "sources.json": {},
    "native-acceptance.json": {},
    "installed-native-acceptance.json": {
      sourceCommit: options.stale ? "a".repeat(40) : commit,
      version: "1.0.2",
      platform: "darwin",
      arch: process.arch,
      archiveSha256: sha(bytes),
      nativeCorpusVerified: true,
      hostVersion: "1.7.14",
    },
    [name + ".manifest.json"]: manifest,
  }))
    writeFileSync(join(output, file), JSON.stringify(value));
  writeFileSync(
    join(output, name + ".zip"),
    options.corrupt ? "changed after acceptance" : bytes,
  );
  writeFileSync(join(output, name + ".artemis-office"), "offline fixture");
  const requests = join(root, "requests.json");
  writeFileSync(requests, "[]");
  const preload = join(root, "mock.mjs");
  writeFileSync(
    preload,
    `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {basename} from 'node:path';
const calls=[],assets=[];let created=false;cp.execFileSync=(command,args)=>{if(command!=='gh')throw Error('unexpected command');calls.push(args);writeFileSync(${JSON.stringify(requests)},JSON.stringify(calls));
if(args[0]==='api'){if(args[1].endsWith('releases/latest'))return JSON.stringify({tag_name:'v1.7.14'});if(args[1].includes('releases/tags/'))throw Error('Not Found (HTTP 404)');if(args[1].includes('releases?'))return JSON.stringify(${options.existing ? "true" : "false"}||created?[{tag_name:'office-runtime-v1.0.2',draft:true,assets}]:[]);throw Error('unexpected API');}
if(args[1]==='create')created=true;
if(args[1]==='upload'){const path=args[3];const bytes=readFileSync(path);assets.push({name:basename(path),state:'uploaded',size:bytes.length,digest:'sha256:'+(${options.badUpload ? "'wrong'" : "createHash('sha256').update(bytes).digest('hex')"})});}return '';};syncBuiltinESMExports();`,
  );
  try {
    let error = "";
    try {
      execFileSync(
        process.execPath,
        ["--import", pathToFileURL(preload).href, publisher],
        {
          cwd: root,
          env: {
            ...process.env,
            OFFICE_RUNTIME_VERSION: "1.0.2",
            GITHUB_SHA: commit,
          },
          stdio: "pipe",
        },
      );
    } catch (caught) {
      error = String((caught as { stderr?: Buffer }).stderr ?? caught);
    }
    return {
      error,
      calls: JSON.parse(readFileSync(requests, "utf8")) as string[][],
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
it("validates draft uploads when the tag endpoint returns 404 and preserves Latest", () => {
  const result = publish();
  expect(result.error).toBe("");
  expect(result.calls.find((args) => args[1] === "create")).toContain(
    "--latest=false",
  );
  expect(result.calls.find((args) => args[1] === "edit")).toContain(
    "--draft=false",
  );
  expect(result.calls.some((args) => args[1]?.includes("releases/tags/"))).toBe(
    false,
  );
});
it("rejects bytes modified after native acceptance before creating a release", () => {
  const result = publish({ corrupt: true });
  expect(result.error).toContain("Verified Office archive bytes changed");
  expect(result.calls.some((args) => args[0] === "release")).toBe(false);
});
it("rejects stale acceptance and an existing immutable version", () => {
  for (const options of [{ stale: true }, { existing: true }]) {
    const result = publish(options);
    expect(result.error).toMatch(/acceptance is required|already exists/);
    expect(result.calls.some((args) => args[0] === "release")).toBe(false);
  }
});
it("keeps the release draft when uploaded digests do not match", () => {
  const result = publish({ badUpload: true });
  expect(result.error).toContain("Uploaded Office asset digests differ");
  expect(result.calls.some((args) => args[1] === "edit")).toBe(false);
});
