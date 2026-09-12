/**
 * Custom sub-agent definition validation and invocation fingerprints
 * (D#152 PR4). Pure functions so the policy is unit-testable without the
 * Electron main process; IPC handlers call these before touching the
 * store, and the store CRUD stays transactional underneath.
 *
 * Limits come from the protocol contract (PR1) so renderer, main, and
 * worker enforce identical budgets.
 */

import { createHash } from "node:crypto";

import {
  CUSTOM_AGENT_ALLOWLIST_MAX,
  CUSTOM_AGENT_CATALOG_MAX_DEFINITIONS,
  CUSTOM_AGENT_DESCRIPTION_MAX_LENGTH,
  CUSTOM_AGENT_INSTRUCTIONS_MAX_BYTES,
  CUSTOM_AGENT_NAME_MAX_LENGTH,
  CUSTOM_AGENT_TRIGGER_MAX_LENGTH,
  CUSTOM_AGENT_TRIGGERS_MAX,
  normalizeAgentToken,
  type CustomAgentModelPolicy,
  type CustomAgentThinkingPolicy,
  type CustomAgentToolPolicy,
  type CustomAgentToolRef,
} from "@artemis/protocol";

/** Controlled color tokens; arbitrary styles are rejected (plan section 3). */
export const CUSTOM_AGENT_COLOR_TOKENS = [
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;

export interface CustomAgentDefinitionInput {
  name: string;
  description: string;
  color: string;
  enabled: boolean;
  instructions: string;
  scope: "all" | "selected";
  projectIds: string[];
  modelPolicy: CustomAgentModelPolicy;
  thinkingPolicy: CustomAgentThinkingPolicy;
  toolPolicy: CustomAgentToolPolicy;
  allowAutomaticInvocation: boolean;
  triggers: string[];
}

function fail(message: string): never {
  throw new Error(`CUSTOM_AGENT_INVALID: ${message}`);
}

function validateModelPolicy(policy: unknown): CustomAgentModelPolicy {
  if (typeof policy !== "object" || policy === null) {
    fail("model policy must be an object");
  }
  const candidate = policy as { kind?: unknown };
  if (candidate.kind === "inherit") return { kind: "inherit" };
  if (candidate.kind === "fixed") {
    const fixed = policy as { providerId?: unknown; modelId?: unknown };
    if (
      typeof fixed.providerId !== "string" ||
      fixed.providerId.trim().length === 0 ||
      typeof fixed.modelId !== "string" ||
      fixed.modelId.trim().length === 0
    ) {
      fail("fixed model policy requires providerId and modelId");
    }
    return {
      kind: "fixed",
      providerId: fixed.providerId.trim(),
      modelId: fixed.modelId.trim(),
    };
  }
  fail("model policy kind must be inherit or fixed");
}

function validateThinkingPolicy(policy: unknown): CustomAgentThinkingPolicy {
  if (typeof policy !== "object" || policy === null) {
    fail("thinking policy must be an object");
  }
  const candidate = policy as { kind?: unknown };
  if (candidate.kind === "inherit") return { kind: "inherit" };
  if (candidate.kind === "fixed") {
    const fixed = policy as { level?: unknown };
    if (typeof fixed.level !== "string" || fixed.level.trim().length === 0) {
      fail("fixed thinking policy requires a level");
    }
    return { kind: "fixed", level: fixed.level.trim() };
  }
  fail("thinking policy kind must be inherit or fixed");
}

function validateToolRef(ref: unknown): CustomAgentToolRef {
  if (typeof ref !== "object" || ref === null) {
    fail("tool reference must be an object");
  }
  const candidate = ref as {
    kind?: unknown;
    toolId?: unknown;
    serverId?: unknown;
    toolName?: unknown;
  };
  if (candidate.kind === "builtin") {
    if (
      typeof candidate.toolId !== "string" ||
      candidate.toolId.trim().length === 0
    ) {
      fail("builtin tool reference requires a stable toolId");
    }
    return { kind: "builtin", toolId: candidate.toolId.trim() };
  }
  if (candidate.kind === "mcp") {
    if (
      typeof candidate.serverId !== "string" ||
      candidate.serverId.trim().length === 0 ||
      typeof candidate.toolName !== "string" ||
      candidate.toolName.trim().length === 0
    ) {
      fail("MCP tool reference requires serverId and toolName");
    }
    // Stable identifiers only — never display labels (plan section 4).
    return {
      kind: "mcp",
      serverId: candidate.serverId.trim(),
      toolName: candidate.toolName.trim(),
    };
  }
  fail("tool reference kind must be builtin or mcp");
}

export function validateCustomAgentToolPolicy(
  policy: unknown,
): CustomAgentToolPolicy {
  if (typeof policy !== "object" || policy === null) {
    fail("tool policy must be an object");
  }
  const candidate = policy as { kind?: unknown; tools?: unknown };
  if (candidate.kind === "inherit") return { kind: "inherit" };
  if (candidate.kind === "allowlist") {
    if (!Array.isArray(candidate.tools)) {
      fail("allowlist tool policy requires a tools array");
    }
    if (candidate.tools.length > CUSTOM_AGENT_ALLOWLIST_MAX) {
      fail(`allowlist holds at most ${CUSTOM_AGENT_ALLOWLIST_MAX} tools`);
    }
    // NOTE: inherit and allowlist:[] are strictly different — an empty
    // list means no business tools, never a fallback to inherit.
    return {
      kind: "allowlist",
      tools: candidate.tools.map((ref) => validateToolRef(ref)),
    };
  }
  fail("tool policy kind must be inherit or allowlist");
}

/**
 * Validate and normalize a create/update payload from the renderer.
 * `projectExists` resolves project identity (stable projectId, never a
 * workspace path); every linked project must exist.
 */
export function validateCustomAgentInput(
  raw: unknown,
  projectExists: (projectId: string) => boolean,
): CustomAgentDefinitionInput {
  if (typeof raw !== "object" || raw === null) {
    fail("definition must be an object");
  }
  const input = raw as Record<string, unknown>;

  if (typeof input.name !== "string") fail("name is required");
  const name = input.name.trim().replace(/\s+/g, " ");
  const normalizedName = normalizeAgentToken(name);
  if (normalizedName.length === 0) fail("name is required");
  if (normalizedName.length > CUSTOM_AGENT_NAME_MAX_LENGTH) {
    fail(`name exceeds ${CUSTOM_AGENT_NAME_MAX_LENGTH} characters`);
  }

  if (typeof input.description !== "string") fail("description is required");
  const description = input.description.trim();
  if (description.length > CUSTOM_AGENT_DESCRIPTION_MAX_LENGTH) {
    fail(
      `description exceeds ${CUSTOM_AGENT_DESCRIPTION_MAX_LENGTH} characters`,
    );
  }

  if (typeof input.instructions !== "string") fail("instructions are required");
  const instructions = input.instructions;
  if (instructions.trim().length === 0) fail("instructions are required");
  if (
    Buffer.byteLength(instructions, "utf8") >
    CUSTOM_AGENT_INSTRUCTIONS_MAX_BYTES
  ) {
    fail(`instructions exceed ${CUSTOM_AGENT_INSTRUCTIONS_MAX_BYTES} bytes`);
  }

  if (typeof input.color !== "string") fail("color is required");
  const color = input.color.trim();
  if (!(CUSTOM_AGENT_COLOR_TOKENS as readonly string[]).includes(color)) {
    fail(`color must be one of: ${CUSTOM_AGENT_COLOR_TOKENS.join(", ")}`);
  }

  if (input.scope !== "all" && input.scope !== "selected") {
    fail("scope must be all or selected");
  }
  const scope = input.scope;

  if (!Array.isArray(input.projectIds)) fail("projectIds must be an array");
  const projectIds = [...new Set(input.projectIds)];
  for (const projectId of projectIds) {
    if (typeof projectId !== "string" || projectId.length === 0) {
      fail("projectIds must be non-empty strings");
    }
    if (!projectExists(projectId)) {
      fail(`project does not exist: ${projectId}`);
    }
  }
  if (scope === "selected" && projectIds.length === 0) {
    // Zero links means NO applicable projects, never a silent widening to
    // all; require the user to either pick projects or choose scope=all.
    fail("selected scope requires at least one project (or choose scope=all)");
  }

  if (!Array.isArray(input.triggers)) fail("triggers must be an array");
  if (input.triggers.length > CUSTOM_AGENT_TRIGGERS_MAX) {
    fail(`at most ${CUSTOM_AGENT_TRIGGERS_MAX} trigger phrases`);
  }
  const triggers = input.triggers.map((trigger) => {
    if (typeof trigger !== "string") fail("triggers must be strings");
    const normalized = trigger.trim().replace(/\s+/g, " ");
    if (normalized.length === 0) fail("trigger phrases cannot be empty");
    if (normalized.length > CUSTOM_AGENT_TRIGGER_MAX_LENGTH) {
      fail(
        `trigger phrases hold at most ${CUSTOM_AGENT_TRIGGER_MAX_LENGTH} characters`,
      );
    }
    return normalized;
  });

  if (typeof input.allowAutomaticInvocation !== "boolean") {
    fail("allowAutomaticInvocation must be a boolean");
  }
  if (typeof input.enabled !== "boolean") {
    fail("enabled must be a boolean");
  }

  return {
    name,
    description,
    color,
    enabled: input.enabled,
    instructions,
    scope,
    projectIds: projectIds as string[],
    modelPolicy: validateModelPolicy(input.modelPolicy),
    thinkingPolicy: validateThinkingPolicy(input.thinkingPolicy),
    toolPolicy: validateCustomAgentToolPolicy(input.toolPolicy),
    allowAutomaticInvocation: input.allowAutomaticInvocation,
    triggers,
  };
}

/**
 * Stable fingerprint of the bound request content (D#152 plan section 6).
 * The same invocationId with a different fingerprint is an
 * INVOCATION_CONFLICT; a fresh user submission mints a new invocationId.
 */
export function customAgentRequestFingerprint(parts: {
  threadId: string;
  text: string;
  attachmentIds?: readonly string[];
  definitionId: string;
  revision: number;
}): string {
  const hash = createHash("sha256");
  hash.update(parts.threadId);
  hash.update("\0");
  hash.update(parts.text);
  hash.update("\0");
  for (const attachmentId of [...(parts.attachmentIds ?? [])].sort()) {
    hash.update(attachmentId);
    hash.update("\0");
  }
  hash.update(parts.definitionId);
  hash.update("\0");
  hash.update(String(parts.revision));
  return hash.digest("hex");
}

/** Reference shape accepted from the renderer on start/follow-up sends. */
export interface CustomAgentSendReference {
  definitionId: string;
  revision: number;
  invocationId: string;
}

/**
 * Validate the structured reference carried by a send. The renderer must
 * mint a fresh invocationId per user submission (IPC retries reuse it).
 */
export function validateCustomAgentSendReference(
  raw: unknown,
): CustomAgentSendReference {
  if (typeof raw !== "object" || raw === null) {
    fail("custom agent reference must be an object");
  }
  const candidate = raw as Record<string, unknown>;
  for (const field of ["definitionId", "invocationId"] as const) {
    if (
      typeof candidate[field] !== "string" ||
      (candidate[field] as string).trim().length === 0
    ) {
      fail(`custom agent reference requires ${field}`);
    }
  }
  if (
    typeof candidate.revision !== "number" ||
    !Number.isInteger(candidate.revision) ||
    candidate.revision < 1
  ) {
    fail("custom agent reference requires a positive integer revision");
  }
  return {
    definitionId: (candidate.definitionId as string).trim(),
    revision: candidate.revision,
    invocationId: (candidate.invocationId as string).trim(),
  };
}

export { CUSTOM_AGENT_CATALOG_MAX_DEFINITIONS };
