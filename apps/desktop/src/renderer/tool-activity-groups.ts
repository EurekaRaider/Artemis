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

function canAppendTool(
  previous: TimelineActivityEntry | undefined,
  groupKey: string,
): previous is TimelineToolGroupEntry {
  if (previous?.kind !== "tool-group") return false;
  if (previous.key.startsWith(`${groupKey}:`)) return true;
  // Shell reads and searches often alternate during one stretch of work.
  return (
    ["bash", "file-exploration"].includes(groupKey) &&
    ["bash:", "file-exploration:"].some((prefix) =>
      previous.key.startsWith(prefix),
    )
  );
}

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
  messageParts: ThreadViewState["messageParts"] = {},
): TimelineActivityEntry[] {
  const entries: TimelineActivityEntry[] = [];

  for (const entry of order) {
    if (
      entry.startsWith("part:") &&
      messageParts[entry.slice(5)]?.type === "thinking"
    )
      continue;
    if (!entry.startsWith("tool:")) {
      entries.push({ kind: "entry", key: entry, entry });
      continue;
    }

    const toolId = entry.slice("tool:".length);
    const tool = tools[toolId];
    if (!tool || HIDDEN_TIMELINE_TOOLS.has(tool.name)) continue;

    const groupKey = toolActivityGroupKey(tool.name, tool.input);
    const previous = entries.at(-1);
    if (canAppendTool(previous, groupKey)) {
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

export function appendTimelineActivities(
  previous: readonly TimelineActivityEntry[],
  order: readonly string[],
  tools: Readonly<Record<string, ToolState>>,
  startIndex: number,
  messageParts: ThreadViewState["messageParts"] = {},
): TimelineActivityEntry[] {
  if (startIndex >= order.length) return previous as TimelineActivityEntry[];
  const entries = [...previous];
  for (let index = startIndex; index < order.length; index += 1) {
    const entry = order[index]!;
    if (
      entry.startsWith("part:") &&
      messageParts[entry.slice(5)]?.type === "thinking"
    )
      continue;
    if (!entry.startsWith("tool:")) {
      entries.push({ kind: "entry", key: entry, entry });
      continue;
    }
    const toolId = entry.slice("tool:".length);
    const tool = tools[toolId];
    if (!tool || HIDDEN_TIMELINE_TOOLS.has(tool.name)) continue;
    const groupKey = toolActivityGroupKey(tool.name, tool.input);
    const previousEntry = entries.at(-1);
    if (canAppendTool(previousEntry, groupKey)) {
      entries[entries.length - 1] = {
        ...previousEntry,
        toolIds: [...previousEntry.toolIds, toolId],
      };
    } else {
      entries.push({
        kind: "tool-group",
        key: `${groupKey}:${toolId}`,
        toolIds: [toolId],
      });
    }
  }
  return entries;
}
