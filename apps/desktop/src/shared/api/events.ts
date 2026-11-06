import type {
  AgentEvent,
  AgentHostEvent,
  AutomationEvent,
} from "@artemis/protocol";
import type { McpServerStatus } from "./mcp.js";
import type { ReleaseUpdateStatus } from "./updates-diagnostics.js";
export interface EventsApi {
  onMcpServerStatus(listener: (status: McpServerStatus) => void): () => void;
  onResourceInstallProgress(
    listener: (progress: ResourceInstallProgress) => void,
  ): () => void;
  onUpdateStatus(listener: (status: ReleaseUpdateStatus) => void): () => void;
  onAgentEvent(listener: (event: AgentEvent) => void): () => void;
  onAgentEvents(listener: (events: AgentEvent[]) => void): () => void;
  onAgentActivities(listener: (events: AgentHostEvent[]) => void): () => void;
  onAutomationEvent(listener: (event: AutomationEvent) => void): () => void;
  onAutomationThreadOpen(listener: (threadId: string) => void): () => void;
  onProjectGitChanged(
    listener: (context: { projectId: string; threadId?: string }) => void,
  ): () => void;
}

export interface ResourceInstallProgress {
  operationId: string;
  kind: "mcp" | "skill" | "plugin";
  resourceId: string;
  percent: number;
}
