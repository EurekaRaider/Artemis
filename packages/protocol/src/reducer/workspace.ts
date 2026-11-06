import type { AgentEvent } from "../schema.js";
import { reduceArtifactEvent } from "../artifact.js";
import { type ThreadViewState } from "./state.js";
import { type ReductionIndex } from "./timeline.js";

export function applyWorkspacePayload(
  state: ThreadViewState,
  event: AgentEvent,
  orderedItems: Set<string>,
  index: ReductionIndex,
): void {
  const payload = event.payload;
  switch (payload.type) {
    case "artifact.event": {
      const key = payload.event.session.sessionId;
      state.artifacts = {
        ...state.artifacts,
        [key]: reduceArtifactEvent(state.artifacts?.[key], payload.event),
      };
      return;
    }
    case "file.changed": {
      if (!state.changedFiles.includes(payload.path)) {
        state.changedFiles.push(payload.path);
      }
      return;
    }
    case "mcp.tool.used": {
      const key = `${event.turnId ?? ""}\0${payload.agentId}\0${payload.toolCallId}`;
      if (!state.mcpToolUses[key]) state.mcpToolUseOrder.push(key);
      state.mcpToolUses[key] = {
        ...payload,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        timestamp: event.timestamp,
      };
      return;
    }
    case "task.source.added": {
      if (!state.taskSources[payload.sourceId]) {
        state.taskSourceOrder.push(payload.sourceId);
      }
      state.taskSources[payload.sourceId] = {
        ...payload,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        timestamp: event.timestamp,
      };
      return;
    }
    case "queue.updated": {
      state.queue = {
        steering: [...payload.steering],
        followUp: [...payload.followUp],
      };
      return;
    }
    case "queue.recovered":
      return;
    case "terminal.output":
      return;
    case "thread.notification.updated":
      if ((state.notification?.revision ?? -1) < payload.state.revision) {
        state.notification = { ...payload.state };
      }
      return;
    case "turn.change-set.updated":
      return;
  }
}
