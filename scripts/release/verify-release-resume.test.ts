import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  validateResumeRun,
  verifyPublicRelease,
} from "./verify-release-resume.mjs";

const sha = "a".repeat(40);
const tag = "v1.7.17";
const run = {
  id: 123,
  head_sha: sha,
  repository: { full_name: "EurekaRaider/Artemis" },
  head_repository: { full_name: "EurekaRaider/Artemis" },
  path: ".github/workflows/release.yml",
  event: "workflow_dispatch",
  head_branch: "main",
  status: "completed",
  conclusion: "failure",
};
const jobs = [
  "Build and sign macOS arm64",
  "Build and sign macOS x64",
  "Notarize and verify macOS arm64",
  "Notarize and verify macOS x64",
  "Package and verify Windows x64 NSIS and ZIP",
  "Verify and collect all three platform release sets",
].map((name, id) => ({ name, id, conclusion: "success" }));
const artifacts = [
  {
    id: 17,
    name: "verified-release-assets",
    expired: false,
    workflow_run: { id: 123, head_sha: sha },
  },
];
it("accepts a failed final publish only after all original native gates passed", () => {
  expect(validateResumeRun(run, jobs, artifacts, "1.7.17", tag)).toEqual({
    sha,
    artifactId: 17,
  });
  expect(
    validateResumeRun(
      run,
      [{ ...jobs[0], id: -1, conclusion: "failure" }, ...jobs],
      artifacts,
      "1.7.17",
      tag,
    ).sha,
  ).toBe(sha);
});
it("rejects foreign, unfinished, wrong-version and unverified runs", () => {
  for (const change of [
    { head_branch: "branch" },
    { status: "in_progress" },
    { event: "pull_request" },
    { path: "ci.yml" },
    { head_repository: { full_name: "fork/Artemis" } },
    { repository: { full_name: "other/repo" } },
  ])
    expect(() =>
      validateResumeRun({ ...run, ...change }, jobs, artifacts, "1.7.17", tag),
    ).toThrow();
  expect(() =>
    validateResumeRun(run, jobs, artifacts, "1.7.16", tag),
  ).toThrow();
  expect(() =>
    validateResumeRun(run, jobs.slice(1), artifacts, "1.7.17", tag),
  ).toThrow("gate did not pass");
  expect(() =>
    validateResumeRun(
      run,
      [...jobs, { ...jobs[0], id: 100, conclusion: "failure" }],
      artifacts,
      "1.7.17",
      tag,
    ),
  ).toThrow("gate did not pass");
});
it("rejects expired, duplicate or wrong-source artifacts", () => {
  for (const values of [
    [],
    [...artifacts, ...artifacts],
    [{ ...artifacts[0], expired: true }],
    [{ ...artifacts[0], workflow_run: { id: 124, head_sha: sha } }],
    [{ ...artifacts[0], workflow_run: { id: 123, head_sha: "b".repeat(40) } }],
  ])
    expect(() => validateResumeRun(run, jobs, values, "1.7.17", tag)).toThrow(
      "verified artifact",
    );
});
let directory: string;
let remote: any[];
let release: any;
let resolvedSha: string;
let execute: ReturnType<typeof vi.fn>;
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "release-resume-test-"));
  const names = ["arm64", "x64"].flatMap((arch) =>
    ["dmg", "zip"].map((ext) => `Artemis-macOS-${arch}-1.7.17.${ext}`),
  );
  names.push(
    "Artemis-Windows-x64-1.7.17.exe",
    "Artemis-Windows-x64-1.7.17.zip",
    "latest-mac.yml",
    "windows-x64-update.json",
  );
  const entries = [];
  remote = [];
  for (const name of names) {
    const bytes = Buffer.from(name);
    await writeFile(join(directory, name), bytes);
    entries.push({ name, size: bytes.length, sha256: hash(bytes) });
  }
  await writeFile(
    join(directory, "release-manifest.json"),
    JSON.stringify({ version: "1.7.17", artifacts: entries }),
  );
  for (const name of [...names, "release-manifest.json"]) {
    const bytes = await readFile(join(directory, name));
    remote.push({
      name,
      size: bytes.length,
      state: "uploaded",
      digest: `sha256:${hash(bytes)}`,
    });
  }
  release = { id: 7, tag_name: tag, draft: false, prerelease: false };
  resolvedSha = sha;
  execute = vi.fn((...args: string[]) => {
    expect(args[0]).toBe("api");
    expect(args).not.toContain("--method");
    if (args[1].includes("releases?")) {
      expect(args).toContain("--paginate");
      expect(args).toContain("--jq");
      return release ? "7" : "";
    }
    if (args[1].includes("/assets?")) return JSON.stringify([remote]);
    if (args[1].includes("/commits/"))
      return JSON.stringify({ sha: resolvedSha });
    return JSON.stringify(release);
  });
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
it("verifies the complete public release without any mutations", async () => {
  await expect(
    verifyPublicRelease(directory, tag, sha, { execute }),
  ).resolves.toBe(true);
});
it("permits normal draft publication but never resumes a draft or missing release", async () => {
  for (const value of [{ ...release, draft: true }, undefined]) {
    release = value;
    await expect(
      verifyPublicRelease(directory, tag, sha, {
        execute,
        allowUnpublished: true,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyPublicRelease(directory, tag, sha, { execute }),
    ).rejects.toThrow("already published");
  }
});
it("does not treat API failure as a missing release", async () => {
  execute.mockImplementation(() => {
    throw new Error("network unavailable");
  });
  await expect(
    verifyPublicRelease(directory, tag, sha, {
      execute,
      allowUnpublished: true,
    }),
  ).rejects.toThrow("network unavailable");
});
it("rejects a moved tag even if target_commitish or the assets match", async () => {
  resolvedSha = "b".repeat(40);
  await expect(
    verifyPublicRelease(directory, tag, sha, { execute }),
  ).rejects.toThrow("source commit");
});
it("rejects missing, extra, duplicated and different public assets", async () => {
  const original = structuredClone(remote);
  for (const changed of [
    original.slice(1),
    [...original, { ...original[0], name: "extra.zip" }],
    [...original.slice(1), original[1]],
    original.map((asset, i) =>
      i ? asset : { ...asset, digest: "sha256:wrong" },
    ),
  ]) {
    remote = changed;
    await expect(
      verifyPublicRelease(directory, tag, sha, { execute }),
    ).rejects.toThrow(/asset (set )?mismatch/u);
  }
});
it("rejects local corruption and unexpected files", async () => {
  await writeFile(join(directory, "latest-mac.yml"), "corrupt");
  await expect(
    verifyPublicRelease(directory, tag, sha, { execute }),
  ).rejects.toThrow("Local asset mismatch");
  await writeFile(join(directory, "extra.txt"), "extra");
  await expect(
    verifyPublicRelease(directory, tag, sha, { execute }),
  ).rejects.toThrow("Local release asset set");
});
