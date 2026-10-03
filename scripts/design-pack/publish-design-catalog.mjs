// Publish the merged design-pack catalog to the release host's main branch
// (the URL the app's update check reads; mirrors publish-office-catalog.mjs).
// Merges rather than replaces: existing pack manifests stay, the artemis-design
// entry set is replaced wholesale, public keys are unioned.
//
// usage: publish-design-catalog.mjs <artifacts-design-pack-dir>
//   reads <dir>/<version>/catalog.json for the newest version directory.
// Requires GH_TOKEN with Contents:write on EurekaRaider/ArtemisRelease.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const REPO = "EurekaRaider/ArtemisRelease";
const CATALOG_PATH = "artemis-design/catalog.json";
const dir = process.argv[2];
if (!dir) throw new Error("usage: publish-design-catalog.mjs <dir>");
const versions = [];
for (const entry of await readdir(dir)) {
  const info = await stat(join(dir, entry)).catch(() => undefined);
  if (info?.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry))
    versions.push(entry);
}
if (versions.length === 0) throw new Error(`No version directories under ${dir}`);
versions.sort((a, b) => {
  const [aM, aN, aP] = a.split(".").map(Number);
  const [bM, bN, bP] = b.split(".").map(Number);
  return bM - aM || bN - aN || bP - aP;
});
const next = JSON.parse(
  await readFile(join(dir, versions[0], "catalog.json"), "utf8"),
);

const headers = {
  Authorization: `Bearer ${process.env.GH_TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};
// Fetch the current hosted catalog; tolerate absence (first publish).
const currentResponse = await fetch(
  `https://api.github.com/repos/${REPO}/contents/${CATALOG_PATH}`,
  { headers },
);
let hosted = { schemaVersion: 1, publicKeys: {}, manifests: [] };
let sha;
if (currentResponse.ok) {
  const body = await currentResponse.json();
  sha = body.sha;
  if (body.content)
    hosted = JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
} else if (currentResponse.status !== 404) {
  throw new Error(`Catalog fetch failed: ${currentResponse.status}`);
}

// Immutable-version guard across packs: same version republished with a
// different digest is refused; identical digests converge.
const byVersion = new Map(
  hosted.manifests.map((manifest) => [`${manifest.id}@${manifest.version}`, manifest]),
);
for (const manifest of next.manifests) {
  const key = `${manifest.id}@${manifest.version}`;
  const previous = byVersion.get(key);
  if (previous && previous.archive.sha256 !== manifest.archive.sha256)
    throw new Error(
      `${key} is already published with a different archive digest`,
    );
  byVersion.set(key, manifest);
}
const merged = {
  schemaVersion: 1,
  publicKeys: { ...hosted.publicKeys, ...next.publicKeys },
  manifests: [...byVersion.values()].sort((a, b) =>
    `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`),
  ),
};
const content = Buffer.from(JSON.stringify(merged, null, 2)).toString("base64");
const response = await fetch(`https://api.github.com/repos/${REPO}/contents/${CATALOG_PATH}`, {
  method: "PUT",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({
    message: `Publish artemis-design catalog for ${versions[0]}`,
    content,
    ...(sha ? { sha } : {}),
  }),
});
if (!response.ok)
  throw new Error(`Catalog publish failed: ${response.status} ${await response.text()}`);
console.log(`Published ${CATALOG_PATH} (artemis-design ${versions[0]}, ${merged.manifests.length} manifests total)`);
