import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  canonicalCapabilityJson,
  capabilityPackManifestSchema,
} from "@artemis/protocol";
const repo = "EurekaRaider/Artemis";
const version = process.env.OFFICE_RUNTIME_VERSION;
if (!/^\d+\.\d+\.\d+$/.test(version ?? ""))
  throw new Error("A stable runtime version is required");
const tag = "office-runtime-v" + version;
const out = "artifacts/office/macos-release";
const evidence = JSON.parse(
  await readFile(join(out, "installed-native-acceptance.json"), "utf8"),
);
const catalog = JSON.parse(await readFile(join(out, "catalog.json"), "utf8"));
const manifest = [
  ...catalog.manifests,
  ...(catalog.additionalManifests ?? []),
].find((m) => m.platform === "darwin" && m.arch === process.arch);
if (
  !manifest ||
  manifest.version !== version ||
  evidence.sourceCommit !== process.env.GITHUB_SHA ||
  evidence.version !== version ||
  evidence.arch !== process.arch ||
  evidence.archiveSha256 !== manifest.archive.sha256 ||
  evidence.nativeCorpusVerified !== true
)
  throw new Error(
    "Installed native Office acceptance is required before publication",
  );
const pinned = JSON.parse(
  await readFile("apps/desktop/resources/office-runtime/catalog.json", "utf8"),
);
const validated = capabilityPackManifestSchema.parse(manifest);
const { signature, ...unsigned } = validated;
if (
  JSON.stringify(catalog.publicKeys) !== JSON.stringify(pinned.publicKeys) ||
  !verify(
    null,
    Buffer.from(canonicalCapabilityJson(unsigned)),
    createPublicKey(pinned.publicKeys[signature.keyId]),
    Buffer.from(signature.value, "base64"),
  )
)
  throw new Error(
    "Office publication changed the signed manifest or trust roots",
  );
const archiveName = basename(new URL(manifest.archive.url).pathname);
const manifestName = archiveName.replace(/\.zip$/u, ".manifest.json");
if (
  JSON.stringify(
    JSON.parse(await readFile(join(out, manifestName), "utf8")),
  ) !== JSON.stringify(manifest)
)
  throw new Error("Office manifest file differs from the verified catalog");
const gh = (...args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const api = (path) => JSON.parse(gh("api", `repos/${repo}/${path}`));
const latest = api("releases/latest").tag_name;
if (api("releases?per_page=100").some((entry) => entry.tag_name === tag))
  throw new Error("Immutable Office runtime version already exists");
const notes = `Office Runtime ${version} · macOS ${process.arch}\n\nSource: ${process.env.GITHUB_SHA}\nDeveloper ID signed, notarized and stapled. The final signed archive was installed and exercised against the pinned Word, Excel and PowerPoint corpus on its native runner. Ed25519 signatures and SHA-256 inventory protect installation.\n\nOffice Runtime ${version} · macOS ${process.arch}\n\n已完成 Developer ID 签名、公证和 stapling；原生 runner 安装最终包后验证 Word、Excel、PowerPoint 样本。安装保留 Ed25519 签名与逐文件 SHA-256 校验。\n`;
await writeFile("artifacts/office/macos-release-notes.md", notes);
await writeFile(
  join(out, "THIRD_PARTY_NOTICES.txt"),
  "Includes LibreOffice 26.8.0 (MPL 2.0 and applicable LGPL and third-party licenses), nlohmann/json 3.12.0 (MIT) and the Artemis UNO bridge. Upstream licenses and notices are retained inside the runtime; sources.json records pinned inputs.\n",
);
const files = [
  archiveName,
  manifestName,
  archiveName.replace(/\.zip$/u, ".artemis-office"),
  "catalog.json",
  "sources.json",
  "native-acceptance.json",
  "installed-native-acceptance.json",
  "THIRD_PARTY_NOTICES.txt",
];
const digests = new Map();
for (const name of files)
  digests.set(
    name,
    createHash("sha256")
      .update(await readFile(join(out, name)))
      .digest("hex"),
  );
if (
  digests.get(archiveName) !== manifest.archive.sha256 ||
  (await stat(join(out, archiveName))).size !== manifest.archive.downloadBytes
)
  throw new Error("Verified Office archive bytes changed");
await writeFile(
  join(out, "SHA256SUMS.txt"),
  [...digests].map(([name, hash]) => `${hash}  ${name}`).join("\n") + "\n",
);
digests.set(
  "SHA256SUMS.txt",
  createHash("sha256")
    .update(await readFile(join(out, "SHA256SUMS.txt")))
    .digest("hex"),
);
gh(
  "release",
  "create",
  tag,
  "--repo",
  repo,
  "--target",
  process.env.GITHUB_SHA,
  "--draft",
  "--latest=false",
  "--title",
  `Office Runtime ${version} · macOS ${process.arch}`,
  "--notes-file",
  "artifacts/office/macos-release-notes.md",
);
for (const name of digests.keys())
  gh("release", "upload", tag, join(out, name), "--repo", repo);
// The tag endpoint can return 404 for a draft, even after all uploads finish.
const release = api("releases?per_page=100").find(
  (entry) => entry.tag_name === tag,
);
if (
  !release?.draft ||
  release.assets.length !== digests.size ||
  release.assets.some(
    (a) =>
      a.state !== "uploaded" || a.digest !== "sha256:" + digests.get(a.name),
  )
)
  throw new Error("Uploaded Office asset digests differ");
gh("release", "edit", tag, "--repo", repo, "--draft=false", "--latest=false");
if (api("releases/latest").tag_name !== latest)
  throw new Error("Office publication changed app Latest");
console.log(
  `Published ${tag}; verified all assets without changing app Latest`,
);
