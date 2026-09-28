import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

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
