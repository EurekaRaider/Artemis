import {
  defineBrokerTool,
  modelApprovalParameter,
  sandboxEscalationParameter,
  modelApproval,
} from "../broker-tool-parameters.js";
import { prepareMcpToolContent } from "../mcp-content.js";
import type { OpenThreadRequest } from "../runtime-types.js";
import { projectMcpTools } from "../../policy/project-mcp-overrides.js";

import { randomUUID } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";
import { type McpToolCallResult } from "@artemis/protocol";

import type { AgentRuntimeDependencies } from "../agent-runtime-dependencies.js";
export function createSessionMcpTools(
  request: OpenThreadRequest,
  services: Pick<
    AgentRuntimeDependencies,
    "configuration" | "threads" | "broker"
  >,
  initialMcpTools: Awaited<ReturnType<typeof projectMcpTools>>,
) {
  let configuredMcpTools = initialMcpTools;
  const mcpToolByPiName = new Map(
    configuredMcpTools.map((tool) => [tool.piName, tool] as const),
  );
  const createMcpTools = (actorAgentId?: string) =>
    configuredMcpTools.map((tool) =>
      defineBrokerTool({
        name: tool.piName,
        label: `${tool.serverName}: ${tool.toolName}`,
        // Pi forwards structuredContent to Codemode only for declared outputs.
        // MCP results without a schema can still contain any JSON value.
        outputSchema:
          (tool.outputSchema as TSchema | undefined) ?? Type.Unknown(),
        namespace: {
          name: tool.namespace ?? tool.serverId,
          description: tool.serverName,
        },
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: tool.destructive,
        },
        description: `${tool.description} Provide the MCP arguments plus a risk assessment for this exact call.`,
        parameters: Type.Object(
          {
            arguments: tool.inputSchema as TSchema,
            model_approval: modelApprovalParameter,
            sandbox_escalation: sandboxEscalationParameter,
          },
          { additionalProperties: false },
        ),
        execute: async (_toolCallId, parameters) => {
          const hosted = services.threads.get(request.threadId);
          if (!hosted?.currentTurnId) {
            throw new Error("No active turn is available for this MCP call.");
          }
          if (tool.serverId === services.configuration.computerUseServerId) {
            if (!hosted.session.model?.input.includes("image"))
              throw new Error(
                "Select a model that supports images to use Computer Use.",
              );
            if (tool.toolName === "computer_open") {
              const names = configuredMcpTools
                .filter((candidate) => candidate.serverId === tool.serverId)
                .map((candidate) => candidate.piName);
              hosted.session.setActiveToolsByName([
                ...new Set([...hosted.session.getActiveToolNames(), ...names]),
              ]);
              for (const active of hosted.session.agent.state.tools)
                if (
                  names.includes(active.name) &&
                  !hosted.executeTools.some(
                    (current) => current.name === active.name,
                  )
                )
                  hosted.executeTools.push(active);
            }
          }
          const result = await services.broker.request({
            kind: "mcp.call",
            approvalId: randomUUID(),
            threadId: request.threadId,
            turnId: hosted.currentTurnId,
            workspacePath: request.workspacePath,
            serverId: tool.serverId,
            serverName: tool.serverName,
            transport: tool.transport,
            toolName: tool.toolName,
            arguments: parameters.arguments as Record<string, unknown>,
            ...(parameters.sandbox_escalation
              ? { sandboxEscalation: parameters.sandbox_escalation }
              : {}),
            ...(actorAgentId ? { actorAgentId } : {}),
            readOnly: tool.readOnly,
            destructive: tool.destructive,
            modelApproval: modelApproval(parameters.model_approval),
            mode: hosted.currentMode ?? "plan",
          });
          if (!result.approved) {
            throw new Error(result.error ?? "The user denied this MCP call.");
          }
          const data = result.data as McpToolCallResult | undefined;
          if (data?.isError) {
            const message = data.content
              .flatMap((block) => (block.type === "text" ? [block.text] : []))
              .join("\n")
              .trim();
            throw new Error(message || "MCP tool returned an error.");
          }
          const actorSession = actorAgentId
            ? (hosted.childAgents.get(actorAgentId)?.session ?? hosted.session)
            : hosted.session;
          const content = [...(data?.content ?? [])];
          // Pi's model-facing history contains only content, not structuredContent.
          // Supply a bounded text fallback when the MCP server omits one.
          if (
            data?.structuredContent !== undefined &&
            !content.some((block) => block.type === "text" && block.text.trim())
          ) {
            content.push({
              type: "text",
              text: JSON.stringify(data.structuredContent),
            });
          }
          const prepared = prepareMcpToolContent(
            content,
            actorSession.model?.contextWindow,
            actorSession.getContextUsage()?.tokens,
          );
          return {
            content: prepared.content,
            ...(data?.structuredContent !== undefined
              ? {
                  structuredContent:
                    data.structuredContent as import("@earendil-works/pi-ai").JsonValue,
                }
              : {}),
            details: {
              serverId: tool.serverId,
              toolName: tool.toolName,
              ...(data?.metrics
                ? {
                    metrics: {
                      ...data.metrics,
                      deliveredTextBytes: prepared.deliveredTextBytes,
                      omittedTextBytes: prepared.omittedTextBytes,
                      truncated: prepared.truncated,
                    },
                  }
                : {}),
            },
          };
        },
      }),
    );
  let mcpTools = createMcpTools();
  const searchMcpToolsTool = defineBrokerTool({
    name: "search_mcp_tools",
    label: "Search MCP tools",
    description:
      "Search configured MCP servers by server, tool, or capability. Matching tools are activated for later calls without loading every MCP schema into context.",
    parameters: Type.Object(
      {
        query: Type.String({ minLength: 1 }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
      },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, parameters) => {
      const hosted = services.threads.get(request.threadId);
      if (!hosted) {
        throw new Error(`Thread is not open: ${request.threadId}`);
      }
      const queryTerms = parameters.query
        .trim()
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean);
      const limit = parameters.limit ?? 5;
      const matches = configuredMcpTools
        .filter((tool) => {
          const searchable = [
            tool.piName,
            tool.serverName,
            tool.toolName,
            tool.description,
          ]
            .join(" ")
            .toLocaleLowerCase();
          return (
            queryTerms.length > 0 &&
            queryTerms.every((term) => searchable.includes(term))
          );
        })
        .slice(0, limit);
      if (matches.length > 0) {
        const activatedNames = new Set(hosted.session.getActiveToolNames());
        for (const match of matches) {
          activatedNames.add(match.piName);
        }
        hosted.session.setActiveToolsByName([...activatedNames]);
        for (const match of matches) {
          const sessionTool = hosted.session.agent.state.tools.find(
            (candidate) => candidate.name === match.piName,
          );
          if (
            sessionTool &&
            !hosted.executeTools.some(
              (candidate) => candidate.name === sessionTool.name,
            )
          ) {
            hosted.executeTools.push(sessionTool);
          }
        }
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              query: parameters.query,
              matches: matches.map((tool) => ({
                name: tool.piName,
                server: tool.serverName,
                tool: tool.toolName,
                description: tool.description,
                inputSchema: tool.inputSchema,
                readOnly: tool.readOnly,
                destructive: tool.destructive,
              })),
            }),
          },
        ],
        details: { activated: matches.map((tool) => tool.piName) },
      };
    },
  });
  const mcpDiscoveryTools = [searchMcpToolsTool];
  return {
    mcpToolByPiName,
    createMcpTools,
    searchMcpToolsTool,
    mcpDiscoveryTools,
    get configuredMcpTools() {
      return configuredMcpTools;
    },
    set configuredMcpTools(value: typeof configuredMcpTools) {
      configuredMcpTools = value;
    },
    get mcpTools() {
      return mcpTools;
    },
    set mcpTools(value: typeof mcpTools) {
      mcpTools = value;
    },
  };
}
