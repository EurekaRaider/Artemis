/**
 * PR1 policy regression tests for the custom sub-agent contract (D#152).
 *
 * These tests pin the approved plan's hard semantics before any storage,
 * runtime, or UI exists: scope must never widen silently, capabilities
 * are an intersection that can only shrink, empty allowlists are not
 * inheritance, frozen snapshots are immutable, invocation dedup never
 * silently re-dispatches, and P1 lexical matching is deterministic
 * without substring false positives.
 */

import { describe, expect, it } from "vitest";

import {
  CUSTOM_AGENT_CATALOG_MAX_DEFINITIONS,
  CUSTOM_AGENT_CATALOG_TEXT_BUDGET,
  CUSTOM_AGENT_ERROR_CODES,
  canTransitionInvocation,
  checkCatalogBudget,
  computeEffectiveCapabilities,
  freezeInstanceSnapshot,
  hasLatinWordBoundaryHit,
  isDefinitionEffectiveForProject,
  matchCatalogLexically,
  normalizeAgentToken,
  orderCatalogEntries,
  runModeCapabilities,
  type CapabilityClass,
  type CapabilityContext,
  type CustomAgentCatalogEntry,
  type CustomAgentToolRef,
} from "../src/index.js";

const ALL_CAPABILITIES: CapabilityClass[] = [
  "shell",
  "filesystem-write",
  "mcp",
  "executable-extension",
  "spawn-agent",
  "business-read",
];

function fullContext(mode: "execute" | "plan" | "review"): CapabilityContext {
  return {
    runMode: mode,
    childBaseline: new Set(ALL_CAPABILITIES),
    parentDelegatable: new Set(ALL_CAPABILITIES),
    liveGrants: new Set(ALL_CAPABILITIES),
  };
}

const resolveNothing = () => new Set<CapabilityClass>();

describe("custom agent scope resolution", () => {
  it("scope=selected with zero links applies to no project, never widens to all", () => {
    const definition = { enabled: true, scope: "selected" as const };
    // This is the core regression: deleting the last project link (and its
    // cascade) must turn the definition inert, not global.
    expect(isDefinitionEffectiveForProject(definition, [], "project-a")).toBe(
      false,
    );
    expect(isDefinitionEffectiveForProject(definition, [], "project-b")).toBe(
      false,
    );
  });

  it("scope=selected only applies to linked projects", () => {
    const definition = { enabled: true, scope: "selected" as const };
    expect(
      isDefinitionEffectiveForProject(definition, ["project-a"], "project-a"),
    ).toBe(true);
    expect(
      isDefinitionEffectiveForProject(definition, ["project-a"], "project-b"),
    ).toBe(false);
  });

  it("projectless tasks can only use scope=all definitions", () => {
    expect(
      isDefinitionEffectiveForProject(
        { enabled: true, scope: "all" },
        [],
        null,
      ),
    ).toBe(true);
    expect(
      isDefinitionEffectiveForProject(
        { enabled: true, scope: "selected" },
        ["project-a"],
        null,
      ),
    ).toBe(false);
  });

  it("disabled definitions are never effective", () => {
    expect(
      isDefinitionEffectiveForProject(
        { enabled: false, scope: "all" },
        [],
        "project-a",
      ),
    ).toBe(false);
  });
});

describe("run mode capability baselines", () => {
  it("plan and review never allow shell, mcp, extensions, writes, or spawning", () => {
    for (const mode of ["plan", "review"] as const) {
      const caps = runModeCapabilities(mode);
      expect(caps.has("shell")).toBe(false);
      expect(caps.has("mcp")).toBe(false);
      expect(caps.has("executable-extension")).toBe(false);
      expect(caps.has("filesystem-write")).toBe(false);
      expect(caps.has("spawn-agent")).toBe(false);
      expect(caps.has("business-read")).toBe(true);
    }
  });
});

describe("effective capability intersection", () => {
  it("never widens beyond any layer, even when the definition inherits", () => {
    const context = fullContext("execute");
    context.parentDelegatable = new Set<CapabilityClass>([
      "business-read",
      "shell",
    ]);
    const effective = computeEffectiveCapabilities(
      context,
      { kind: "inherit" },
      resolveNothing,
    );
    expect(effective.has("shell")).toBe(true);
    expect(effective.has("filesystem-write")).toBe(false);
    expect(effective.has("mcp")).toBe(false);
  });

  it("empty allowlist means no business tools and never falls back to inherit", () => {
    const effective = computeEffectiveCapabilities(
      fullContext("execute"),
      { kind: "allowlist", tools: [] },
      resolveNothing,
    );
    expect(effective.size).toBe(0);
  });

  it("allowlist grants only the capabilities of the listed tools", () => {
    const resolver = (ref: CustomAgentToolRef) =>
      ref.kind === "mcp" && ref.toolName === "query_db"
        ? new Set<CapabilityClass>(["mcp", "business-read"])
        : new Set<CapabilityClass>();
    const effective = computeEffectiveCapabilities(
      fullContext("execute"),
      {
        kind: "allowlist",
        tools: [{ kind: "mcp", serverId: "db", toolName: "query_db" }],
      },
      resolver,
    );
    expect(effective.has("mcp")).toBe(true);
    expect(effective.has("shell")).toBe(false);
    expect(effective.has("filesystem-write")).toBe(false);
  });

  it("plan/review mode strips capabilities even when the allowlist names a tool", () => {
    const resolver = () => new Set<CapabilityClass>(["shell"]);
    const effective = computeEffectiveCapabilities(
      fullContext("plan"),
      { kind: "allowlist", tools: [{ kind: "builtin", toolId: "shell" }] },
      resolver,
    );
    expect(effective.has("shell")).toBe(false);
    expect(effective.has("business-read")).toBe(false);
  });

  it("revoked live grants shrink the result at execution time", () => {
    const context = fullContext("execute");
    context.liveGrants = new Set<CapabilityClass>(["business-read"]);
    const effective = computeEffectiveCapabilities(
      context,
      { kind: "inherit" },
      resolveNothing,
    );
    expect([...effective]).toEqual(["business-read"]);
  });

  it("custom definitions never receive spawn-agent, regardless of inputs", () => {
    const effective = computeEffectiveCapabilities(
      fullContext("execute"),
      { kind: "inherit" },
      resolveNothing,
    );
    expect(effective.has("spawn-agent")).toBe(false);
  });
});

describe("frozen instance snapshots", () => {
  function makeSnapshot() {
    return freezeInstanceSnapshot({
      definitionId: "def-1",
      definitionRevision: 3,
      definitionName: "code-reviewer",
      instructions: "Review changes carefully.",
      catalogId: "catalog-1",
      projectId: "project-a",
      resolvedModel: {
        providerId: "kimi-coding",
        modelId: "k3",
        thinkingLevel: null,
      },
      effectiveCapabilities: ["business-read"],
      invocationSource: "user-explicit",
      selectionBasis: "explicit-reference",
      frozenAt: 1_700_000_000_000,
    });
  }

  it("snapshots are deeply frozen at the contract boundary", () => {
    const snapshot = makeSnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.effectiveCapabilities)).toBe(true);
    expect(() => {
      (snapshot as { definitionRevision: number }).definitionRevision = 4;
    }).toThrow(TypeError);
    expect(snapshot.definitionRevision).toBe(3);
  });

  it("model identity in the snapshot is fixed and does not follow later parent switches", () => {
    const snapshot = makeSnapshot();
    expect(snapshot.resolvedModel.modelId).toBe("k3");
    // A later parent switch is represented by a NEW snapshot; the accepted
    // instance keeps its frozen model.
    const later = makeSnapshot();
    expect(later.resolvedModel).toEqual(snapshot.resolvedModel);
  });
});

describe("invocation record state machine", () => {
  it("pending can commit, cancel, or become unknown", () => {
    expect(canTransitionInvocation("pending", "dispatch-committed")).toBe(true);
    expect(canTransitionInvocation("pending", "cancelled")).toBe(true);
    expect(canTransitionInvocation("pending", "outcome-unknown")).toBe(true);
    expect(canTransitionInvocation("pending", "finished")).toBe(false);
    expect(canTransitionInvocation("pending", "pending")).toBe(false);
  });

  it("outcome-unknown never returns to an executable state", () => {
    // After an ambiguous crash the system must not silently re-dispatch;
    // re-execution requires a NEW invocationId chosen by the user.
    expect(canTransitionInvocation("outcome-unknown", "pending")).toBe(false);
    expect(
      canTransitionInvocation("outcome-unknown", "dispatch-committed"),
    ).toBe(false);
    expect(canTransitionInvocation("outcome-unknown", "finished")).toBe(true);
    expect(canTransitionInvocation("outcome-unknown", "cancelled")).toBe(true);
  });

  it("finished and cancelled are terminal", () => {
    for (const terminal of ["finished", "cancelled"] as const) {
      for (const target of [
        "pending",
        "dispatch-committed",
        "finished",
        "cancelled",
        "outcome-unknown",
      ] as const) {
        expect(canTransitionInvocation(terminal, target)).toBe(false);
      }
    }
  });
});

describe("P1 lexical matching", () => {
  const entries: CustomAgentCatalogEntry[] = [
    {
      definitionId: "def-review",
      revision: 1,
      name: "code-reviewer",
      description: "Reviews code changes",
      scope: "all",
      allowAutomaticInvocation: true,
      triggers: ["审查", "review"],
    },
    {
      definitionId: "def-docs",
      revision: 1,
      name: "doc-scout",
      description: "Finds documentation",
      scope: "all",
      allowAutomaticInvocation: true,
      triggers: ["PR"],
    },
  ];

  it("normalization is NFC + case-fold + whitespace collapse", () => {
    expect(normalizeAgentToken("  Code\u0301-Reviewer  X ")).toBe(
      "cod\u00e9-reviewer x",
    );
  });

  it("exact role-name match hits the unique definition", () => {
    const result = matchCatalogLexically(entries, "Code-Reviewer", "anything");
    expect(result.exactNameMatch?.definitionId).toBe("def-review");
    expect(result.ambiguous).toBe(false);
  });

  it("latin triggers require word boundaries: PR never substring-hits approve", () => {
    expect(hasLatinWordBoundaryHit("approve the pr", "pr")).toBe(true);
    expect(hasLatinWordBoundaryHit("approval flow", "pr")).toBe(false);
    const result = matchCatalogLexically(
      entries,
      null,
      "please approve this change",
    );
    expect(result.triggerCandidates).toEqual([]);
  });

  it("CJK triggers match as substrings", () => {
    const result = matchCatalogLexically(entries, null, "帮我审查一下改动");
    expect(result.triggerCandidates.map((e) => e.definitionId)).toEqual([
      "def-review",
    ]);
  });

  it("multiple trigger hits are ambiguous candidates, never auto-picked", () => {
    const result = matchCatalogLexically(entries, null, "review this PR");
    expect(result.exactNameMatch).toBeNull();
    expect(result.ambiguous).toBe(true);
    expect(result.triggerCandidates).toHaveLength(2);
  });

  it("an explicit exact-name match suppresses trigger candidacy", () => {
    const result = matchCatalogLexically(
      entries,
      "doc-scout",
      "review this PR",
    );
    expect(result.exactNameMatch?.definitionId).toBe("def-docs");
    expect(result.triggerCandidates).toEqual([]);
  });
});

describe("catalog ordering and budgets", () => {
  const selectedEntry: CustomAgentCatalogEntry = {
    definitionId: "def-b",
    revision: 1,
    name: "beta",
    description: "project-specific",
    scope: "selected",
    allowAutomaticInvocation: true,
    triggers: [],
  };
  const allEntry: CustomAgentCatalogEntry = {
    definitionId: "def-a",
    revision: 1,
    name: "alpha",
    description: "global",
    scope: "all",
    allowAutomaticInvocation: true,
    triggers: [],
  };

  it("orders project-selected definitions before all-projects, then stable name/id", () => {
    const links = new Map([["def-b", ["project-a"] as const]]);
    const ordered = orderCatalogEntries(
      [allEntry, selectedEntry],
      "project-a",
      links,
    );
    expect(ordered.map((e) => e.definitionId)).toEqual(["def-b", "def-a"]);
    // Ordering is stable and never recency-based.
    const again = orderCatalogEntries(
      [selectedEntry, allEntry],
      "project-a",
      links,
    );
    expect(again.map((e) => e.definitionId)).toEqual(["def-b", "def-a"]);
  });

  it("budget overflow is surfaced, never silently truncated", () => {
    const many: CustomAgentCatalogEntry[] = Array.from(
      { length: CUSTOM_AGENT_CATALOG_MAX_DEFINITIONS + 1 },
      (_, i) => ({ ...allEntry, definitionId: `def-${i}`, name: `n${i}` }),
    );
    const result = checkCatalogBudget(many);
    expect(result.withinBudget).toBe(false);
    expect(result.definitionCount).toBe(
      CUSTOM_AGENT_CATALOG_MAX_DEFINITIONS + 1,
    );
    expect(CUSTOM_AGENT_CATALOG_TEXT_BUDGET).toBeGreaterThan(0);
  });
});

describe("error codes", () => {
  it("pins the contract error code set", () => {
    expect([...CUSTOM_AGENT_ERROR_CODES]).toEqual([
      "CUSTOM_AGENT_NOT_FOUND",
      "CUSTOM_AGENT_DISABLED",
      "CUSTOM_AGENT_OUT_OF_SCOPE",
      "CUSTOM_AGENT_REVISION_CONFLICT",
      "CUSTOM_AGENT_REFERENCE_REQUIRED",
      "CUSTOM_AGENT_AMBIGUOUS_REFERENCE",
      "CUSTOM_AGENT_MODEL_UNAVAILABLE",
      "CUSTOM_AGENT_THINKING_INCOMPATIBLE",
      "CUSTOM_AGENT_NESTED_DELEGATION_DENIED",
      "INVOCATION_CONFLICT",
      "INVOCATION_OUTCOME_UNKNOWN",
    ]);
  });
});
