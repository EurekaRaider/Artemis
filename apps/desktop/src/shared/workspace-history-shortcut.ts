export type HistoryDirection = "undo" | "redo";

export function workspaceHistoryShortcut(input: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): HistoryDirection | undefined {
  if (input.altKey || (!input.ctrlKey && !input.metaKey)) return;
  const key = input.key.toLowerCase();
  if (key === "z") return input.shiftKey ? "redo" : "undo";
  if (key === "y" && input.ctrlKey && !input.metaKey && !input.shiftKey)
    return "redo";
}
