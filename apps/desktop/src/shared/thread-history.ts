import type { AgentEvent, ThreadViewState } from "@artemis/protocol";

export interface ThreadHistoryCursor {
  snapshotSeq: number;
  beforeTurn: number;
}

export interface ThreadHistoryPage {
  version: 1;
  state: ThreadViewState;
  events: AgentEvent[];
  turnPositions: Record<string, number>;
  entryPositions: Record<string, number>;
  cursor?: ThreadHistoryCursor;
}

// Earlier pages contribute timeline content only; current runtime state wins.
export function mergeHistoryPage(
  current: ThreadHistoryPage,
  earlier: ThreadHistoryPage,
): ThreadHistoryPage {
  const state = current.state;
  const old = earlier.state;
  const unique = (left: string[], right: string[]) => [
    ...new Set([...left, ...right]),
  ];
  const turnPositions = { ...earlier.turnPositions, ...current.turnPositions };
  const entryPositions = {
    ...earlier.entryPositions,
    ...current.entryPositions,
  };
  return {
    turnPositions,
    entryPositions,
    version: 1,
    events: current.events,
    ...(earlier.cursor ? { cursor: earlier.cursor } : {}),
    state: {
      ...state,
      order: unique(old.order, state.order).sort(
        (a, b) => entryPositions[a]! - entryPositions[b]!,
      ),
      turnOrder: unique(old.turnOrder, state.turnOrder).sort(
        (a, b) => turnPositions[a]! - turnPositions[b]!,
      ),
      turns: { ...old.turns, ...state.turns },
      entryTurnIds: { ...old.entryTurnIds, ...state.entryTurnIds },
      userMessages: { ...old.userMessages, ...state.userMessages },
      messageParts: { ...old.messageParts, ...state.messageParts },
      tools: { ...old.tools, ...state.tools },
    },
  };
}
