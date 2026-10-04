import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { isExecutionMode, type ApprovalPolicy } from "@artemis/protocol";
import {
  effectiveApprovalRisk,
  modelMayAutoApprove,
  shouldAutoApprove,
} from "../../../src/main/security/approval-mode.js";
import { sandboxEscalationError } from "../../../src/main/security/sandbox-escalation.js";

const main = readFileSync(
  new URL("../../../src/main/main.ts", import.meta.url),
  "utf8",
);
function source(start: string, end: string) {
  return main.slice(
    main.indexOf(start),
    main.indexOf(end, main.indexOf(start)),
  );
}
const compiled = transformSync(
  [
    source(
      "async function handleMcpBrokerRequest(",
      "function rejectBrokerRequest(",
    ),
    source(
      "function currentSandboxEscalationError(",
      "function currentComputerTaskApproval(",
    ),
    source(
      "async function executeApprovedMcp(",
      "async function executeApprovedRemote(",
    ),
  ].join("\n"),
  { loader: "ts" },
).code;

function fixture(
  kind: "mcp.call" | "extension.call",
  mode: "work" | "codemode" = "work",
  policy: ApprovalPolicy = "agent",
) {
  const thread = { id: "task", mode: mode as string, archived: false };
  const config = {
    id: "local",
    enabled: true,
    transport: "stdio",
    fullAccess: false,
    allowNetwork: false,
  };
  const scope = {
    isExecutionMode,
    sandboxEscalationError,
    effectiveApprovalRisk,
    modelMayAutoApprove,
    shouldAutoApprove,
    randomUUID,
    canRunLicensed: () => true,
    store: {
      getThread: () => thread,
      findApprovalGrant: vi.fn(() => "project"),
    },
    activeTurns: new Map([["task", "turn"]]),
    cancellingTurns: new Set<string>(),
    activeMcpCalls: new Map(),
    imService: undefined as
      | undefined
      | { hasBinding(): boolean; authorizeThread(): void; profile(): unknown },
    connectorService: undefined,
    computerUseServerId: "computer-use",
    agentProcess: { post: vi.fn() },
    mcpConfigStore: { list: async () => [config] },
    mcpClientManager: {
      tools: () => [
        {
          serverId: "local",
          toolName: "read",
          transport: "stdio",
          readOnly: true,
          destructive: false,
        },
      ],
      call: vi.fn(async () => ({ content: [{ type: "text", text: "done" }] })),
    },
    trustedExtensionManager: {
      status: () => [
        {
          state: "ready",
          config: { id: "local", allowNetwork: false },
          tools: [{ toolName: "read", extensionName: "Local" }],
        },
      ],
      call: vi.fn(async () => ({ output: "done", isError: false })),
    },
    settingsStore: {
      approvalPolicy: async () => policy,
      localFullAccess: vi.fn(async () => false),
    },
    getPlatformContract: () => ({ sandbox: { available: true } }),
    resolveThreadWorkspace: async () => ({ workspacePath: "/workspace" }),
    conversationWorkspaceMatches: (a: string, b: string) => a === b,
    createApprovalFingerprint: () => "fingerprint",
    approvalProjectId: () => "project",
    createAutomationApproval: vi.fn(() => ({
      approvalId: "approval",
      nonce: "automation",
      approved: true,
      scope: "once",
      source: "automation",
    })),
    currentComputerTaskApproval: vi.fn(async () => "task-grant"),
    hookPermission: vi.fn(async () => "allow"),
    conversationApprovalScopes: (_thread: unknown, scopes: string[]) => scopes,
    pendingApprovals: { register: vi.fn() },
    emitPayload: vi.fn(),
    rejectBrokerRequest: vi.fn(),
  };
  const build = () =>
    new Function(
      ...Object.keys(scope),
      `${compiled}\nreturn {handleMcpBrokerRequest, handleExtensionBrokerRequest, executeApprovedMcp, executeApprovedExtension};`,
    )(...Object.values(scope));
  const request = {
    kind,
    approvalId: "approval",
    threadId: "task",
    turnId: "turn",
    mode,
    workspacePath: "/workspace",
    serverId: "local",
    serverName: "Local",
    transport: "stdio",
    extensionId: "local",
    extensionName: "Local",
    toolName: "read",
    arguments: { path: "/requested/file" },
    readOnly: true,
    destructive: false,
    modelApproval: {
      risk: "low",
      explicitUserRequest: true,
      reason: "The user explicitly requested this file.",
    },
    sandboxEscalation: {
      justification:
        "The sandbox denied this read; the read-only retry has no duplicate effects.",
    },
  };
  const handle = () =>
    build()[
      kind === "mcp.call"
        ? "handleMcpBrokerRequest"
        : "handleExtensionBrokerRequest"
    ]("worker", request);
  const execute = (approvalScope = "once") =>
    build()[
      kind === "mcp.call" ? "executeApprovedMcp" : "executeApprovedExtension"
    ]("worker", request, {
      approvalId: "approval",
      nonce: "nonce",
      approved: true,
      scope: approvalScope,
      source: "user",
    });
  const tool =
    kind === "mcp.call"
      ? scope.mcpClientManager.call
      : scope.trustedExtensionManager.call;
  return { scope, request, thread, config, handle, execute, tool };
}

describe.each(["mcp.call", "extension.call"] as const)(
  "%s escalation broker",
  (kind) => {
    it.each(["work", "codemode"] as const)(
      "runs a model-approved %s request once and records its reason",
      async (mode) => {
        const f = fixture(kind, mode);
        await f.handle();
        expect(f.tool).toHaveBeenCalledOnce();
        expect(f.tool.mock.calls[0]?.at(-1)).toBe(true);
        expect(f.scope.createAutomationApproval).not.toHaveBeenCalled();
        expect(f.scope.store.findApprovalGrant).not.toHaveBeenCalled();
        expect(f.scope.currentComputerTaskApproval).not.toHaveBeenCalled();
        expect(f.scope.pendingApprovals.register).not.toHaveBeenCalled();
        expect(f.scope.emitPayload).toHaveBeenCalledWith(
          "task",
          "turn",
          expect.objectContaining({
            type: "approval.requested",
            risk: "high",
            allowedScopes: ["once"],
            source: "model",
            summary: expect.stringContaining(
              f.request.sandboxEscalation.justification,
            ),
          }),
        );
        expect(f.config.fullAccess).toBe(false);
        delete (f.request as { sandboxEscalation?: unknown }).sandboxEscalation;
        await f.handle();
        expect(f.tool).toHaveBeenCalledTimes(2);
        const next = f.tool.mock.calls[1] as unknown[];
        expect(kind === "mcp.call" ? next[7] : next[5]).not.toBe(true);
      },
    );

    it.each(["agent", "ask", "custom"] as const)(
      "does not substitute saved, automation, hook or task grants for %s approval",
      async (policy) => {
        const f = fixture(kind, "work", policy);
        f.request.modelApproval.explicitUserRequest = false;
        await f.handle();
        expect(f.tool).not.toHaveBeenCalled();
        expect(f.scope.createAutomationApproval).not.toHaveBeenCalled();
        expect(f.scope.store.findApprovalGrant).not.toHaveBeenCalled();
        expect(f.scope.pendingApprovals.register).toHaveBeenCalledWith(
          expect.objectContaining({ allowedScopes: ["once"] }),
        );
        expect(f.scope.emitPayload).toHaveBeenCalledWith(
          "task",
          "turn",
          expect.objectContaining({
            type: "approval.requested",
            risk: "high",
            network: ["Local"],
          }),
        );
      },
    );

    it.each(["stale", "cancelled", "plan", "archived", "no-reason"])(
      "rejects %s escalation before approval or execution",
      async (state) => {
        const f = fixture(kind);
        if (state === "stale") f.scope.activeTurns.set("task", "new-turn");
        if (state === "cancelled") f.scope.cancellingTurns.add("task");
        if (state === "plan") f.thread.mode = "plan";
        if (state === "archived") f.thread.archived = true;
        if (state === "no-reason")
          f.request.sandboxEscalation.justification = " ";
        await f.handle();
        expect(f.tool).not.toHaveBeenCalled();
        expect(f.scope.rejectBrokerRequest).toHaveBeenCalledOnce();
        await f.execute();
        expect(f.tool).not.toHaveBeenCalled();
        expect(f.scope.rejectBrokerRequest).toHaveBeenCalledTimes(2);
      },
    );

    it("rejects a delayed approval after the mode changes", async () => {
      const f = fixture(kind, "work", "ask");
      await f.handle();
      expect(f.scope.pendingApprovals.register).toHaveBeenCalledOnce();
      f.thread.mode = "plan";
      await f.execute();
      expect(f.tool).not.toHaveBeenCalled();
      expect(f.scope.rejectBrokerRequest).toHaveBeenCalledOnce();
    });

    it("refuses a reusable approval scope", async () => {
      const f = fixture(kind);
      await f.execute("project");
      expect(f.tool).not.toHaveBeenCalled();
      expect(f.scope.rejectBrokerRequest).toHaveBeenCalledWith(
        "worker",
        f.request,
        expect.stringContaining("one-time"),
      );
    });

    it("cannot expand a remote permission profile", async () => {
      const f = fixture(kind);
      f.scope.imService = {
        hasBinding: () => true,
        authorizeThread() {},
        profile: () => ({}),
      };
      await f.handle();
      expect(f.tool).not.toHaveBeenCalled();
      expect(f.scope.rejectBrokerRequest).toHaveBeenCalledWith(
        "worker",
        f.request,
        expect.stringContaining("remote permission profile"),
      );
    });
  },
);
