import type { ThreadViewState, ToolState } from "@artemis/protocol";

import { toolActivityGroupKey } from "./tool-presentation.js";

const HIDDEN_TIMELINE_TOOLS = new Set([
  "request_user_input",
  "spawn_agent",
  "update_plan",
]);

export interface TimelineItemEntry {
  kind: "entry";
  key: string;
  entry: string;
}

export interface TimelineToolGroupEntry {
  kind: "tool-group";
  key: string;
  toolIds: string[];
}

export type TimelineActivityEntry = TimelineItemEntry | TimelineToolGroupEntry;

export function latestVisibleToolGroupKey(
  entries: readonly TimelineActivityEntry[],
  messageParts: ThreadViewState["messageParts"],
): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === "tool-group") return entry.key;
    if (entry.entry.startsWith("part:")) {
      const part = messageParts[entry.entry.slice("part:".length)];
      if (!part || part.type === "thinking") continue;
    }
    return undefined;
  }
  return undefined;
}

export function groupTimelineActivities(
  order: readonly string[],
  tools: Readonly<Record<string, ToolState>>,
): TimelineActivityEntry[] {
  const entries: TimelineActivityEntry[] = [];

  for (const entry of order) {
    if (!entry.startsWith("tool:")) {
      entries.push({ kind: "entry", key: entry, entry });
      continue;
    }

    const toolId = entry.slice("tool:".length);
    const tool = tools[toolId];
    if (!tool || HIDDEN_TIMELINE_TOOLS.has(tool.name)) continue;

    const groupKey = toolActivityGroupKey(tool.name, tool.input);
    const previous = entries.at(-1);
    if (
      previous?.kind === "tool-group" &&
      previous.key.startsWith(`${groupKey}:`)
    ) {
      previous.toolIds.push(toolId);
      continue;
    }

    entries.push({
      kind: "tool-group",
      key: `${groupKey}:${toolId}`,
      toolIds: [toolId],
    });
  }

  return entries;
}
