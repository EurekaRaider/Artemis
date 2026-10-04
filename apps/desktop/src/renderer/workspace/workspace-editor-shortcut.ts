import type { KeyboardEvent } from "react";

export function handleWorkspaceEditorSaveShortcut(
  event: KeyboardEvent<HTMLElement>,
  canSave: boolean,
  onSave: () => void,
): boolean {
  if (event.nativeEvent.isComposing) return false;
  if (event.key.toLowerCase() !== "s" || !(event.metaKey || event.ctrlKey)) {
    return false;
  }
  event.preventDefault();
  if (canSave) onSave();
  return true;
}
