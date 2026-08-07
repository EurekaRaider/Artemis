const DEFAULT_PROMPT_HISTORY_LIMIT = 100;

export interface PromptHistoryNavigation {
  index: number;
  draft: string;
  value?: string;
}

export function addPromptHistoryEntry(
  history: string[],
  prompt: string,
  limit = DEFAULT_PROMPT_HISTORY_LIMIT,
): string[] {
  const value = prompt.trim();
  if (!value) return history;
  return [value, ...history.filter((candidate) => candidate !== value)].slice(
    0,
    limit,
  );
}

export function navigatePromptHistory(
  history: string[],
  currentValue: string,
  state: PromptHistoryNavigation,
  direction: "previous" | "next",
): Required<PromptHistoryNavigation> | undefined {
  if (history.length === 0) return undefined;

  if (direction === "previous") {
    const index = Math.min(state.index + 1, history.length - 1);
    return {
      index,
      draft: state.index < 0 ? currentValue : state.draft,
      value: history[index]!,
    };
  }

  if (state.index < 0) return undefined;
  const index = state.index - 1;
  return {
    index,
    draft: state.draft,
    value: index < 0 ? state.draft : history[index]!,
  };
}
