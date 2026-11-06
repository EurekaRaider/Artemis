import type { AgentEvent, ToolStartedPayload } from "../schema.js";
import {
  clearThinkingParts,
  appendOnce,
  type ReductionIndex,
} from "./timeline.js";
import { type ThreadViewState } from "./state.js";

export function applyToolsPayload(
  state: ThreadViewState,
  event: AgentEvent,
  orderedItems: Set<string>,
  index: ReductionIndex,
): void {
  const payload = event.payload;
  switch (payload.type) {
    case "tool.started": {
      clearThinkingParts(state, orderedItems, index);
      delete state.activity;
      const tool = payload as ToolStartedPayload;
      state.tools[tool.toolCallId] = {
        id: tool.toolCallId,
        name: tool.toolName,
        ...(tool.parentToolCallId
          ? { parentToolCallId: tool.parentToolCallId }
          : {}),
        ...(tool.input === undefined ? {} : { input: tool.input }),
        output: "",
        status: "running",
        startedAt: event.timestamp,
        lastActivityAt: event.timestamp,
      };
      appendOnce(state.order, orderedItems, `tool:${tool.toolCallId}`);
      return;
    }
    case "tool.updated": {
      const tool = state.tools[payload.toolCallId];
      if (tool) {
        state.tools[payload.toolCallId] = {
          ...tool,
          output: `${tool.output}${payload.output}`,
          lastActivityAt: event.timestamp,
        };
      }
      return;
    }
    case "tool.completed": {
      const tool = state.tools[payload.toolCallId];
      if (tool) {
        state.tools[payload.toolCallId] = {
          ...tool,
          ...(payload.structuredContent === undefined
            ? {}
            : { structuredContent: payload.structuredContent }),
          ...(payload.images ? { images: payload.images } : {}),
          output: payload.output ?? tool.output,
          status: payload.isError ? "failed" : "completed",
          lastActivityAt: event.timestamp,
        };
      }
      return;
    }
  }
}
