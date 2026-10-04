import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { load } from "js-yaml";

for (const name of await readdir(
  new URL("../../.github/workflows/", import.meta.url),
)) {
  if (!/\.ya?ml$/u.test(name)) continue;
  const source = await readFile(
    new URL(`../../.github/workflows/${name}`, import.meta.url),
    "utf8",
  );
  assert(
    !/self-hosted|github\.event\.repository\.private|pull_request_target|head\.repo\.full_name|darwin-x64|macos-x64|win32-arm64|windows-arm64|--ia32|--universal/u.test(
      source,
    ),
    `${name}: private or unsafe workflow`,
  );
  const workflow = load(source);
  for (const [id, job] of Object.entries(workflow.jobs)) {
    if (job.uses) continue;
    for (const entry of job.strategy?.matrix?.include ?? []) {
      assert(
        ["macos-arm64", "windows-x64"].includes(entry.platform),
        `${name}/${id}: unsupported target ${entry.platform}`,
      );
      assert(
        entry.runner ===
          (entry.platform === "macos-arm64" ? "macos-15" : "windows-2025"),
        `${name}/${id}: runner does not match target`,
      );
    }
    const runners = job.strategy?.matrix?.include?.map(
      (entry) => entry.runner,
    ) ?? [job["runs-on"]];
    for (const runner of runners) {
      assert(
        typeof runner === "string" &&
          (runner === "macos-15" ||
            runner === "windows-2025" ||
            runner ===
              "${{ inputs.platform == 'macos' && 'macos-15' || 'windows-2025' }}"),
        `${name}/${id}: unsupported runner ${runner}`,
      );
    }
  }
}
console.log(
  "Public workflows use only hosted Windows x64 and macOS arm64 runners.",
);
