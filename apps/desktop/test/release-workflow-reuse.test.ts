import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

describe.skipIf(process.platform === "win32")("macOS-only CI reuse", () => {
  const sha = "a".repeat(40);
  const macNames = [
    "Test, typecheck, build and format (macos-arm64)",
    "Slack CLI native compatibility (macos-arm64)",
    "Visual convergence (macos-arm64)",
  ];
  const run = () => ({
    headSha: sha,
    workflowName: "CI",
    conclusion: "",
    jobs: macNames.map((name) => ({
      name,
      status: "completed",
      conclusion: "success",
    })),
  });
  function check(
    metadata: ReturnType<typeof run>,
    macosOnly = true,
    changed = ".github/workflows/release.yml",
  ) {
    const block = workflow.match(
      /- name: Verify previous CI before reusing it[\s\S]*?run: \|\n((?: {10}[^\n]*\n)+)/u,
    )?.[1];
    expect(block).toBeDefined();
    return spawnSync(
      "/bin/bash",
      [
        "-e",
        "-o",
        "pipefail",
        "-c",
        `
      gh() { printf '%s\\n' "$TEST_RUN"; }
      git() {
        case "$1" in
          rev-parse) printf '%s\\n' "$RELEASE_SHA" ;;
          merge-base) return 0 ;;
          diff) printf '%s\\n' "$TEST_CHANGED" ;;
          *) return 1 ;;
        esac
      }
      ${block!.replace(/^ {10}/gmu, "")}
    `,
      ],
      {
        env: {
          ...process.env,
          RELEASE_SHA: sha,
          CI_RUN_ID: "123",
          MACOS_ONLY: String(macosOnly),
          TEST_RUN: JSON.stringify(metadata),
          TEST_CHANGED: changed,
        },
        encoding: "utf8",
      },
    ).status;
  }
  it("reuses all three successful macOS checks while Windows is queued or cancelled", () => {
    expect(check(run())).toBe(0);
    expect(check({ ...run(), conclusion: "cancelled" })).toBe(0);
  });
  it.each(macNames)("rejects unsuccessful, missing or duplicate %s", (name) => {
    for (const conclusion of ["failure", "cancelled", "skipped", ""]) {
      const metadata = run();
      metadata.jobs.find((job) => job.name === name)!.conclusion = conclusion;
      expect(check(metadata)).not.toBe(0);
    }
    const missing = run();
    missing.jobs = missing.jobs.filter((job) => job.name !== name);
    expect(check(missing)).not.toBe(0);
    const duplicate = run();
    duplicate.jobs.push({
      ...duplicate.jobs.find((job) => job.name === name)!,
    });
    expect(check(duplicate)).not.toBe(0);
  });
  it("preserves the full-CI success requirement for a two-platform release", () => {
    expect(check(run(), false)).not.toBe(0);
    expect(check({ ...run(), conclusion: "success" }, false)).toBe(0);
  });
  it("rejects non-CI workflows, invalid commits and application changes", () => {
    expect(check({ ...run(), workflowName: "Release" })).not.toBe(0);
    expect(check({ ...run(), headSha: "invalid" })).not.toBe(0);
    expect(check(run(), true, "apps/desktop/src/main/main.ts")).not.toBe(0);
    expect(check(run(), true, "package-lock.json")).not.toBe(0);
  });
  it("allows only the named release assembly and documentation changes", () => {
    for (const changed of [
      "scripts/collect-release-assets.mjs",
      "apps/desktop/test/collect-release-assets.test.ts",
      "apps/desktop/test/release-workflow-reuse.test.ts",
      "docs/records/release-notes.md",
      "README.md",
    ]) {
      expect(check(run(), true, changed)).toBe(0);
    }
  });
});

describe.skipIf(process.platform === "win32")(
  "verified Windows release reuse",
  () => {
    it("requires successful Release verification of the exact source commit", () => {
      const block = workflow.match(
        /- name: Verify completed Windows package before reusing it[\s\S]*?run: \|\n((?: {10}[^\n]*\n)+)/u,
      )?.[1];
      expect(block).toBeDefined();
      const script = block!.replace(/^ {10}/gmu, "");
      const sha = "a".repeat(40);
      for (const [result, success] of [
        [`${sha} Release 1`, true],
        [`${"b".repeat(40)} Release 1`, false],
        [`${sha} Release 0`, false],
        [`${sha} CI 1`, false],
      ] as const) {
        const checked = spawnSync(
          "/bin/bash",
          [
            "-e",
            "-o",
            "pipefail",
            "-c",
            `gh() { printf '%s\\n' "$TEST_RUN"; }\n${script}`,
          ],
          {
            env: {
              ...process.env,
              WINDOWS_RUN_ID: "123",
              RELEASE_SHA: sha,
              TEST_RUN: result,
            },
            encoding: "utf8",
          },
        );
        expect(checked.status === 0).toBe(success);
      }
    });
  },
);
