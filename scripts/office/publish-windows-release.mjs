import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const repo = "EurekaRaider/Artemis";
const version = process.env.OFFICE_RUNTIME_VERSION;
if (!/^\d+\.\d+\.\d+$/.test(version ?? ""))
  throw Error("A stable runtime version is required");
const tag = `office-runtime-v${version}`;
const out = "artifacts/office/windows-release";
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }).trim();
const api = (path) => JSON.parse(gh("api", `repos/${repo}/${path}`));
const latest = api("releases/latest").tag_name;
const report = JSON.parse(
  await readFile("artifacts/office/candidate/report.json", "utf8"),
);
const notes = `# Office Runtime ${version} · Windows x64

Source: ${report.commit}
Archive SHA-256: ${report.archive.sha256}
Built and validated on a fresh GitHub-hosted Windows runner. Ed25519 manifest and file hashes are checked at installation.
`;
await writeFile("artifacts/office/windows-release-notes.md", notes);
await writeFile(
  join(out, "THIRD_PARTY_NOTICES.txt"),
  "Office runtime includes LibreOffice 26.8.0 (MPL 2.0 and applicable LGPL and third-party licenses), nlohmann/json 3.12.0 (MIT), and the Artemis UNO bridge. Upstream license and notice files are preserved within runtime/. Pinned upstream sources and digests are listed in sources.json.\n",
);
const files = await readdir(out);
const checksums = [];
for (const name of files) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(join(out, name)))
    hash.update(chunk);
  checksums.push(`${hash.digest("hex")}  ${name}`);
}
await writeFile(join(out, "SHA256SUMS.txt"), checksums.join("\n") + "\n");
let release = api("releases?per_page=100").find((r) => r.tag_name === tag);
if (!release) {
  gh(
    "release",
    "create",
    tag,
    "--repo",
    repo,
    "--title",
    `Office Runtime ${version} · Windows x64`,
    "--draft",
    "--latest=false",
    "--notes-file",
    "artifacts/office/windows-release-notes.md",
  );
  release = api("releases?per_page=100").find(
    (entry) => entry.tag_name === tag,
  );
}
for (const name of await readdir(out)) {
  const bytes = await readFile(join(out, name));
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const asset = release.assets.find((a) => a.name === name);
  if (asset) {
    if (asset.size !== bytes.length || asset.digest !== digest)
      throw Error(`Refusing to replace different existing asset ${name}`);
  } else {
    if (!release.draft) throw Error(`Missing immutable asset ${name}`);
    gh("release", "upload", tag, join(out, name), "--repo", repo);
  }
}
release = api(`releases/${release.id}`);
if (release.assets.length !== (await readdir(out)).length)
  throw Error("Unexpected public asset set");
for (const asset of release.assets) {
  const bytes = await readFile(join(out, asset.name));
  if (
    asset.state !== "uploaded" ||
    asset.size !== bytes.length ||
    asset.digest !==
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`
  )
    throw Error(`Uploaded bytes differ: ${asset.name}`);
}
if (release.draft)
  gh("release", "edit", tag, "--repo", repo, "--draft=false", "--latest=false");
if (api("releases/latest").tag_name !== latest)
  throw Error("Runtime release changed app Latest");
console.log(
  `Published ${tag}; verified all asset digests; app Latest remains ${latest}`,
);
