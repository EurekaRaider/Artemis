import type { AgentEvent } from "../schema.js";
import { isLegacyInternalAgentMessage } from "../internal-messages.js";
import {
  appendOnce,
  clearThinkingParts,
  timelinePartId,
  type ReductionIndex,
} from "./timeline.js";
import { type ThreadViewState } from "./state.js";

export function applyMessagesPayload(
  state: ThreadViewState,
  event: AgentEvent,
  orderedItems: Set<string>,
  index: ReductionIndex,
): void {
  const payload = event.payload;
  switch (payload.type) {
    case "user.message": {
      if (isLegacyInternalAgentMessage(payload.text)) return;
      state.userMessages[payload.messageId] = {
        id: payload.messageId,
        text: payload.text,
        timestamp: event.timestamp,
      };
      appendOnce(state.order, orderedItems, `user:${payload.messageId}`);
      return;
    }
    case "message.superseded": {
      const prefix = `${payload.messageId}:`;
      for (const partId of Object.keys(state.messageParts)) {
        if (!partId.startsWith(prefix)) continue;
        delete state.messageParts[partId];
        orderedItems.delete(`part:${partId}`);
      }
      state.order = state.order.filter(
        (entry) =>
          !entry.startsWith(`part:${prefix}`) &&
          entry !== `part:${payload.messageId}`,
      );
      return;
    }
    case "message.part.delta": {
      clearThinkingParts(state, orderedItems, index);
      if (payload.partType === "thinking") return;
      delete state.activity;
      const partId = timelinePartId(index, payload.partId);
      const existing = state.messageParts[partId];
      state.messageParts[partId] = {
        id: partId,
        type: payload.partType,
        text: `${existing?.text ?? ""}${payload.delta}`,
        timestamp: existing?.timestamp ?? event.timestamp,
      };
      appendOnce(state.order, orderedItems, `part:${partId}`);
      return;
    }
  }
}
