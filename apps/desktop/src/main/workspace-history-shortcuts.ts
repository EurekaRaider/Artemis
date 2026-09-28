import type { WebContents } from "electron";
import { workspaceHistoryShortcut } from "../shared/workspace-history-shortcut.js";

export function installWorkspaceHistoryShortcuts(contents: WebContents) {
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.isComposing) return;
    const direction = workspaceHistoryShortcut({
      key: input.key,
      ctrlKey: input.control,
      metaKey: input.meta,
      shiftKey: input.shift,
      altKey: input.alt,
    });
    if (!direction) return;
    // Native Edit-menu accelerators otherwise bypass the document's history.
    event.preventDefault();
    const nativeHistory = () => {
      if (!contents.isDestroyed()) contents[direction]();
    };
    void contents
      .executeJavaScript(
        `window.artemisApplyWorkspaceHistory?.(${JSON.stringify(direction)}) ?? false`,
      )
      .then((handled: boolean) => {
        if (!handled) nativeHistory();
      })
      .catch(nativeHistory);
  });
}
