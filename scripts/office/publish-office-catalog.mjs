import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const repo = "EurekaRaider/ArtemisRelease";
const endpoint = `repos/${repo}/contents/office-runtime/catalog.json`;
const gh = (...args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
const current = JSON.parse(gh("api", endpoint));
const content = await readFile(process.argv[2], "utf8");
const next = JSON.parse(content);
// The Contents API omits inline content for catalogs larger than 1 MiB.
const previous = JSON.parse(
  gh("api", endpoint, "-H", "Accept: application/vnd.github.raw+json"),
);
if (JSON.stringify(next.publicKeys) !== JSON.stringify(previous.publicKeys))
  throw Error("Catalog changed trust roots");
for (const manifest of previous.manifests) {
  if (manifest.platform === "win32" && manifest.arch === "x64") continue;
  if (
    !next.manifests.some((m) => JSON.stringify(m) === JSON.stringify(manifest))
  )
    throw Error("Catalog removed or changed an existing platform");
}
if (JSON.stringify(previous) === JSON.stringify(next)) {
  console.log("Published catalog already matches");
} else {
  await writeFile(
    "artifacts/office/catalog-update.json",
    JSON.stringify({
      message: "Publish verified Windows Office runtime 1.0.1 catalog",
      sha: current.sha,
      content: Buffer.from(content).toString("base64"),
      branch: "main",
    }),
  );
  gh(
    "api",
    endpoint,
    "--method",
    "PUT",
    "--input",
    "artifacts/office/catalog-update.json",
  );
  const verified = gh(
    "api",
    endpoint,
    "-H",
    "Accept: application/vnd.github.raw+json",
  );
  if (verified !== content.trim())
    throw Error("Published catalog readback mismatch");
  console.log("Published Windows online-install catalog; macOS entry retained");
}
