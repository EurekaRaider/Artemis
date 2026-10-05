import { proposeCatalog } from "../ui/catalog-pull-request.mjs";
import { readFile } from "node:fs/promises";
const repo = "EurekaRaider/Artemis";
const endpoint = `https://api.github.com/repos/${repo}/contents/apps/desktop/resources/office-runtime/catalog.json`;
if (!process.env.GH_TOKEN)
  throw Error("GH_TOKEN is required to publish the catalog");
const request = async (
  method = "GET",
  accept = "application/vnd.github+json",
  body,
) => {
  const response = await fetch(endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: accept,
      "Content-Type": "application/json",
      "User-Agent": "Artemis-Office-Catalog",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok)
    throw Error(`Office catalog ${method} failed: HTTP ${response.status}`);
  return (await response.text()).trim();
};
const current = JSON.parse(await request());
const content = await readFile(process.argv[2], "utf8");
const next = JSON.parse(content);
// The Contents API omits inline content for catalogs larger than 1 MiB.
const previous = JSON.parse(
  await request("GET", "application/vnd.github.raw+json"),
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
  await proposeCatalog({
    repository: repo,
    path: "apps/desktop/resources/office-runtime/catalog.json",
    content,
    title: "Update verified Windows Office runtime catalog",
  });
}
