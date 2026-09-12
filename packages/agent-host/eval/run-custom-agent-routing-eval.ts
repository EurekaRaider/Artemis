/**
 * Automatic-delegation evaluation harness (D#152 plan section 10).
 *
 * Runs the fixed human-labeled task set (custom-agent-routing-cases.ts)
 * through the REAL spawn_agent tool execution entry — one fresh thread
 * per case — and scores the durable routing audit that each spawn
 * produces. The deterministic gates must pass at 100%; the report is
 * byte-reproducible so a routing change fails CI until the report is
 * regenerated (ARTEMIS_EVAL_UPDATE=1).
 *
 * The deterministic lexical layer makes no model calls: tokens and cost
 * are exactly zero and wall-clock is recorded only in console output,
 * never in the committed report. The probabilistic (model-semantic)
 * comparison is a separate live-model procedure described in the report;
 * the routing-off baseline is derived analytically because with no
 * automatic catalog every case degenerates to a free role.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentPayload } from "@artemis/protocol";

import { ArtemisAgentHost } from "../src/runtime.js";
import {
  EVAL_CASES,
  EVAL_CATALOG,
  type EvalCase,
} from "./custom-agent-routing-cases.js";

type RoutePayload = Extract<AgentPayload, { type: "custom-agent.route" }>;

interface InspectableTool {
  name: string;
  execute(
    toolCallId: string,
    parameters: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

export interface EvalCaseResult {
  caseId: string;
  label: EvalCase["label"];
  decision: RoutePayload["decision"] | "tool-error";
  candidateIds: string[];
  selectedId?: string;
  spawnedInstances: number;
  duplicateWork: boolean;
  expectedOutcome: boolean;
}

export interface EvalMetrics {
  caseCount: number;
  /** should-pick cases whose candidates were exactly the labeled one. */
  correctSelectionRate: number;
  /** no-delegation cases that produced any candidate. */
  falsePositiveRate: number;
  /** should-pick cases missing the labeled candidate. */
  missRate: number;
  /** ambiguous cases that surfaced exactly the labeled set. */
  ambiguityPreservedRate: number;
  /** instances materialized without an explicit id (must be 0). */
  duplicateWork: number;
  /** cases whose routing outcome matched the human label. */
  taskSuccessRate: number;
  gates: Array<{ name: string; passed: boolean }>;
}

interface ThreadStub {
  currentTurnId?: string;
  currentMode?: "execute" | "plan" | "review";
  selection?: { providerId: string; modelId: string; thinkingLevel: "off" };
  turnCustomAgents?: unknown;
  childAgents: Map<string, { customAgentSnapshot?: { definitionId: string } }>;
  executeTools: InspectableTool[];
  session: {
    sendCustomMessage(message: unknown, options?: unknown): Promise<void>;
  };
}

async function runCase(evalCase: EvalCase): Promise<EvalCaseResult> {
  const workspace = await mkdtemp(join(tmpdir(), "artemis-eval-"));
  try {
    const routes: RoutePayload[] = [];
    const host = new ArtemisAgentHost(
      { request: async () => ({ approved: false }) },
      {
        emit(_thread, _turn, payload) {
          if (payload.type === "custom-agent.route") routes.push(payload);
        },
      },
    );
    await host.openThread({
      threadId: "thread-1",
      workspacePath: workspace,
      target: "local",
    });
    const internals = host as unknown as {
      configuration: { customAgents?: unknown };
      threads: Map<string, ThreadStub>;
      concurrency: {
        run<T>(kind: "child", task: () => Promise<T>): Promise<T>;
      };
    };
    internals.configuration.customAgents = EVAL_CATALOG;
    const thread = internals.threads.get("thread-1")!;
    thread.currentTurnId = "turn-1";
    thread.currentMode = "execute";
    thread.selection = {
      providerId: "kimi-coding",
      modelId: "k3",
      thinkingLevel: "off",
    };
    thread.turnCustomAgents = EVAL_CATALOG;
    thread.session.sendCustomMessage = async () => undefined;
    internals.concurrency = {
      run: <T>() => new Promise<T>(() => undefined),
    };
    const spawn = thread.executeTools.find(
      (tool) => tool.name === "spawn_agent",
    )!;

    let toolError: unknown;
    try {
      await spawn.execute("spawn-1", {
        label: evalCase.id,
        ...(evalCase.role !== undefined ? { role: evalCase.role } : {}),
        ...(evalCase.agentId !== undefined ? { agent: evalCase.agentId } : {}),
        task: evalCase.task,
      });
    } catch (error) {
      toolError = error;
    }

    const route = routes.at(-1);
    const instances = thread.childAgents.size;
    const explicitInstances = [...thread.childAgents.values()].filter(
      (child) => child.customAgentSnapshot !== undefined,
    ).length;
    // Duplicate work: an instance materialized although the case offered
    // no explicit id (the router must never auto-accept).
    const duplicateWork =
      evalCase.agentId === undefined && explicitInstances > 0;

    const decision: EvalCaseResult["decision"] = route
      ? route.decision
      : toolError
        ? "tool-error"
        : "free-role";
    const candidateIds =
      route?.candidates.map((candidate) => candidate.definitionId) ?? [];
    const selectedId = route?.selectedDefinitionId;

    const expected = evalCase.expect;
    const sameSet = (a: readonly string[], b: readonly string[]) =>
      a.length === b.length && a.every((id) => b.includes(id));
    const expectedOutcome =
      expected.decision === "accepted"
        ? decision === "accepted" && selectedId === expected.selectedId
        : decision === expected.decision &&
          sameSet(candidateIds, expected.candidateIds) &&
          (expected.decision !== "reference-required" ||
            (toolError instanceof Error &&
              toolError.message.includes("CUSTOM_AGENT_REFERENCE_REQUIRED")));

    host.dispose();
    return {
      caseId: evalCase.id,
      label: evalCase.label,
      decision,
      candidateIds,
      ...(selectedId !== undefined ? { selectedId } : {}),
      spawnedInstances: instances,
      duplicateWork,
      expectedOutcome,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

export async function runRoutingEvaluation(): Promise<{
  results: EvalCaseResult[];
  metrics: EvalMetrics;
  report: string;
}> {
  const results: EvalCaseResult[] = [];
  for (const evalCase of EVAL_CASES) {
    results.push(await runCase(evalCase));
  }

  const shouldPick = results.filter((result) => result.label === "should-pick");
  const noDelegation = results.filter(
    (result) =>
      (result.label === "should-not-delegate" ||
        result.label === "no-match" ||
        result.label === "boundary-safety" ||
        result.label === "manual-only-control") &&
      EVAL_CASES.find((c) => c.id === result.caseId)?.expect.decision ===
        "free-role",
  );
  const ambiguous = results.filter((result) => result.label === "ambiguous");
  const referenceRequired = results.filter(
    (result) =>
      result.decision === "reference-required" ||
      EVAL_CASES.find((c) => c.id === result.caseId)?.expect.decision ===
        "reference-required",
  );

  const metrics: EvalMetrics = {
    caseCount: results.length,
    correctSelectionRate: rate(
      shouldPick.filter(
        (result) => result.decision === "advisory" && result.expectedOutcome,
      ).length,
      shouldPick.length,
    ),
    falsePositiveRate: rate(
      noDelegation.filter((result) => result.candidateIds.length > 0).length,
      noDelegation.length,
    ),
    missRate: rate(
      shouldPick.filter((result) => !result.expectedOutcome).length,
      shouldPick.length,
    ),
    ambiguityPreservedRate: rate(
      ambiguous.filter((result) => result.expectedOutcome).length,
      ambiguous.length,
    ),
    duplicateWork: results.filter((result) => result.duplicateWork).length,
    taskSuccessRate: rate(
      results.filter((result) => result.expectedOutcome).length,
      results.length,
    ),
    gates: [
      {
        name: "P1 reference-required corrections fired with the right candidate",
        passed: referenceRequired.every((result) => result.expectedOutcome),
      },
      {
        name: "No automatic acceptance (duplicate work = 0)",
        passed: results.every((result) => !result.duplicateWork),
      },
      {
        name: "Explicit id is never overridden by trigger words",
        passed: results
          .filter((result) => result.label === "explicit-override")
          .every((result) => result.expectedOutcome),
      },
      {
        name: "Every labeled outcome achieved (100% deterministic gate)",
        passed: results.every((result) => result.expectedOutcome),
      },
    ],
  };

  return { results, metrics, report: renderReport(results, metrics) };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function renderReport(results: EvalCaseResult[], metrics: EvalMetrics): string {
  const lines: string[] = [
    "# Custom sub-agent automatic-delegation evaluation",
    "",
    "D#152 PR5. Fixed synthetic task set (`eval/custom-agent-routing-cases.ts`)",
    "run through the real `spawn_agent` tool entry; decisions are read from the",
    "durable `custom-agent.route` audit each spawn produces. Regenerate with:",
    "",
    "```",
    "ARTEMIS_EVAL_UPDATE=1 npx vitest run test/custom-agent-routing-eval.test.ts",
    "```",
    "",
    "## Metrics (deterministic layer)",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Cases | ${metrics.caseCount} |`,
    `| Correct-selection rate (should-pick) | ${percent(metrics.correctSelectionRate)} |`,
    `| False-positive rate (no-delegation) | ${percent(metrics.falsePositiveRate)} |`,
    `| Miss rate (should-pick) | ${percent(metrics.missRate)} |`,
    `| Ambiguity preserved | ${percent(metrics.ambiguityPreservedRate)} |`,
    `| Duplicate work (auto-accepted instances) | ${metrics.duplicateWork} |`,
    `| Task success rate (labeled outcome achieved) | ${percent(metrics.taskSuccessRate)} |`,
    "| Model tokens | 0 (lexical layer makes no model calls) |",
    "| Cost | 0 |",
    "| Wall-clock | recorded in console output, not in this report |",
    "",
    "## Gates (all must pass)",
    "",
    "| Gate | Result |",
    "| --- | --- |",
    ...metrics.gates.map(
      (gate) => `| ${gate.name} | ${gate.passed ? "PASS" : "FAIL"} |`,
    ),
    "",
    "## Per-case outcomes",
    "",
    "| Case | Label | Decision | Candidates | Instances | Expected met |",
    "| --- | --- | --- | --- | --- | --- |",
    ...results.map(
      (result) =>
        `| ${result.caseId} | ${result.label} | ${result.decision} | ${
          result.candidateIds.join(", ") || "—"
        } | ${result.spawnedInstances} | ${result.expectedOutcome ? "yes" : "NO"} |`,
    ),
    "",
    "## Baseline (automatic routing off)",
    "",
    "With the automatic catalog empty every case degenerates to a free role:",
    "correct-selection 0.0%, miss rate 100.0% on should-pick, false-positive",
    "0.0%, duplicate work 0. This baseline is derived analytically and pinned",
    "by the empty-catalog control in `test/custom-agent-routing.test.ts`.",
    "",
    "## Probabilistic (model-semantic) comparison",
    "",
    "The P2 semantic choice is model behavior and is not promised to match",
    "100%. Procedure for a live-model run: pin provider/model/thinking in the",
    "desktop settings, run each should-pick and ambiguous task as a real turn,",
    "and read `custom-agent.route` audits for selected vs candidate ids.",
    "Compare correct-selection/false-positive/miss against the baseline above",
    "under the fixed configuration; record tokens and cost from turn usage.",
    "This report intentionally ships without live-model numbers.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}
