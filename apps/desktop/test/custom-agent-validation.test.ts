/**
 * PR4 tests for the custom sub-agent validation module (D#152).
 *
 * Pins the main-process validation contract: field budgets from the
 * protocol constants, controlled color tokens, project existence by
 * stable identity, the selected-with-zero-links rejection, strict
 * policy shapes, and the invocation fingerprint/send-reference rules.
 */

import { describe, expect, it } from "vitest";

import {
  CUSTOM_AGENT_COLOR_TOKENS,
  customAgentRequestFingerprint,
  validateCustomAgentInput,
  validateCustomAgentSendReference,
} from "../src/main/custom-agent-validation.js";

const KNOWN_PROJECTS = new Set(["proj-1", "proj-2"]);
const projectExists = (projectId: string) => KNOWN_PROJECTS.has(projectId);

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "code-reviewer",
    description: "Reviews changes",
    color: "green",
    instructions: "Review carefully.",
    scope: "selected",
    projectIds: ["proj-1"],
    modelPolicy: { kind: "inherit" },
    thinkingPolicy: { kind: "inherit" },
    toolPolicy: { kind: "inherit" },
    allowAutomaticInvocation: false,
    triggers: ["review"],
    ...overrides,
  };
}

describe("validateCustomAgentInput", () => {
  it("accepts a valid selected-scope definition and normalizes fields", () => {
    const result = validateCustomAgentInput(
      validInput({ name: "  Code   Reviewer  " }),
      projectExists,
    );
    expect(result.name).toBe("Code Reviewer");
    expect(result.scope).toBe("selected");
    expect(result.projectIds).toEqual(["proj-1"]);
  });

  it("rejects selected scope with zero projects instead of widening to all", () => {
    expect(() =>
      validateCustomAgentInput(
        validInput({ scope: "selected", projectIds: [] }),
        projectExists,
      ),
    ).toThrowError(/CUSTOM_AGENT_INVALID/);
  });

  it("allows scope=all with zero projects", () => {
    const result = validateCustomAgentInput(
      validInput({ scope: "all", projectIds: [] }),
      projectExists,
    );
    expect(result.scope).toBe("all");
    expect(result.projectIds).toEqual([]);
  });

  it("rejects unknown project ids (identity, never paths)", () => {
    expect(() =>
      validateCustomAgentInput(
        validInput({ projectIds: ["proj-1", "/tmp/arbitrary/path"] }),
        projectExists,
      ),
    ).toThrowError(/CUSTOM_AGENT_INVALID.*project does not exist/);
  });

  it("rejects colors outside the controlled token list", () => {
    expect(() =>
      validateCustomAgentInput(validInput({ color: "#ff00aa" }), projectExists),
    ).toThrowError(/CUSTOM_AGENT_INVALID.*color/);
    expect(CUSTOM_AGENT_COLOR_TOKENS).toContain("green");
  });

  it("enforces the protocol budgets for name, description, instructions, triggers", () => {
    expect(() =>
      validateCustomAgentInput(validInput({ name: "x".repeat(65) }), projectExists),
    ).toThrowError(/CUSTOM_AGENT_INVALID.*name/);
    expect(() =>
      validateCustomAgentInput(
        validInput({ description: "x".repeat(513) }),
        projectExists,
      ),
    ).toThrowError(/CUSTOM_AGENT_INVALID.*description/);
    expect(() =>
      validateCustomAgentInput(
        validInput({ instructions: "领".repeat(16 * 1024) }),
        projectExists,
      ),
    ).toThrowError(/CUSTOM_AGENT_INVALID.*instructions/);
    expect(() =>
      validateCustomAgentInput(
        validInput({ triggers: Array.from({ length: 17 }, (_, i) => `t${i}`) }),
        projectExists,
      ),
    ).toThrowError(/CUSTOM_AGENT_INVALID.*trigger/);
  });

  it("keeps inherit and empty allowlist strictly distinct", () => {
    const inherited = validateCustomAgentInput(
      validInput({ toolPolicy: { kind: "inherit" } }),
      projectExists,
    );
    expect(inherited.toolPolicy.kind).toBe("inherit");
    const empty = validateCustomAgentInput(
      validInput({ toolPolicy: { kind: "allowlist", tools: [] } }),
      projectExists,
    );
    expect(empty.toolPolicy).toEqual({ kind: "allowlist", tools: [] });
  });

  it("accepts builtin and MCP tool references by stable identifiers", () => {
    const result = validateCustomAgentInput(
      validInput({
        toolPolicy: {
          kind: "allowlist",
          tools: [
            { kind: "builtin", toolId: "shell" },
            { kind: "mcp", serverId: "srv-1", toolName: "search" },
          ],
        },
      }),
      projectExists,
    );
    expect(result.toolPolicy).toEqual({
      kind: "allowlist",
      tools: [
        { kind: "builtin", toolId: "shell" },
        { kind: "mcp", serverId: "srv-1", toolName: "search" },
      ],
    });
  });

  it("rejects malformed policies and tool references", () => {
    expect(() =>
      validateCustomAgentInput(
        validInput({ modelPolicy: { kind: "fixed", providerId: "p" } }),
        projectExists,
      ),
    ).toThrowError(/CUSTOM_AGENT_INVALID.*model/);
    expect(() =>
      validateCustomAgentInput(
        validInput({ thinkingPolicy: { kind: "fixed" } }),
        projectExists,
      ),
    ).toThrowError(/CUSTOM_AGENT_INVALID.*thinking/);
    expect(() =>
      validateCustomAgentInput(
        validInput({
          toolPolicy: { kind: "allowlist", tools: [{ kind: "mcp", serverId: "s" }] },
        }),
        projectExists,
      ),
    ).toThrowError(/CUSTOM_AGENT_INVALID.*MCP/);
  });
});

describe("customAgentRequestFingerprint", () => {
  const base = {
    threadId: "thread-1",
    text: "review the diff",
    attachmentIds: ["att-2", "att-1"],
    definitionId: "def-1",
    revision: 2,
  };

  it("is stable across attachment ordering and differs on content changes", () => {
    const a = customAgentRequestFingerprint(base);
    const b = customAgentRequestFingerprint({
      ...base,
      attachmentIds: ["att-1", "att-2"],
    });
    expect(a).toBe(b);
    expect(
      customAgentRequestFingerprint({ ...base, text: "review it again" }),
    ).not.toBe(a);
    expect(
      customAgentRequestFingerprint({ ...base, revision: 3 }),
    ).not.toBe(a);
    expect(
      customAgentRequestFingerprint({ ...base, threadId: "thread-2" }),
    ).not.toBe(a);
  });
});

describe("validateCustomAgentSendReference", () => {
  it("accepts a well-formed structured reference", () => {
    expect(
      validateCustomAgentSendReference({
        definitionId: "def-1",
        revision: 2,
        invocationId: "inv-1",
      }),
    ).toEqual({ definitionId: "def-1", revision: 2, invocationId: "inv-1" });
  });

  it("rejects missing ids and non-integer revisions", () => {
    expect(() =>
      validateCustomAgentSendReference({ definitionId: "", revision: 2, invocationId: "i" }),
    ).toThrowError(/CUSTOM_AGENT_INVALID/);
    expect(() =>
      validateCustomAgentSendReference({
        definitionId: "d",
        revision: 0,
        invocationId: "i",
      }),
    ).toThrowError(/CUSTOM_AGENT_INVALID.*revision/);
    expect(() => validateCustomAgentSendReference(null)).toThrowError(
      /CUSTOM_AGENT_INVALID/,
    );
  });
});
