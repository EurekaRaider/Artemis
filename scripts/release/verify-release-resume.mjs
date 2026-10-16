import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repository = "EurekaRaider/Artemis";
const requiredJobs = [
  "Build and sign macOS arm64",
  "Build and sign macOS x64",
  "Notarize and verify macOS arm64",
  "Notarize and verify macOS x64",
  "Package and verify Windows x64 NSIS and ZIP",
  "Verify and collect all three platform release sets",
];
const gh = (...args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, GODEBUG: "http2client=0" },
  }).trim();
const api = (path, ...args) =>
  JSON.parse(gh("api", `repos/${repository}/${path}`, ...args));

export function validateReleaseIdentity(tag, sha) {
  if (!/^v\d+\.\d+\.\d+$/u.test(tag) || !/^[a-f0-9]{40}$/u.test(sha))
    throw new Error("Invalid release tag or source commit");
}

export function validateResumeRun(run, jobs, artifacts, version, tag) {
  validateReleaseIdentity(tag, run.head_sha);
  if (
    run.repository?.full_name !== repository ||
    run.head_repository?.full_name !== repository ||
    run.path !== ".github/workflows/release.yml" ||
    run.event !== "workflow_dispatch" ||
    run.head_branch !== "main" ||
    run.status !== "completed" ||
    tag !== `v${version}`
  )
    throw new Error(
      "Recovery requires a completed main Release run for the requested version",
    );
  // Retried runs can contain older failures: only the latest execution of each gate counts.
  const latest = new Map();
  for (const job of jobs)
    if (!latest.has(job.name) || latest.get(job.name).id < job.id)
      latest.set(job.name, job);
  for (const name of requiredJobs)
    if (latest.get(name)?.conclusion !== "success")
      throw new Error(`Release gate did not pass: ${name}`);
  const matches = artifacts.filter(
    (artifact) => artifact.name === "verified-release-assets",
  );
  if (
    matches.length !== 1 ||
    matches[0].expired ||
    matches[0].workflow_run?.id !== run.id ||
    matches[0].workflow_run?.head_sha !== run.head_sha
  )
    throw new Error(
      "Expected one unexpired verified artifact from the original source commit",
    );
  return { sha: run.head_sha, artifactId: matches[0].id };
}

export async function verifyPublicRelease(
  directory,
  tag,
  sha,
  { allowUnpublished = false, execute = gh } = {},
) {
  validateReleaseIdentity(tag, sha);
  const call = (path, ...args) =>
    execute("api", `repos/${repository}/${path}`, ...args);
  // Filter on GitHub's paginated output before buffering it; never treat read failures as absence.
  const ids = call(
    "releases?per_page=100",
    "--paginate",
    "--jq",
    `.[] | select(.tag_name == "${tag}") | .id`,
  )
    .split(/\s+/u)
    .filter(Boolean);
  if (ids.length > 1 || ids.some((id) => !/^\d+$/u.test(id)))
    throw new Error("Ambiguous release identity");
  const release = ids.length
    ? JSON.parse(call(`releases/${ids[0]}`))
    : undefined;
  if (!release || release.draft) {
    if (allowUnpublished) return false;
    throw new Error("Recovery requires an already published version release");
  }
  if (
    release.tag_name !== tag ||
    release.prerelease ||
    JSON.parse(call(`commits/${tag}`)).sha !== sha
  )
    throw new Error("Published release source commit or tag does not match");
  const manifest = JSON.parse(
    await readFile(join(directory, "release-manifest.json"), "utf8"),
  );
  if (manifest.version !== tag.slice(1) || !Array.isArray(manifest.artifacts))
    throw new Error("Release manifest version mismatch");
  const expected = new Map();
  for (const asset of manifest.artifacts) {
    if (
      typeof asset.name !== "string" ||
      !/^[A-Za-z0-9._-]+$/u.test(asset.name) ||
      asset.name === "release-manifest.json" ||
      expected.has(asset.name) ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      !/^[a-f0-9]{64}$/u.test(asset.sha256)
    )
      throw new Error("Invalid release manifest asset");
    expected.set(asset.name, asset);
  }
  for (const name of [
    ...["arm64", "x64"].flatMap((arch) =>
      ["dmg", "zip"].map(
        (ext) => `Artemis-macOS-${arch}-${manifest.version}.${ext}`,
      ),
    ),
    ...["exe", "zip"].map(
      (ext) => `Artemis-Windows-x64-${manifest.version}.${ext}`,
    ),
    "latest-mac.yml",
    "windows-x64-update.json",
  ])
    if (!expected.has(name))
      throw new Error(`Missing required release asset: ${name}`);
  expected.set("release-manifest.json", undefined);
  const entries = await readdir(directory, { withFileTypes: true });
  if (
    entries.length !== expected.size ||
    entries.some((entry) => !entry.isFile() || !expected.has(entry.name))
  )
    throw new Error("Local release asset set mismatch");
  const assets = JSON.parse(
    call(`releases/${release.id}/assets?per_page=100`, "--paginate", "--slurp"),
  ).flat();
  if (
    assets.length !== expected.size ||
    new Set(assets.map((asset) => asset.name)).size !== expected.size ||
    assets.some((asset) => !expected.has(asset.name))
  )
    throw new Error("Published release asset set mismatch");
  for (const [name, entry] of expected) {
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of createReadStream(join(directory, name))) {
      hash.update(chunk);
      size += chunk.length;
    }
    const digest = hash.digest("hex");
    if (entry && (entry.size !== size || entry.sha256 !== digest))
      throw new Error(`Local asset mismatch: ${name}`);
    const remote = assets.find((asset) => asset.name === name);
    if (
      remote.state !== "uploaded" ||
      remote.size !== size ||
      remote.digest !== `sha256:${digest}`
    )
      throw new Error(`Published asset mismatch: ${name}`);
  }
  console.log(
    `Verified immutable public release ${tag} at ${sha}; no asset upload needed.`,
  );
  return true;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [mode, input] = process.argv.slice(2);
  if (mode === "prepare") {
    if (!/^[1-9]\d*$/u.test(input))
      throw new Error("Provide an original Release run ID");
    const run = api(`actions/runs/${input}`);
    const jobs = api(
      `actions/runs/${input}/jobs?filter=all&per_page=100`,
      "--paginate",
      "--slurp",
    ).flatMap((page) => page.jobs);
    const artifacts = api(
      `actions/runs/${input}/artifacts?per_page=100`,
      "--paginate",
      "--slurp",
    ).flatMap((page) => page.artifacts);
    if (!/^[a-f0-9]{40}$/u.test(run.head_sha))
      throw new Error("Invalid original source commit");
    const content = api(`contents/package.json?ref=${run.head_sha}`);
    const { version } = JSON.parse(
      Buffer.from(content.content, "base64").toString("utf8"),
    );
    const result = validateResumeRun(
      run,
      jobs,
      artifacts,
      version,
      process.env.RELEASE_TAG,
    );
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `sha=${result.sha}\nartifact_id=${result.artifactId}\n`,
    );
  } else if (mode === "verify") {
    const published = await verifyPublicRelease(
      input,
      process.env.RELEASE_TAG,
      process.env.RELEASE_SHA,
      { allowUnpublished: process.argv.includes("--allow-unpublished") },
    );
    if (process.env.GITHUB_OUTPUT)
      await appendFile(process.env.GITHUB_OUTPUT, `published=${published}\n`);
  } else
    throw new Error(
      "Use prepare <original-run-id> or verify <verified-asset-directory>",
    );
}
