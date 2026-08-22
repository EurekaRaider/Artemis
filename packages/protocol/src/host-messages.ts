import type {
  AgentPayload,
  ApprovalResolution,
  ModelApprovalDecision,
  ModelSelection,
  PromptAttachment,
  ProviderConnection,
  RunMode,
  ShellRuntimeConfiguration,
  ThinkingLevel,
  WorkspaceTarget,
  UserInputOption,
} from "./schema.js";
import type { OfficeDocumentRequest } from "./office.js";

export const AGENT_CONCURRENCY_MINIMUM = 2;
export const AGENT_CONCURRENCY_AUTOMATIC_MAXIMUM = 16;
export const AGENT_CONCURRENCY_MAXIMUM = 64;
export const AGENT_CONCURRENCY_FALLBACK = 10;
export const AGENT_TEAM_LOGICAL_MAXIMUM = 64;
export const AGENT_TEAM_MAXIMUM_DEPTH = 5;
export const AGENT_TEAM_MAXIMUM_DIRECT_CHILDREN = 8;
export const AGENT_TEAM_SPAWN_BUDGET = 128;

export type RuntimeCredential =
  | {
      type: "api_key";
      key?: string;
      env?: Record<string, string>;
    }
  | {
      type: "oauth";
      refresh: string;
      access: string;
      expires: number;
      [key: string]: unknown;
    };

export interface McpRuntimeTool {
  serverId: string;
  serverName: string;
  transport: "stdio" | "streamable-http";
  piName: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  destructive: boolean;
}

export type McpToolResultContent =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      data: string;
      mimeType: string;
    };

export interface McpToolResultMetrics {
  textBytes: number;
  imageBytes: number;
  imageCount: number;
  omittedContentCount: number;
}

export interface McpToolCallResult {
  content: McpToolResultContent[];
  isError: boolean;
  metrics: McpToolResultMetrics;
}

export interface ExtensionRuntimeTool {
  extensionId: string;
  extensionName: string;
  piName: string;
  toolName: string;
  label: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AgentRuntimeConfiguration {
  credentials: Record<string, RuntimeCredential>;
  shell?: ShellRuntimeConfiguration;
  providers?: ProviderConnection[];
  selection?: ModelSelection;
  contextWindow?: number;
  globalAgents?: {
    path: string;
    content: string;
  };
  disabledSkillFiles?: string[];
  mcpTools?: McpRuntimeTool[];
  extensionTools?: ExtensionRuntimeTool[];
}

export interface AgentModelInfo {
  providerId: string;
  modelId: string;
  name: string;
  reasoning: boolean;
  thinkingLevels?: ThinkingLevel[];
  highestThinkingLevel?: ThinkingLevel;
  contextWindow: number;
  configured: boolean;
}

export interface AgentRuntimeCatalog {
  models: AgentModelInfo[];
  selection?: ModelSelection;
}

export interface AgentConcurrencyRuntimeStatus {
  active: number;
  activeParents: number;
  waiting: number;
  queued: number;
  limit: number;
}

export type AgentHostCommand =
  | {
      type: "runtime.configure";
      requestId: string;
      configuration: AgentRuntimeConfiguration;
    }
  | {
      type: "runtime.catalog";
      requestId: string;
    }
  | {
      type: "runtime.concurrency.set";
      requestId: string;
      limit: number;
    }
  | {
      type: "runtime.concurrency.status";
      requestId: string;
    }
  | {
      type: "thread.open";
      requestId: string;
      threadId: string;
      workspacePath: string;
      target: WorkspaceTarget;
      sessionFile?: string;
      selection?: ModelSelection;
      contextWindow?: number;
    }
  | {
      type: "thread.model.set";
      requestId: string;
      threadId: string;
      selection: ModelSelection;
      contextWindow: number;
    }
  | {
      type: "thread.compact";
      requestId: string;
      threadId: string;
      instructions?: string;
    }
  | {
      type: "turn.prompt";
      requestId: string;
      threadId: string;
      turnId: string;
      text: string;
      mode: RunMode;
      attachments?: PromptAttachment[];
      goal?: string;
      memoryContext?: string;
    }
  | {
      type: "turn.cancel";
      requestId: string;
      threadId: string;
    }
  | {
      type: "turn.queue.clear" | "turn.queue.steer";
      requestId: string;
      threadId: string;
    }
  | {
      type: "turn.queue.replace";
      requestId: string;
      threadId: string;
      followUp: string[];
    }
  | {
      type: "turn.steer" | "turn.follow-up";
      requestId: string;
      threadId: string;
      text: string;
      attachments?: PromptAttachment[];
    }
  | {
      type: "child.status" | "child.cancel" | "child.retry";
      requestId: string;
      threadId: string;
      agentId: string;
    }
  | {
      type: "child.steer";
      requestId: string;
      threadId: string;
      agentId: string;
      text: string;
    }
  | {
      type: "team.cancel";
      requestId: string;
      threadId: string;
      teamId: string;
    }
  | {
      type: "thread.fork";
      requestId: string;
      threadId: string;
      entryId?: string;
    }
  | {
      type: "thread.close";
      requestId: string;
      threadId: string;
    }
  | {
      type: "thread.delete";
      requestId: string;
      threadId: string;
      sessionFile?: string;
    }
  | {
      type: "broker.resolve";
      requestId: string;
      resolution: ApprovalResolution;
      result?: unknown;
      error?: string;
    };

export type BrokerExecutionRequest =
  | {
      kind: "user.input";
      approvalId: string;
      threadId: string;
      turnId: string;
      workspacePath: string;
      header: string;
      question: string;
      options: UserInputOption[];
      mode: RunMode;
    }
  | {
      kind: "shell.execute";
      approvalId: string;
      threadId: string;
      turnId: string;
      workspacePath: string;
      command: string;
      actorAgentId?: string;
      modelApproval: ModelApprovalDecision;
      mode: RunMode;
    }
  | {
      kind: "memory.append";
      approvalId: string;
      threadId: string;
      turnId: string;
      workspacePath: string;
      scope: "project" | "global";
      title: string;
      content: string;
      keywords: string[];
      mode: RunMode;
    }
  | {
      kind: "workspace.write";
      approvalId: string;
      threadId: string;
      turnId: string;
      workspacePath: string;
      relativePath: string;
      actorAgentId?: string;
      content: string;
      modelApproval: ModelApprovalDecision;
      mode: RunMode;
    }
  | {
      kind: "office.document";
      approvalId: string;
      threadId: string;
      turnId: string;
      workspacePath: string;
      document: OfficeDocumentRequest;
      actorAgentId?: string;
      modelApproval: ModelApprovalDecision;
      mode: RunMode;
    }
  | {
      kind: "mcp.call";
      approvalId: string;
      threadId: string;
      turnId: string;
      workspacePath: string;
      serverId: string;
      serverName: string;
      transport: "stdio" | "streamable-http";
      toolName: string;
      arguments: Record<string, unknown>;
      actorAgentId?: string;
      readOnly: boolean;
      destructive: boolean;
      modelApproval: ModelApprovalDecision;
      mode: RunMode;
    }
  | {
      kind: "extension.call";
      approvalId: string;
      threadId: string;
      turnId: string;
      workspacePath: string;
      extensionId: string;
      extensionName: string;
      toolName: string;
      arguments: Record<string, unknown>;
      actorAgentId?: string;
      modelApproval: ModelApprovalDecision;
      mode: RunMode;
    };

export interface AgentHostEvent {
  threadId: string;
  turnId?: string;
  payload: AgentPayload;
}

export type AgentHostMessage =
  | {
      type: "response";
      requestId: string;
      ok: true;
      data?: unknown;
    }
  | {
      type: "response";
      requestId: string;
      ok: false;
      error: string;
    }
  | {
      type: "event";
      threadId: string;
      turnId?: string;
      payload: AgentPayload;
    }
  | {
      type: "events";
      events: AgentHostEvent[];
    }
  | {
      type: "turn.telemetry";
      threadId: string;
      turnId: string;
      stage: "host-received";
      timestamp: number;
    }
  | {
      type: "thread.session";
      threadId: string;
      sessionFile: string;
    }
  | {
      type: "broker.request";
      requestId: string;
      request: BrokerExecutionRequest;
    };
