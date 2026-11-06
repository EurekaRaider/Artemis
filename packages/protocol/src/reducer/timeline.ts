import { type ThreadViewState } from "./state.js";

export function appendOnce(
  items: string[],
  seenItems: Set<string>,
  id: string,
): void {
  if (seenItems.has(id)) return;
  seenItems.add(id);
  items.push(id);
}

export function clearThinkingParts(
  state: ThreadViewState,
  orderedItems: Set<string>,
  index: ReductionIndex,
): void {
  const thinkingEntries = index.thinkingEntries;
  if (thinkingEntries.size === 0) return;
  for (const entry of thinkingEntries) {
    delete state.messageParts[entry.slice("part:".length)];
    orderedItems.delete(entry);
  }
  state.order = state.order.filter((entry) => !thinkingEntries.has(entry));
  thinkingEntries.clear();
}

export const AFTER_TOOL_SEGMENT = "::after-tool::";

export interface ReductionIndex {
  writableTurns: Set<string>;
  parts: Map<string, { id: string; position: number }>;
  lastTool?: { id: string; position: number } | undefined;
  thinkingEntries: Set<string>;
}

export function indexEntry(
  index: ReductionIndex,
  entry: string,
  position: number,
): void {
  if (entry.startsWith("tool:"))
    index.lastTool = { id: entry.slice(5), position };
  if (entry.startsWith("part:")) {
    const id = entry.slice(5);
    const sourceId = id.split(AFTER_TOOL_SEGMENT)[0]!;
    index.parts.set(sourceId, { id, position });
  }
}

export function createReductionIndex(state: ThreadViewState): ReductionIndex {
  const index: ReductionIndex = {
    writableTurns: new Set(),
    parts: new Map(),
    thinkingEntries: new Set(),
  };
  state.order.forEach((entry, position) => indexEntry(index, entry, position));
  for (const part of Object.values(state.messageParts)) {
    if (part.type === "thinking") index.thinkingEntries.add(`part:${part.id}`);
  }
  return index;
}

export function timelinePartId(
  index: ReductionIndex,
  sourcePartId: string,
): string {
  const part = index.parts.get(sourcePartId);
  if (!part) return sourcePartId;
  if (index.lastTool && index.lastTool.position > part.position) {
    return `${sourcePartId}${AFTER_TOOL_SEGMENT}${index.lastTool.id}`;
  }
  return part.id;
}
