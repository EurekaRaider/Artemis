/**
 * Custom sub-agent definitions (D#152): user-level, reusable child-agent
 * definitions with project scoping, model/tool policy, and deterministic
 * invocation routing.
 *
 * This module is the PR1 contract layer: types, error codes, budgets, and
 * the pure policy functions (scope resolution, effective-capability
 * intersection, snapshot freezing, P1 lexical matching, invocation
 * record state machine). Persistence (PR2), runtime wiring (PR3), UI
 * (PR4), and automatic delegation (PR5) build on these contracts; the
 * policy regression tests in `packages/protocol/test/custom-agents.test.ts`
 * pin the semantics before any of that exists.
 *
 * Hard invariants (from the approved plan, sections 3-7):
 * - `scope: "selected"` with zero project links applies to NO project and
 *   must never widen to "all".
 * - Effective capabilities are an intersection; nothing in a definition
 *   can widen what the run mode, the child-runtime baseline, the parent,
 *   or live grants allow.
 * - `toolPolicy: "inherit"` and `allowlist: []` are distinct: an empty
 *   allowlist means no business tools, never a fallback to inherit.
 * - A snapshot frozen at dispatch-accept time is immutable; later edits
 *   never widen an accepted instance.
 * - Custom definitions cannot spawn further agents this term.
 */

import type { RunMode } from "./schema.js";

// ---------------------------------------------------------------------------
// Budgets (PR1 fixes these values; PR5 validates them by evaluation)
// ---------------------------------------------------------------------------

/** Maximum definitions injected into the per-turn automatic catalog. */
export const CUSTOM_AGENT_CATALOG_MAX_DEFINITIONS = 20;
/** Total character budget for the injected catalog text. */
export const CUSTOM_AGENT_CATALOG_TEXT_BUDGET = 4096;
/** Maximum length of a definition name (normalized form). */
export const CUSTOM_AGENT_NAME_MAX_LENGTH = 64;
/** Maximum length of a definition description. */
export const CUSTOM_AGENT_DESCRIPTION_MAX_LENGTH = 512;
/** Maximum length of the dedicated instructions body. */
export const CUSTOM_AGENT_INSTRUCTIONS_MAX_BYTES = 16 * 1024;
/** Maximum number of trigger phrases per definition. */
export const CUSTOM_AGENT_TRIGGERS_MAX = 16;
/** Maximum length of a single trigger phrase. */
export const CUSTOM_AGENT_TRIGGER_MAX_LENGTH = 64;
/** Maximum number of tool references in an allowlist. */
export const CUSTOM_AGENT_ALLOWLIST_MAX = 64;
/** Maximum explicit custom-agent references per single user message (一期一个). */
export const CUSTOM_AGENT_REFERENCES_PER_MESSAGE_MAX = 1;

// ---------------------------------------------------------------------------
// Definition contract
// ---------------------------------------------------------------------------

export type CustomAgentScope = "all" | "selected";

export type CustomAgentModelPolicy =
  | { kind: "inherit" }
  | { kind: "fixed"; providerId: string; modelId: string };

export type CustomAgentThinkingPolicy =
  | { kind: "inherit" }
  | { kind: "fixed"; level: string };

/**
 * Tool references are stable identifiers, never display labels:
 * builtin tools use their tool id; MCP tools use `serverId + toolName`.
 */
export type CustomAgentToolRef =
  | { kind: "builtin"; toolId: string }
  | { kind: "mcp"; serverId: string; toolName: string };

export type CustomAgentToolPolicy =
  | { kind: "inherit" }
  | { kind: "allowlist"; tools: CustomAgentToolRef[] };

export interface CustomAgentDefinition {
  /** Permanent identity; never reused after deletion. */
  id: string;
  /** Monotonic revision, incremented on every edit. */
  revision: number;
  /** Display/lookup name; unique after normalization. Not a join key. */
  name: string;
  description: string;
  /** Controlled color token; arbitrary styles are rejected upstream. */
  color: string;
  enabled: boolean;
  /** Dedicated user-authored instructions; sensitive, never exported to catalogs/logs/diagnostics. */
  instructions: string;
  scope: CustomAgentScope;
  modelPolicy: CustomAgentModelPolicy;
  thinkingPolicy: CustomAgentThinkingPolicy;
  toolPolicy: CustomAgentToolPolicy;
  allowAutomaticInvocation: boolean;
  triggers: string[];
  createdAt: number;
  updatedAt: number;
}

/** Routing metadata safe to inject into catalogs and audit events. */
export interface CustomAgentCatalogEntry {
  definitionId: string;
  revision: number;
  name: string;
  description: string;
  scope: CustomAgentScope;
  allowAutomaticInvocation: boolean;
  triggers: string[];
}

/** Immutable per-turn catalog snapshot. Instances reference it by id. */
export interface CustomAgentCatalogSnapshot {
  catalogId: string;
  turnId: string;
  projectId: string | null;
  entries: CustomAgentCatalogEntry[];
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Scope resolution (plan section 3-4)
// ---------------------------------------------------------------------------

/**
 * Whether a definition is effective for a project. `selected` with no
 * linked projects is effective for NOTHING — deleting the last link must
 * never widen scope to `all`. Tasks without a project may only use
 * `scope: "all"` definitions.
 */
export function isDefinitionEffectiveForProject(
  definition: Pick<CustomAgentDefinition, "enabled" | "scope">,
  linkedProjectIds: readonly string[],
  projectId: string | null,
): boolean {
  if (!definition.enabled) return false;
  if (definition.scope === "all") return true;
  if (projectId === null) return false;
  return linkedProjectIds.includes(projectId);
}

// ---------------------------------------------------------------------------
// Effective capabilities (plan section 4)
// ---------------------------------------------------------------------------

export type CapabilityClass =
  | "shell"
  | "filesystem-write"
  | "mcp"
  | "executable-extension"
  | "spawn-agent"
  | "business-read";

export interface CapabilityContext {
  runMode: RunMode;
  /** Capabilities the child-agent runtime baseline allows at all. */
  childBaseline: ReadonlySet<CapabilityClass>;
  /** Capabilities the parent agent may pass down. */
  parentDelegatable: ReadonlySet<CapabilityClass>;
  /** Connections/trust grants still valid at execution time. */
  liveGrants: ReadonlySet<CapabilityClass>;
}

/**
 * What the current run mode allows for a child agent. Plan and Review
 * never permit shell, MCP, or executable extensions, and writes are
 * denied before any executor or filesystem call runs.
 */
export function runModeCapabilities(mode: RunMode): Set<CapabilityClass> {
  if (mode === "execute") {
    return new Set<CapabilityClass>([
      "shell",
      "filesystem-write",
      "mcp",
      "executable-extension",
      "spawn-agent",
      "business-read",
    ]);
  }
  // plan / review
  return new Set<CapabilityClass>(["business-read"]);
}

function capabilityAllowedByToolPolicy(
  capability: CapabilityClass,
  policy: CustomAgentToolPolicy,
  resolveToolCapabilities: (ref: CustomAgentToolRef) => ReadonlySet<CapabilityClass>,
): boolean {
  if (policy.kind === "inherit") return true;
  // allowlist — including the empty list, which allows NOTHING.
  for (const ref of policy.tools) {
    if (resolveToolCapabilities(ref).has(capability)) return true;
  }
  return false;
}

/**
 * Effective capability intersection:
 *
 *   run mode ∩ child baseline ∩ parent-delegatable ∩ definition policy
 *   ∩ live grants
 *
 * Custom definitions never receive `spawn-agent` (no nested delegation
 * this term), regardless of any input set containing it. A revoked grant
 * can only ever shrink the result — nothing here widens capabilities.
 */
export function computeEffectiveCapabilities(
  context: CapabilityContext,
  toolPolicy: CustomAgentToolPolicy,
  resolveToolCapabilities: (ref: CustomAgentToolRef) => ReadonlySet<CapabilityClass>,
): Set<CapabilityClass> {
  const modeAllowed = runModeCapabilities(context.runMode);
  const result = new Set<CapabilityClass>();
  for (const capability of modeAllowed) {
    if (!context.childBaseline.has(capability)) continue;
    if (!context.parentDelegatable.has(capability)) continue;
    if (!context.liveGrants.has(capability)) continue;
    if (
      !capabilityAllowedByToolPolicy(
        capability,
        toolPolicy,
        resolveToolCapabilities,
      )
    ) {
      continue;
    }
    result.add(capability);
  }
  // Hard rule: custom definitions may not re-delegate this term.
  result.delete("spawn-agent");
  return result;
}

// ---------------------------------------------------------------------------
// Frozen snapshots (plan section 5)
// ---------------------------------------------------------------------------

export interface ResolvedCustomAgentModel {
  providerId: string;
  modelId: string;
  thinkingLevel: string | null;
}

/**
 * Immutable per-instance configuration, frozen when a dispatch is
 * accepted — before dependency waits and concurrency queues. Later
 * edits, renames, permission additions, or parent model switches never
 * widen an accepted instance; disable/delete/out-of-scope transitions
 * block new dispatches and cancel not-yet-started instances instead.
 */
export interface CustomAgentInstanceSnapshot {
  definitionId: string;
  definitionRevision: number;
  definitionName: string;
  instructions: string;
  catalogId: string;
  projectId: string | null;
  resolvedModel: ResolvedCustomAgentModel;
  effectiveCapabilities: readonly CapabilityClass[];
  /** P0-user | P0-model | P1-lexical | P2-semantic (never for explicit). */
  invocationSource: "user-explicit" | "model-explicit" | "model-automatic";
  selectionBasis: "explicit-reference" | "lexical-name" | "lexical-trigger" | "semantic";
  frozenAt: number;
}

export function freezeInstanceSnapshot(
  input: Omit<CustomAgentInstanceSnapshot, "effectiveCapabilities"> & {
    effectiveCapabilities: Iterable<CapabilityClass>;
  },
): CustomAgentInstanceSnapshot {
  const capabilities = Object.freeze([...input.effectiveCapabilities]);
  return Object.freeze({
    ...input,
    effectiveCapabilities: capabilities,
  });
}

// ---------------------------------------------------------------------------
// Structured references and invocation records (plan section 6)
// ---------------------------------------------------------------------------

/**
 * Structured `@` reference stored on the draft. Plain `@name` text alone
 * never grants an invocation.
 */
export interface CustomAgentReference {
  kind: "custom-agent";
  definitionId: string;
  revision: number;
  /** Display text only; never used for identity. */
  displayText: string;
}

/**
 * Durable dedup record. Unique key is `(threadId, invocationId)` —
 * turnId is NOT part of the key, so recovery generating a new turn
 * cannot accept the same invocation twice.
 */
export type CustomAgentInvocationStatus =
  | "pending"
  | "dispatch-committed"
  | "finished"
  | "cancelled"
  | "outcome-unknown";

export interface CustomAgentInvocationRecord {
  threadId: string;
  invocationId: string;
  /** Fingerprint of the bound request content. */
  requestFingerprint: string;
  definitionId: string;
  definitionRevision: number;
  turnId: string | null;
  instanceId: string | null;
  status: CustomAgentInvocationStatus;
  createdAt: number;
  updatedAt: number;
}

export type InvocationTransition =
  | { from: "pending"; to: "dispatch-committed" | "cancelled" | "outcome-unknown" }
  | { from: "dispatch-committed"; to: "finished" | "cancelled" | "outcome-unknown" }
  | { from: "outcome-unknown"; to: "finished" | "cancelled" };

const ALLOWED_INVOCATION_TRANSITIONS: ReadonlyMap<
  CustomAgentInvocationStatus,
  ReadonlySet<CustomAgentInvocationStatus>
> = new Map([
  [
    "pending",
    new Set<CustomAgentInvocationStatus>([
      "dispatch-committed",
      "cancelled",
      "outcome-unknown",
    ]),
  ],
  [
    "dispatch-committed",
    new Set<CustomAgentInvocationStatus>([
      "finished",
      "cancelled",
      "outcome-unknown",
    ]),
  ],
  [
    "outcome-unknown",
    new Set<CustomAgentInvocationStatus>(["finished", "cancelled"]),
  ],
  ["finished", new Set<CustomAgentInvocationStatus>()],
  ["cancelled", new Set<CustomAgentInvocationStatus>()],
]);

/**
 * Legal invocation status transitions. `outcome-unknown` never
 * transitions back into an executable state — after an ambiguous crash
 * the system must not silently re-dispatch; the user explicitly
 * re-executes with a NEW invocationId.
 */
export function canTransitionInvocation(
  from: CustomAgentInvocationStatus,
  to: CustomAgentInvocationStatus,
): boolean {
  return ALLOWED_INVOCATION_TRANSITIONS.get(from)?.has(to) ?? false;
}

// ---------------------------------------------------------------------------
// Error codes (plan sections 3, 6, 7)
// ---------------------------------------------------------------------------

export const CUSTOM_AGENT_ERROR_CODES = [
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
] as const;

export type CustomAgentErrorCode = (typeof CUSTOM_AGENT_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// P1 lexical matching (plan section 7)
// ---------------------------------------------------------------------------

/**
 * Fixed normalization for name/trigger matching: Unicode NFC, case
 * folding, whitespace collapse. Latin matching requires word boundaries
 * (so `PR` never substring-hits `approve`); CJK phrases match as
 * substrings (CJK has no word-boundary concept). User-supplied regular
 * expressions are not supported.
 */
export function normalizeAgentToken(text: string): string {
  return text.normalize("NFC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

const LATIN_CHAR = /[a-z0-9_]/;

export function hasLatinWordBoundaryHit(text: string, needle: string): boolean {
  if (needle.length === 0) return false;
  let index = text.indexOf(needle);
  while (index !== -1) {
    const before: string | undefined =
      index > 0 ? text[index - 1] : undefined;
    const after: string | undefined =
      index + needle.length < text.length
        ? text[index + needle.length]
        : undefined;
    const beforeOk = before === undefined || !LATIN_CHAR.test(before);
    const afterOk = after === undefined || !LATIN_CHAR.test(after);
    if (beforeOk && afterOk) return true;
    index = text.indexOf(needle, index + 1);
  }
  return false;
}

function tokenMatches(text: string, needleRaw: string): boolean {
  const needle = normalizeAgentToken(needleRaw);
  if (needle.length === 0) return false;
  const first: string | undefined = needle[0];
  if (first !== undefined && LATIN_CHAR.test(first)) {
    return hasLatinWordBoundaryHit(text, needle);
  }
  return text.includes(needle);
}

export interface LexicalMatchResult {
  /** role exactly names one unique effective definition. */
  exactNameMatch: CustomAgentCatalogEntry | null;
  /** task text hits names/triggers: advisory candidates only. */
  triggerCandidates: CustomAgentCatalogEntry[];
  ambiguous: boolean;
}

/**
 * P1 deterministic lexical pass over the per-turn catalog.
 *
 * - Exact role-name match is computed against definition names only.
 * - Trigger hits against task text are CANDIDATES, never forced
 *   reassignments: lexical certainty about text is not semantic
 *   certainty about task fit.
 * - Multiple distinct hits yield an ambiguous result; the caller must
 *   surface candidates instead of picking one by recency or order.
 */
export function matchCatalogLexically(
  catalog: readonly CustomAgentCatalogEntry[],
  role: string | null,
  taskText: string,
): LexicalMatchResult {
  const normalizedRole = role === null ? null : normalizeAgentToken(role);
  let exactNameMatch: CustomAgentCatalogEntry | null = null;
  let exactCount = 0;
  if (normalizedRole !== null) {
    for (const entry of catalog) {
      if (normalizeAgentToken(entry.name) === normalizedRole) {
        exactNameMatch = entry;
        exactCount += 1;
      }
    }
    if (exactCount > 1) {
      // Should not happen (names are unique after normalization), but
      // never silently pick one.
      return { exactNameMatch: null, triggerCandidates: [], ambiguous: true };
    }
  }

  const normalizedTask = normalizeAgentToken(taskText);
  const seen = new Set<string>();
  const triggerCandidates: CustomAgentCatalogEntry[] = [];
  if (exactNameMatch === null) {
    for (const entry of catalog) {
      if (seen.has(entry.definitionId)) continue;
      const hit =
        tokenMatches(normalizedTask, entry.name) ||
        entry.triggers.some((trigger) => tokenMatches(normalizedTask, trigger));
      if (hit) {
        seen.add(entry.definitionId);
        triggerCandidates.push(entry);
      }
    }
  }

  return {
    exactNameMatch,
    triggerCandidates,
    ambiguous: triggerCandidates.length > 1,
  };
}

// ---------------------------------------------------------------------------
// Catalog construction (plan section 7)
// ---------------------------------------------------------------------------

/**
 * Per-turn catalog ordering: project-selected definitions first, then
 * stable name/id ordering. Recency-based ordering is deliberately NOT
 * used, to avoid routing drift. The caller must refuse to silently
 * truncate when budgets are exceeded — these helpers surface overflow.
 */
export function orderCatalogEntries(
  entries: readonly CustomAgentCatalogEntry[],
  projectId: string | null,
  selectedProjectIdsByDefinition: ReadonlyMap<string, readonly string[]>,
): CustomAgentCatalogEntry[] {
  const isProjectSpecific = (entry: CustomAgentCatalogEntry): boolean =>
    projectId !== null &&
    entry.scope === "selected" &&
    (selectedProjectIdsByDefinition.get(entry.definitionId) ?? []).includes(
      projectId,
    );
  return [...entries].sort((a, b) => {
    const aSpecific = isProjectSpecific(a) ? 0 : 1;
    const bSpecific = isProjectSpecific(b) ? 0 : 1;
    if (aSpecific !== bSpecific) return aSpecific - bSpecific;
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.definitionId.localeCompare(b.definitionId);
  });
}

export interface CatalogBudgetResult {
  withinBudget: boolean;
  definitionCount: number;
  textLength: number;
}

export function checkCatalogBudget(
  entries: readonly CustomAgentCatalogEntry[],
): CatalogBudgetResult {
  const textLength = entries.reduce(
    (total, entry) => total + entry.name.length + entry.description.length + 8,
    0,
  );
  return {
    withinBudget:
      entries.length <= CUSTOM_AGENT_CATALOG_MAX_DEFINITIONS &&
      textLength <= CUSTOM_AGENT_CATALOG_TEXT_BUDGET,
    definitionCount: entries.length,
    textLength,
  };
}
