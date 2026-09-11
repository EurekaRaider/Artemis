/**
 * Evaluation gate for automatic delegation (D#152 PR5): runs the fixed
 * human-labeled task set through the real tool entry, requires every
 * deterministic gate at 100%, and pins the committed report so routing
 * changes are deliberate (regenerate with ARTEMIS_EVAL_UPDATE=1).
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runRoutingEvaluation } from "../eval/run-custom-agent-routing-eval.js";

const REPORT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../eval/custom-agent-routing-report.md",
);

describe("custom agent routing evaluation", () => {
  it("passes every deterministic gate on the labeled task set", async () => {
    const { results, metrics, report } = await runRoutingEvaluation();

    for (const result of results) {
      expect(
        result.expectedOutcome,
        `${result.caseId} (${result.label}): expected outcome not met — decision ${result.decision}, candidates [${result.candidateIds.join(", ")}]`,
      ).toBe(true);
      expect(result.duplicateWork).toBe(false);
    }
    expect(metrics.correctSelectionRate).toBe(1);
    expect(metrics.falsePositiveRate).toBe(0);
    expect(metrics.missRate).toBe(0);
    expect(metrics.ambiguityPreservedRate).toBe(1);
    expect(metrics.taskSuccessRate).toBe(1);
    expect(metrics.gates.every((gate) => gate.passed)).toBe(true);

    if (process.env.ARTEMIS_EVAL_UPDATE === "1") {
      await writeFile(REPORT_PATH, report);
      return;
    }
    const committed = await readFile(REPORT_PATH, "utf8");
    expect(
      report,
      "Routing evaluation report drifted — regenerate with ARTEMIS_EVAL_UPDATE=1",
    ).toBe(committed);
  }, 60_000);
});
