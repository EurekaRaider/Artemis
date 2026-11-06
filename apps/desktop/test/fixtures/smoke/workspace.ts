import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import type { AgentPayload } from "@artemis/protocol";

import {
  store,
  settingsStore,
  taskSourceImages,
} from "../../../src/main/main.js";
import { smokeMode } from "./environment.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

export function seedSmokeMarkdownEditorFixture(): void {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  const workspacePath = process.env.ARTEMIS_SMOKE_WORKSPACE;
  if (!store || !view?.startsWith("markdown-editor") || !workspacePath) {
    return;
  }
  const now = new Date().toISOString();
  const projectId = "artemis-smoke-markdown-editor-project";
  const threadId = "artemis-smoke-markdown-editor-thread";
  // The verify harness owns the fixtures: ARTEMIS_SMOKE_WORKSPACE points at a
  // throwaway directory holding NOTES.md plus the binary fixture.bin, so the
  // production list/read/write/image IPC handlers exercise real files while
  // only the save-error view is intercepted above.
  store.upsertProject({
    id: projectId,
    name: "Artemis",
    path: workspacePath,
    createdAt: now,
    updatedAt: now,
  });
  store.createThread({
    id: threadId,
    projectId,
    title: "Markdown editor smoke",
    mode: "work",
    target: "local",
    status: "idle",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  if (view === "markdown-editor-navigation-preview") {
    const turnId = "artemis-smoke-markdown-preview-turn";
    const payloads: AgentPayload[] = [
      {
        type: "user.message",
        messageId: "artemis-smoke-markdown-preview-user",
        text: "Inspect the synthetic NOTES.md fixture.",
      },
      { type: "turn.started", mode: "work" },
      {
        type: "tool.started",
        toolCallId: "artemis-smoke-markdown-preview-tool",
        toolName: "read",
        input: { path: "NOTES.md" },
      },
      {
        type: "tool.completed",
        toolCallId: "artemis-smoke-markdown-preview-tool",
        output: "Synthetic Markdown fixture read.",
        isError: false,
      },
      { type: "turn.completed", reason: "completed" },
    ];
    store.appendEvents(
      threadId,
      payloads.map((payload, index) => ({
        eventId: `artemis-smoke-markdown-preview-${index}`,
        turnId,
        payload,
      })),
    );
  }
}

export async function seedSmokeEnvironmentFixture(): Promise<void> {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  if (smokeMode && view === "nocturne-review-comment-wide") {
    settingsStore?.setWorkspaceDockWidth(620);
  }
  // The icon-sizing smoke harness reuses this same synthetic repository
  // fixture so the branch popover, commit dialog, and environment rows all
  // render against real git data that lives entirely inside the isolated
  // user-data directory (no network, no real project identity).
  if (
    !store ||
    (!view?.startsWith("environment") &&
      !view?.startsWith("icon-sizing-environment") &&
      !(smokeMode && view?.startsWith("nocturne-")))
  ) {
    return;
  }
  const now = new Date().toISOString();
  const projectId = "artemis-smoke-environment-project";
  const threadId = "artemis-smoke-environment-thread";
  const turnId = "artemis-smoke-environment-turn";
  const workspace = join(
    app.getPath("userData"),
    "fixtures",
    "environment-repository",
  );
  const remote = join(
    app.getPath("userData"),
    "fixtures",
    "environment-remote.git",
  );
  await rm(workspace, { recursive: true, force: true });
  await rm(remote, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true });
  const git = (...args: string[]) =>
    execFileAsync("git", args, {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never",
      },
      timeout: 15_000,
    });
  await git("init", "-b", "main");
  await git("config", "user.name", "Artemis Smoke");
  await git("config", "user.email", "smoke@example.invalid");
  await writeFile(
    join(workspace, "README.md"),
    "# Artemis environment fixture\n\nOriginal line\n",
    "utf8",
  );
  await git("add", "--all", "--");
  await git("commit", "-m", "Initial fixture");
  await git("init", "--bare", remote);
  await git("remote", "add", "origin", remote);
  await git("push", "-u", "origin", "main");
  await git("branch", "codex/fix-issues-81-87");
  await git("branch", "codex/fix-issue-77-model-stream-stall");
  await git("branch", "codex/native-web-search");
  await git("branch", "codex/fix-issues-70-72");
  await git("branch", "gh-pages");
  if (process.env.ARTEMIS_SMOKE_VIEW !== "environment-branch-menu") {
    await writeFile(
      join(workspace, "README.md"),
      "# Artemis environment fixture\n\nUpdated line\nSecond line\n",
      "utf8",
    );
    await writeFile(join(workspace, "设计说明.md"), "任务环境面板\n", "utf8");
  }
  if (process.env.ARTEMIS_SMOKE_VIEW === "environment-push-execute") {
    await git("add", "--all", "--");
    await git("commit", "-m", "Ahead fixture");
  }

  store.upsertProject({
    id: projectId,
    name: "Artemis",
    path: workspace,
    createdAt: now,
    updatedAt: now,
  });
  store.createThread({
    id: threadId,
    projectId,
    title: "实现右上角任务环境面板",
    mode: "work",
    target: "local",
    status:
      view === "environment-feedback-approval"
        ? "waiting-approval"
        : view === "nocturne-update-waiting"
          ? "running"
          : "idle",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  if (view.startsWith("environment-non-git")) {
    await rm(join(workspace, ".git"), { recursive: true, force: true });
  }
  if (view === "environment-unstarted") return;
  type SmokeEnvironmentEvent = { id: string; payload: AgentPayload };
  const approvalEvents: SmokeEnvironmentEvent[] = [];
  if (view.startsWith("environment-feedback-approval")) {
    const approvalCount =
      view === "environment-feedback-approval-grouped" ? 2 : 1;
    for (let index = 0; index < approvalCount; index += 1) {
      const suffix = String(index + 1);
      const approvalId = `environment-smoke-approval-${suffix}`;
      const nonce = `environment-smoke-approval-nonce-${suffix}`;
      approvalEvents.push({
        id: `environment-approval-requested-${suffix}`,
        payload: {
          type: "approval.requested",
          approvalId,
          nonce,
          summary: `Apply reviewed workspace change ${suffix}`,
          command: `git apply reviewed-${suffix}.patch`,
          paths: ["README.md"],
          network: [],
          risk: "medium",
          allowedScopes: ["once", "session"],
          modelReason: "Matches this task.",
        },
      });
      if (view !== "environment-feedback-approval") {
        approvalEvents.push({
          id: `environment-approval-resolved-${suffix}`,
          payload: {
            type: "approval.resolved",
            approvalId,
            nonce,
            approved: true,
            scope: "once",
          },
        });
      }
    }
  }
  const events: SmokeEnvironmentEvent[] = [
    {
      id: "environment-turn-started",
      payload: { type: "turn.started", mode: "work" },
    },
    {
      id: "environment-user-message",
      payload: {
        type: "user.message",
        messageId: "environment-user-message",
        text: "实现任务环境面板，并验证 Git、子代理、MCP 和来源信息。",
      },
    },
    ...(["environment-empty", "environment-non-git-empty"].includes(view)
      ? []
      : ([
          {
            id: "environment-team",
            payload: {
              type: "agent-team.status",
              teamId: "environment-team",
              mission: "并行验证环境面板",
              status: process.env.ARTEMIS_SMOKE_REVIEW06
                ? "running"
                : "completed",
              memberAgentIds: ["ui-agent", "git-agent", "test-agent"],
              requiredAgentIds: ["ui-agent", "git-agent"],
              maxMembers: 8,
              updatedAt: now,
            },
          },
          ...[
            ["ui-agent", "界面实现", "running"],
            ["git-agent", "Git 安全检查", "completed"],
            ["test-agent", "渲染验证", "queued"],
          ].map(([agentId, label, status]) => ({
            id: `environment-child-${agentId}`,
            payload: {
              type: "child-agent.status" as const,
              agentId: agentId!,
              label: label!,
              teamId: "environment-team",
              status: status as "running" | "completed" | "queued",
              updatedAt: now,
            },
          })),
          {
            id: "environment-mcp-parent",
            payload: {
              type: "mcp.tool.used",
              toolCallId: "mcp-parent-1",
              serverId: "codegraph",
              serverName: "CodeGraph",
              toolName: "codegraph_explore",
              agentId: "parent",
            },
          },
          {
            id: "environment-mcp-child",
            payload: {
              type: "mcp.tool.used",
              toolCallId: "mcp-child-1",
              serverId: "codegraph",
              serverName: "CodeGraph",
              toolName: "codegraph_status",
              agentId: "ui-agent",
            },
          },
          {
            id: "environment-source-image",
            payload: {
              type: "task.source.added",
              sourceId: "source-screen",
              name: "Codex 环境信息参考.png",
              mimeType: "image/png",
              kind: "image",
            },
          },
          {
            id: "environment-source-file",
            payload: {
              type: "task.source.added",
              sourceId: "source-plan",
              name: "任务环境面板计划.md",
              mimeType: "text/markdown",
              kind: "file",
            },
          },
          {
            id: "environment-source-web-search",
            payload: {
              type: "task.source.added",
              sourceId: "source-web-search",
              kind: "web-search",
              query: "Artemis task environment GitHub checks",
              engine: "DuckDuckGo HTML",
              resultCount: 2,
              searchUrl:
                "https://html.duckduckgo.com/html/?q=Artemis+task+environment",
              links: [
                {
                  title: "Artemis repository",
                  url: "https://github.com/EurekaRaider/Artemis",
                },
                {
                  title: "GitHub checks documentation",
                  url: "https://docs.github.com/actions",
                },
              ],
            },
          },
        ] satisfies SmokeEnvironmentEvent[])),
    {
      id: "environment-assistant-message",
      payload: {
        type: "message.part.delta",
        partId: "environment-assistant-message:text",
        partType: "text",
        delta: "环境面板、Git 状态和任务来源已经验证。",
      },
    },
    ...(!["environment-branch-menu", "environment-non-git-empty"].includes(view)
      ? ([
          {
            id: "environment-readme-change",
            payload: {
              type: "file.changed",
              path: "README.md",
              operation: "update",
            },
          },
          {
            id: "environment-design-change",
            payload: {
              type: "file.changed",
              path: "设计说明.md",
              operation: "create",
            },
          },
        ] satisfies SmokeEnvironmentEvent[])
      : []),
    ...approvalEvents,
    ...(view === "environment-feedback-approval"
      ? []
      : ([
          {
            id: "environment-turn-completed",
            payload: {
              type: "turn.completed",
              reason: "completed",
              finalPartId: "environment-assistant-message:text",
              durationMs: 54_000,
            },
          },
        ] satisfies SmokeEnvironmentEvent[])),
  ];
  for (const event of events) {
    if (
      process.env.ARTEMIS_SMOKE_VIEW === "environment-branch-menu" &&
      (event.payload.type === "agent-team.status" ||
        event.payload.type === "child-agent.status" ||
        event.payload.type === "mcp.tool.used")
    ) {
      continue;
    }
    store.appendEvent(event.id, threadId, turnId, event.payload);
  }
  if (view === "environment-context-usage") {
    store.appendEvent("environment-context-usage", threadId, turnId, {
      type: "context.usage",
      tokens: 325_802,
      contextWindow: 1_000_000,
      compacting: false,
      estimated: true,
      source: "local-estimate",
      providerInputTokens: 325_000,
      breakdown: {
        systemPromptTokens: 2712,
        systemToolTokens: 7522,
        mcpToolTokens: 135,
        customAgentTokens: 0,
        memoryFileTokens: 2170,
        skillTokens: 6263,
        messageTokens: 307_000,
        freeSpaceTokens: 574_198,
        autocompactBufferTokens: 100_000,
      },
    });
  }
  if (!["environment-empty", "environment-non-git-empty"].includes(view)) {
    await taskSourceImages().save(threadId, "source-screen", {
      name: "Codex 环境信息参考.png",
      mimeType: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    });
  }
}
