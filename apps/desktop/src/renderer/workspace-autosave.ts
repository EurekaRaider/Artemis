// Editors retain their flush callback while a save is pending, even off-screen.
const editors = new Map<
  string,
  { threadId: string; path: string; flush(): Promise<void> }
>();
export function registerWorkspaceAutosave(
  key: string,
  editor: { threadId: string; path: string; flush(): Promise<void> },
) {
  editors.set(key, editor);
}
export async function flushWorkspaceEdits(threadId?: string, path?: string) {
  await Promise.all(
    [...editors.values()]
      .filter(
        (editor) =>
          (!threadId || editor.threadId === threadId) &&
          (!path || editor.path === path),
      )
      .map((editor) => editor.flush()),
  );
}
declare global {
  interface Window {
    artemisFlushWorkspaceEdits?: typeof flushWorkspaceEdits;
  }
}
window.artemisFlushWorkspaceEdits = flushWorkspaceEdits;

export function readLocalDraft(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return undefined;
  }
}
export function writeLocalDraft(key: string, draft: unknown) {
  try {
    if (draft === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* Host autosave still runs when browser storage is unavailable. */
  }
}
