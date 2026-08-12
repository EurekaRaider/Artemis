import { describe, expect, it } from "vitest";

import {
  APP_LOCALES,
  agentPayloadSchema,
  appLanguageSchema,
  appThemeSchema,
  approvalResolutionSchema,
  contextWindowSchema,
  OFFICE_DOCUMENT_PROTOCOL_VERSION,
  officeDocumentCapabilitiesSchema,
  officeDocumentRequestSchema,
  promptAttachmentsSchema,
  providerConnectionSchema,
  reviewMutationInputSchema,
  reviewQuerySchema,
  runModeSchema,
  threadCommandSchema,
  userInputResolutionSchema,
  worktreeCommandSchema,
} from "../src/index.js";

describe("turn activity schema", () => {
  it("retains only non-content progress metadata", () => {
    expect(
      agentPayloadSchema.parse({
        type: "turn.activity",
        phase: "thinking",
        reasoning: "private model reasoning",
      }),
    ).toEqual({ type: "turn.activity", phase: "thinking" });
  });
});

describe("queued message recovery schema", () => {
  it("preserves messages that were not executed before a turn stopped", () => {
    expect(
      agentPayloadSchema.parse({
        type: "queue.recovered",
        messages: ["Discuss the unrelated follow-up instead"],
      }),
    ).toEqual({
      type: "queue.recovered",
      messages: ["Discuss the unrelated follow-up instead"],
    });
    expect(
      agentPayloadSchema.safeParse({
        type: "queue.recovered",
        messages: [],
      }).success,
    ).toBe(false);
  });
});

describe("approval schemas", () => {
  it("requires the host nonce on requests and resolutions", () => {
    expect(
      agentPayloadSchema.safeParse({
        type: "approval.requested",
        approvalId: "approval-1",
        summary: "Write README.md",
        paths: ["README.md"],
        network: [],
        risk: "medium",
        allowedScopes: ["once"],
      }).success,
    ).toBe(false);

    expect(
      approvalResolutionSchema.safeParse({
        approvalId: "approval-1",
        approved: true,
        scope: "once",
      }).success,
    ).toBe(false);
  });

  it("rejects malformed renderer thread commands", () => {
    expect(
      threadCommandSchema.safeParse({
        type: "thread.rename",
        threadId: "thread-1",
        title: "   ",
      }).success,
    ).toBe(false);
    expect(
      threadCommandSchema.safeParse({
        type: "turn.steer",
        threadId: "thread-1",
        text: "",
      }).success,
    ).toBe(false);
    expect(
      threadCommandSchema.safeParse({
        type: "turn.follow-up",
        threadId: "thread-1",
        text: "Inspect this",
        attachments: [
          {
            name: "unsafe.svg",
            mimeType: "image/svg+xml",
            data: "<svg onload=alert(1)>",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      threadCommandSchema.safeParse({
        type: "turn.steer",
        threadId: "thread-1",
        text: "Inspect this",
        attachments: [
          {
            name: "screen.png",
            mimeType: "image/png",
            data: "aGVsbG8=",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      threadCommandSchema.safeParse({
        type: "thread.goal",
        threadId: "thread-1",
        goal: "Ship a verified release",
      }).success,
    ).toBe(true);
    expect(
      threadCommandSchema.safeParse({
        type: "thread.goal",
        threadId: "thread-1",
        goal: "   ",
      }).success,
    ).toBe(false);
    expect(
      threadCommandSchema.safeParse({
        type: "thread.goal",
        threadId: "thread-1",
        goal: null,
      }).success,
    ).toBe(true);
    expect(
      threadCommandSchema.safeParse({
        type: "thread.compact",
        threadId: "thread-1",
        instructions: "Preserve the current implementation state",
      }).success,
    ).toBe(true);
    expect(
      threadCommandSchema.safeParse({
        type: "thread.compact",
        threadId: "thread-1",
        instructions: "   ",
      }).success,
    ).toBe(false);
    expect(
      threadCommandSchema.safeParse({
        type: "thread.delete",
        threadId: "thread-1",
      }).success,
    ).toBe(true);
    expect(
      threadCommandSchema.safeParse({
        type: "thread.delete",
        threadId: "",
      }).success,
    ).toBe(false);
  });
});

describe("user-input schemas", () => {
  const request = {
    type: "user-input.requested",
    requestId: "input-1",
    nonce: "1234567890abcdef",
    header: "Scope",
    question: "Which target should be optimized first?",
    options: [
      {
        label: "Whole sweep",
        description: "Optimize end-to-end runtime.",
        recommended: true,
      },
      {
        label: "Single point",
        description: "Optimize latency for one point.",
        recommended: false,
      },
    ],
    expiresAt: "2026-08-02T10:15:00.000Z",
  };

  it("requires exactly one model recommendation", () => {
    expect(agentPayloadSchema.safeParse(request).success).toBe(true);
    expect(
      agentPayloadSchema.safeParse({
        ...request,
        options: request.options.map((option) => ({
          ...option,
          recommended: false,
        })),
      }).success,
    ).toBe(false);
  });

  it("accepts one offered selection or one custom answer", () => {
    expect(
      userInputResolutionSchema.safeParse({
        requestId: "input-1",
        nonce: "1234567890abcdef",
        selectedOption: 0,
      }).success,
    ).toBe(true);
    expect(
      userInputResolutionSchema.safeParse({
        requestId: "input-1",
        nonce: "1234567890abcdef",
        selectedOption: 0,
        customAnswer: "A different target",
      }).success,
    ).toBe(false);
  });
});

describe("prompt attachment schemas", () => {
  it("accepts image and text-file attachments in one versioned prompt payload", () => {
    expect(
      promptAttachmentsSchema.safeParse([
        {
          name: "screen.png",
          mimeType: "image/png",
          data: "aGVsbG8=",
        },
        {
          type: "file",
          name: "notes.md",
          mimeType: "text/markdown",
          content: "# Reproduction\nDrop this file into the composer.",
        },
      ]).success,
    ).toBe(true);
  });

  it("keeps image and total attachment limits at the protocol boundary", () => {
    const image = {
      name: "screen.png",
      mimeType: "image/png" as const,
      data: "aGVsbG8=",
    };
    expect(
      promptAttachmentsSchema.safeParse(Array.from({ length: 5 }, () => image))
        .success,
    ).toBe(false);

    const file = {
      type: "file" as const,
      name: "notes.txt",
      mimeType: "text/plain",
      content: "hello",
    };
    expect(
      promptAttachmentsSchema.safeParse(Array.from({ length: 11 }, () => file))
        .success,
    ).toBe(false);
  });
});

describe("child-agent schemas", () => {
  it("validates privacy-safe MCP usage and task source metadata", () => {
    expect(
      agentPayloadSchema.safeParse({
        type: "mcp.tool.used",
        toolCallId: "call-1",
        serverId: "codegraph",
        serverName: "CodeGraph",
        toolName: "explore",
        agentId: "parent",
      }).success,
    ).toBe(true);
    expect(
      agentPayloadSchema.safeParse({
        type: "task.source.added",
        sourceId: "source-1",
        name: "screenshot.png",
        mimeType: "image/png",
        kind: "image",
        data: "must-not-be-persisted",
      }).success,
    ).toBe(true);
    const parsed = agentPayloadSchema.parse({
      type: "task.source.added",
      sourceId: "source-1",
      name: "screenshot.png",
      mimeType: "image/png",
      kind: "image",
      data: "must-not-be-persisted",
    });
    expect("data" in parsed).toBe(false);
  });

  it("carries the task and bounded live activity while remaining backward compatible", () => {
    const runningChild = {
      type: "child-agent.status",
      agentId: "child-1",
      label: "Review audio stages",
      status: "running",
    };

    expect(agentPayloadSchema.safeParse(runningChild).success).toBe(true);
    expect(
      agentPayloadSchema.safeParse({
        ...runningChild,
        task: "Audit the audio processing stages.",
        activityDelta: "Reading bark_filterbank.cpp",
      }).success,
    ).toBe(true);
    expect(
      agentPayloadSchema.safeParse({
        ...runningChild,
        activity: "x".repeat(64 * 1024 + 1),
      }).success,
    ).toBe(false);
    expect(
      agentPayloadSchema.safeParse({
        ...runningChild,
        activityDelta: "x".repeat(8 * 1024 + 1),
      }).success,
    ).toBe(false);
  });

  it("validates team state, collaboration messages, and optional member metadata", () => {
    expect(
      agentPayloadSchema.safeParse({
        type: "child-agent.status",
        agentId: "child-1",
        label: "Review runtime",
        teamId: "team-1",
        parentAgentId: "parent",
        depth: 1,
        subtreeStatus: "running",
        directChildCount: 2,
        role: "Runtime reviewer",
        dependsOnAgentIds: [],
        writePaths: ["packages/agent-host"],
        required: true,
        coordinationStatus: "working",
        status: "running",
      }).success,
    ).toBe(true);
    expect(
      agentPayloadSchema.safeParse({
        type: "agent-team.status",
        teamId: "team-1",
        mission: "Implement collaborative sub-agents.",
        status: "running",
        memberAgentIds: ["child-1", "child-2"],
        requiredAgentIds: ["child-1"],
        maxMembers: 64,
        maxDepth: 5,
        spawnBudgetRemaining: 126,
        updatedAt: "2026-08-06T00:00:00.000Z",
      }).success,
    ).toBe(true);
    const members = Array.from({ length: 64 }, (_, index) => `child-${index}`);
    expect(
      agentPayloadSchema.safeParse({
        type: "agent-team.status",
        teamId: "team-64",
        mission: "Exercise the logical tree ceiling.",
        status: "running",
        memberAgentIds: members,
        requiredAgentIds: members,
        maxMembers: 64,
        maxDepth: 5,
        spawnBudgetRemaining: 64,
        updatedAt: "2026-08-09T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      agentPayloadSchema.safeParse({
        type: "agent-team.status",
        teamId: "team-65",
        mission: "Exceed the logical tree ceiling.",
        status: "running",
        memberAgentIds: [...members, "child-64"],
        requiredAgentIds: [],
        maxMembers: 64,
        updatedAt: "2026-08-09T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      agentPayloadSchema.safeParse({
        type: "child-agent.status",
        agentId: "child-depth-6",
        label: "Too deep",
        parentAgentId: "child-depth-5",
        depth: 6,
        status: "queued",
      }).success,
    ).toBe(false);
    expect(
      agentPayloadSchema.safeParse({
        type: "agent-team.message",
        teamId: "team-1",
        messageId: "message-1",
        sequence: 1,
        fromAgentId: "child-1",
        recipient: "child-2",
        kind: "finding",
        content: "The reducer already provides an idempotent replay boundary.",
        createdAt: "2026-08-06T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      agentPayloadSchema.safeParse({
        type: "approval.requested",
        approvalId: "approval-1",
        nonce: "abcdef1234567890",
        summary: "Run shell command",
        paths: [],
        network: [],
        risk: "medium",
        allowedScopes: ["once"],
        actorAgentId: "child-1",
      }).success,
    ).toBe(true);
  });
});

describe("provider and language schemas", () => {
  it("supports Execute as a first-class run mode and rejects legacy modes", () => {
    expect(runModeSchema.safeParse("execute").success).toBe(true);
    expect(runModeSchema.safeParse("code").success).toBe(false);
    expect(runModeSchema.safeParse("work").success).toBe(false);
  });

  it("accepts context usage snapshots and validates configurable context windows", () => {
    expect(contextWindowSchema.safeParse(258_000).success).toBe(true);
    expect(contextWindowSchema.safeParse(1_023).success).toBe(false);
    expect(contextWindowSchema.safeParse(258_000.5).success).toBe(false);
    expect(
      agentPayloadSchema.safeParse({
        type: "context.usage",
        tokens: 61_000,
        contextWindow: 258_000,
        compacting: false,
      }).success,
    ).toBe(true);
    expect(
      agentPayloadSchema.safeParse({
        type: "context.usage",
        tokens: 74_000,
        contextWindow: 258_000,
        compacting: false,
        estimated: true,
        source: "local-estimate",
        providerInputTokens: 61_000,
        breakdown: {
          systemPromptTokens: 12_000,
          systemToolTokens: 18_000,
          mcpToolTokens: 4_000,
          customAgentTokens: 0,
          memoryFileTokens: 8_000,
          skillTokens: 4_000,
          messageTokens: 28_000,
          freeSpaceTokens: 158_200,
          autocompactBufferTokens: 25_800,
        },
        footprint: {
          imageBytes: 12_000,
          imageCount: 1,
          largestToolResultBytes: 48_000,
          textBytes: 90_000,
          toolSchemaBytes: 24_000,
        },
      }).success,
    ).toBe(true);
  });

  it("accepts an OpenAI-compatible Ollama connection and rejects unsafe URLs", () => {
    const ollama = {
      id: "ollama",
      name: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      models: [
        {
          id: "qwen2.5-coder:7b",
          name: "Qwen 2.5 Coder 7B",
          reasoning: false,
          input: ["text"],
          contextWindow: 128_000,
          maxTokens: 32_000,
        },
      ],
    };

    expect(providerConnectionSchema.safeParse(ollama).success).toBe(true);
    expect(
      providerConnectionSchema.safeParse({
        ...ollama,
        api: "openai-responses",
      }).success,
    ).toBe(true);
    expect(
      providerConnectionSchema.safeParse({
        ...ollama,
        api: "unsupported",
      }).success,
    ).toBe(false);
    expect(
      providerConnectionSchema.safeParse({
        ...ollama,
        baseUrl: "file:///tmp/model.sock",
      }).success,
    ).toBe(false);
    expect(
      providerConnectionSchema.safeParse({ ...ollama, models: [] }).success,
    ).toBe(false);
  });

  it("supports system and every Artemis locale", () => {
    expect(appLanguageSchema.safeParse("system").success).toBe(true);
    for (const locale of APP_LOCALES) {
      expect(appLanguageSchema.safeParse(locale).success).toBe(true);
    }
    expect(appLanguageSchema.safeParse("nl").success).toBe(false);
  });

  it("supports system, light, and dark theme preferences", () => {
    expect(appThemeSchema.safeParse("system").success).toBe(true);
    expect(appThemeSchema.safeParse("light").success).toBe(true);
    expect(appThemeSchema.safeParse("dark").success).toBe(true);
    expect(appThemeSchema.safeParse("contrast").success).toBe(false);
  });
});

describe("office document schemas", () => {
  it("accepts versioned cross-platform document requests", () => {
    expect(
      officeDocumentRequestSchema.safeParse({
        protocolVersion: OFFICE_DOCUMENT_PROTOCOL_VERSION,
        requestId: "office-1",
        operation: "create",
        format: "word",
        path: "reports/summary.docx",
        content: {
          format: "word",
          paragraphs: [{ text: "Quarterly summary", heading: 1 }],
        },
      }).success,
    ).toBe(true);
    expect(
      officeDocumentRequestSchema.safeParse({
        protocolVersion: OFFICE_DOCUMENT_PROTOCOL_VERSION,
        requestId: "office-2",
        operation: "modify",
        format: "excel",
        path: "reports/summary.xlsx",
        patch: {
          type: "set-cell",
          sheet: "Summary",
          row: 2,
          column: 3,
          value: 42,
        },
      }).success,
    ).toBe(true);
  });

  it("rejects unsafe paths, mismatched content, and unknown protocol versions", () => {
    const base = {
      protocolVersion: OFFICE_DOCUMENT_PROTOCOL_VERSION,
      requestId: "office-invalid",
      operation: "create",
      format: "word",
      content: {
        format: "word",
        paragraphs: [{ text: "Summary" }],
      },
    };

    expect(
      officeDocumentRequestSchema.safeParse({
        ...base,
        path: "../outside.docx",
      }).success,
    ).toBe(false);
    expect(
      officeDocumentRequestSchema.safeParse({
        ...base,
        path: "summary.docx",
        content: {
          format: "pdf",
          pages: [{ text: "Wrong format" }],
        },
      }).success,
    ).toBe(false);
    expect(
      officeDocumentRequestSchema.safeParse({
        ...base,
        protocolVersion: 2,
        path: "summary.docx",
      }).success,
    ).toBe(false);
  });

  it("advertises all five operations on Windows and macOS", () => {
    const parsed = officeDocumentCapabilitiesSchema.parse({
      protocolVersion: OFFICE_DOCUMENT_PROTOCOL_VERSION,
      platforms: ["win32", "darwin"],
      formats: ["pdf", "excel", "word", "powerpoint"].map((format) => ({
        format,
        operations: ["create", "write", "read", "modify", "delete"],
        fidelity: "normalized",
      })),
    });

    expect(parsed.platforms).toEqual(["win32", "darwin"]);
    expect(parsed.formats).toHaveLength(4);
  });
});

describe("review schemas", () => {
  it("rejects unknown scopes, unsafe target IDs, and blank refs", () => {
    expect(
      reviewQuerySchema.safeParse({
        threadId: "thread-1",
        scope: "working-copy",
      }).success,
    ).toBe(false);
    expect(
      reviewQuerySchema.safeParse({
        threadId: "thread-1",
        scope: "branch",
        baseRef: "   ",
      }).success,
    ).toBe(false);
    expect(
      reviewMutationInputSchema.safeParse({
        threadId: "thread-1",
        scope: "unstaged",
        action: "stage",
        target: { kind: "file", id: "../../../arbitrary.patch" },
      }).success,
    ).toBe(false);
  });
});

describe("worktree schemas", () => {
  it("rejects blank branch names and missing cleanup intent", () => {
    expect(
      worktreeCommandSchema.safeParse({
        type: "worktree.branchize",
        threadId: "thread-1",
        branchName: "   ",
      }).success,
    ).toBe(false);
    expect(
      worktreeCommandSchema.safeParse({
        type: "worktree.cleanup",
        threadId: "thread-1",
      }).success,
    ).toBe(false);
    expect(
      worktreeCommandSchema.safeParse({
        type: "worktree.handoff",
        threadId: "thread-1",
        destination: "arbitrary-path",
      }).success,
    ).toBe(false);
  });
});
