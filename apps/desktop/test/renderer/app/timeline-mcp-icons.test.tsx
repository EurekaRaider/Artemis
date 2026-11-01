// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createThreadViewState } from "@artemis/protocol";
import { Timeline } from "../../../src/renderer/app/App.js";
import type {
  McpServerConfig,
  McpServerStatus,
} from "../../../src/shared/api.js";
import "../../fixtures/renderer-test-utils.js";

vi.mock(
  "../../../src/renderer/appearance/desktop-skin-bootstrap.js",
  () => ({}),
);

function renderMcp(config: McpServerConfig, recordedServerId?: string) {
  const state = createThreadViewState("thread");
  state.order = ["tool:call"];
  state.entryTurnIds = { "tool:call": "turn" };
  state.tools = {
    call: { id: "call", name: "mcp__helper__lookup", status: "completed" },
  };
  if (recordedServerId)
    state.mcpToolUses["turn\0parent\0call"] = {
      type: "mcp.tool.used",
      toolCallId: "call",
      turnId: "turn",
      agentId: "parent",
      serverId: recordedServerId,
      serverName: config.name,
      toolName: "lookup",
      timestamp: "2026-11-01T00:00:00Z",
    };
  const server: McpServerStatus = {
    config,
    state: "disconnected",
    tools: recordedServerId
      ? []
      : [
          {
            serverId: config.id,
            serverName: config.name,
            transport: config.transport,
            toolName: "lookup",
            piName: "mcp__helper__lookup",
            description: "Look up items",
            inputSchema: {},
            readOnly: true,
            destructive: false,
          },
        ],
  };
  return render(
    <Timeline
      installedPlugins={[]}
      installedSkills={[]}
      mcpServers={[server]}
      state={state}
      locale="en"
      onExternalLink={vi.fn()}
      onFileLink={vi.fn()}
      onFileLinkContextMenu={vi.fn()}
      onOpenChildAgent={vi.fn()}
      onOpenTurnReview={vi.fn()}
      onCopyText={vi.fn()}
      onEditUserMessage={undefined}
      onResolve={vi.fn()}
      onResolveUserInput={vi.fn()}
      onUndoTurnChanges={vi.fn()}
    />,
  );
}

const remote: McpServerConfig = {
  id: "remote",
  name: "Weather service",
  transport: "streamable-http",
  url: "https://example.test/mcp",
  enabled: true,
};

it("uses recorded MCP transport after the server has disconnected", () => {
  const { container } = renderMcp(remote, "remote");
  expect(
    container.querySelector(".tool-step-kind .resource-avatar"),
  ).toHaveAttribute("data-icon", "server");
});

it("uses exact registered MCP command metadata for brand matching", () => {
  const { container } = renderMcp({
    id: "local",
    name: "Code service",
    transport: "stdio",
    command: "npx",
    args: ["@modelcontextprotocol/server-github@1.0.0"],
    env: {},
    envVars: [],
    workspacePath: "/synthetic",
    allowNetwork: false,
    enabled: true,
  });
  expect(
    container.querySelector(".tool-step-kind .resource-avatar"),
  ).toHaveAttribute("data-icon", "github");
});

it("does not reinterpret a removed recorded server as the current registration", () => {
  const { container } = renderMcp(remote, "removed");
  expect(
    container.querySelector(".tool-step-kind .resource-avatar"),
  ).toHaveAttribute("data-icon", "mcp");
});
