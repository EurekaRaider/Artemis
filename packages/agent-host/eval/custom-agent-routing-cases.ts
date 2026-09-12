/**
 * Fixed human-labeled synthetic task set for the automatic-delegation
 * evaluation (D#152 plan section 10). The catalog and cases are frozen:
 * changing routing behavior requires deliberately updating this file and
 * regenerating the report. Labels cover the four required classes —
 * should-not-delegate, should-pick, multi-definition ambiguity, and
 * no-match — plus the normalization and boundary safety rules fixed in
 * PR1 (Unicode NFC, case folding, Latin word boundaries, CJK substring).
 */

import type { CustomAgentDefinition } from "@artemis/protocol";

function evalDefinition(
  overrides: Partial<CustomAgentDefinition> & { id: string; name: string },
): CustomAgentDefinition {
  return {
    revision: 1,
    description: "",
    color: "gray",
    enabled: true,
    instructions: "Eval fixture.",
    scope: "all",
    modelPolicy: { kind: "inherit" },
    thinkingPolicy: { kind: "inherit" },
    toolPolicy: { kind: "inherit" },
    allowAutomaticInvocation: true,
    triggers: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

export const EVAL_CATALOG: CustomAgentDefinition[] = [
  evalDefinition({
    id: "eval-security",
    name: "security-auditor",
    description: "Audits code and configuration for security issues",
    triggers: ["security audit", "安全审计"],
  }),
  evalDefinition({
    id: "eval-compliance",
    name: "compliance-checker",
    description: "Checks changes against compliance rules",
    triggers: ["compliance review", "合规检查"],
  }),
  evalDefinition({
    id: "eval-reviewer",
    name: "code-reviewer",
    description: "Reviews diffs for correctness",
    triggers: ["code review", "代码审查", "PR"],
  }),
  evalDefinition({
    id: "eval-docs",
    name: "docs-writer",
    description: "Writes and updates documentation",
    triggers: ["documentation", "文档"],
  }),
  evalDefinition({
    id: "eval-release",
    name: "release-captain",
    description: "Drives release checklists",
    allowAutomaticInvocation: false,
    triggers: ["release checklist"],
  }),
];

export type EvalExpectation =
  | {
      /** A free role must proceed untouched, with no candidates. */
      decision: "free-role";
      candidateIds: [];
    }
  | {
      /** Trigger hits surface exactly these candidates, nothing is picked. */
      decision: "advisory";
      candidateIds: string[];
    }
  | {
      /** A role exactly naming one automatic definition demands its id. */
      decision: "reference-required";
      candidateIds: [string];
    }
  | {
      /** An explicit id always wins; trigger words never override it. */
      decision: "accepted";
      selectedId: string;
    };

export interface EvalCase {
  id: string;
  /** Human label: which required class this case belongs to. */
  label:
    | "should-not-delegate"
    | "should-pick"
    | "ambiguous"
    | "no-match"
    | "normalization"
    | "boundary-safety"
    | "manual-only-control"
    | "explicit-override";
  role?: string;
  agentId?: string;
  task: string;
  expect: EvalExpectation;
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: "C01",
    label: "should-not-delegate",
    role: "generalist",
    task: "Refactor the parser for clarity",
    expect: { decision: "free-role", candidateIds: [] },
  },
  {
    id: "C02",
    label: "no-match",
    role: "generalist",
    task: "Summarize the meeting notes into three bullets",
    expect: { decision: "free-role", candidateIds: [] },
  },
  {
    id: "C03",
    label: "should-pick",
    role: "generalist",
    task: "Run a security audit on the auth module",
    expect: { decision: "advisory", candidateIds: ["eval-security"] },
  },
  {
    id: "C04",
    label: "should-pick",
    role: "generalist",
    task: "请对这个仓库做安全审计",
    expect: { decision: "advisory", candidateIds: ["eval-security"] },
  },
  {
    id: "C05",
    label: "ambiguous",
    role: "assistant",
    task: "Run a security audit and a compliance review",
    expect: {
      decision: "advisory",
      candidateIds: ["eval-security", "eval-compliance"],
    },
  },
  {
    id: "C06",
    label: "ambiguous",
    role: "assistant",
    task: "先跑安全审计，再做合规检查",
    expect: {
      decision: "advisory",
      candidateIds: ["eval-security", "eval-compliance"],
    },
  },
  {
    id: "C07",
    label: "boundary-safety",
    role: "generalist",
    // "pr" inside "Approve" must never substring-hit the "PR" trigger.
    task: "Approve the change and merge it",
    expect: { decision: "free-role", candidateIds: [] },
  },
  {
    id: "C08",
    label: "normalization",
    role: "generalist",
    task: "Open a PR for the parser fix",
    expect: { decision: "advisory", candidateIds: ["eval-reviewer"] },
  },
  {
    id: "C09",
    label: "normalization",
    role: "Code-Reviewer",
    task: "review the diff",
    expect: { decision: "reference-required", candidateIds: ["eval-reviewer"] },
  },
  {
    id: "C10",
    label: "manual-only-control",
    role: "release-captain",
    task: "drive the release checklist",
    expect: { decision: "free-role", candidateIds: [] },
  },
  {
    id: "C11",
    label: "manual-only-control",
    role: "generalist",
    task: "walk the release checklist before tagging",
    expect: { decision: "free-role", candidateIds: [] },
  },
  {
    id: "C12",
    label: "should-not-delegate",
    role: "senior code-reviewer assistant",
    task: "look at the diff together",
    expect: { decision: "free-role", candidateIds: [] },
  },
  {
    id: "C13",
    label: "should-pick",
    role: "generalist",
    task: "Update the documentation for the HTTP API",
    expect: { decision: "advisory", candidateIds: ["eval-docs"] },
  },
  {
    id: "C14",
    label: "should-pick",
    role: "generalist",
    task: "补充安装文档",
    expect: { decision: "advisory", candidateIds: ["eval-docs"] },
  },
  {
    id: "C15",
    label: "explicit-override",
    agentId: "eval-docs",
    // The task hits the security trigger, but the explicit choice must
    // win with no advisory attached (user P0 over trigger words).
    task: "run a security audit write-up",
    expect: { decision: "accepted", selectedId: "eval-docs" },
  },
];
