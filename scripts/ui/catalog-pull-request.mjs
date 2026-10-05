import { createHash } from "node:crypto";
/** Propose a catalog change without granting the publisher main-branch bypass. */
export async function proposeCatalog({ repository, path, content, title }) {
  if (!process.env.GH_TOKEN) throw new Error("GH_TOKEN is required");
  const api = async (endpoint, method = "GET", body, raw = false) => {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/${endpoint}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${process.env.GH_TOKEN}`,
          Accept: raw
            ? "application/vnd.github.raw+json"
            : "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok)
      throw new Error(
        `Catalog PR ${method} ${endpoint}: HTTP ${response.status}`,
      );
    return raw ? response.text() : response.json();
  };
  const digest = createHash("sha256")
    .update(content)
    .digest("hex")
    .slice(0, 16);
  const branch = `codex/catalog-${digest}`;
  const branches = await api(`git/matching-refs/heads/${branch}`);
  if (!branches.some((ref) => ref.ref === `refs/heads/${branch}`)) {
    const main = await api("git/ref/heads/main");
    await api("git/refs", "POST", {
      ref: `refs/heads/${branch}`,
      sha: main.object.sha,
    });
  }
  const response = await fetch(
    `https://api.github.com/repos/${repository}/contents/${path}?ref=${branch}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok && response.status !== 404)
    throw new Error(`Catalog branch read HTTP ${response.status}`);
  const previous = response.ok ? await response.json() : undefined;
  if (
    !previous?.content ||
    Buffer.from(previous.content, "base64").toString("utf8") !== content
  )
    await api(`contents/${path}`, "PUT", {
      message: title,
      content: Buffer.from(content).toString("base64"),
      branch,
      ...(previous ? { sha: previous.sha } : {}),
    });
  const readback = await api(`contents/${path}?ref=${branch}`);
  const published = readback.content
    ? Buffer.from(readback.content, "base64").toString("utf8")
    : await api(`contents/${path}?ref=${branch}`, "GET", undefined, true);
  if (published !== content)
    throw new Error("Catalog branch readback mismatch");
  const existing = await api(
    `pulls?state=open&head=${repository.split("/")[0]}:${branch}&base=main`,
  );
  const pr =
    existing[0] ??
    (await api("pulls", "POST", {
      title,
      head: branch,
      base: "main",
      body: "Update the signed capability catalog after artifact verification. Maintainer review and merge are required; automation does not push main.",
    }));
  console.log(`Catalog review: ${pr.html_url}`);
  return pr.html_url;
}
