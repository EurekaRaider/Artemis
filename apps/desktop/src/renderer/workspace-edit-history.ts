import { useEffect, useRef } from "react";
import {
  workspaceHistoryShortcut,
  type HistoryDirection,
} from "../shared/workspace-history-shortcut.js";

type TextChange = { key: string; before: string; after: string };

/** User edits have their own history; exporting a version never clears it. */
export class TextEditHistory {
  private past: TextChange[][] = [];
  private future: TextChange[][] = [];
  private lastInput: number | undefined;

  breakGroup() {
    this.lastInput = undefined;
  }

  record(changes: TextChange[], composing = false) {
    changes = changes.filter((change) => change.before !== change.after);
    if (!changes.length) return;
    const previous = this.past.at(-1);
    const now = Date.now();
    if (
      this.lastInput !== undefined &&
      (composing || now - this.lastInput < 1000) &&
      changes.length === 1 &&
      previous?.length === 1 &&
      previous[0]!.key === changes[0]!.key &&
      previous[0]!.after === changes[0]!.before
    ) {
      previous[0]!.after = changes[0]!.after;
      if (previous[0]!.before === previous[0]!.after) this.past.pop();
    } else this.past.push(changes);
    this.future = [];
    this.lastInput = changes.length === 1 ? now : undefined;
    // Bound both the number of steps and memory used by large CSV documents.
    let characters = this.past.reduce(
      (total, step) => total + this.size(step),
      0,
    );
    while (
      this.past.length > 1 &&
      (this.past.length > 100 || characters > 4_000_000)
    )
      characters -= this.size(this.past.shift()!);
  }

  private size(step: TextChange[]) {
    return step.reduce(
      (total, change) => total + change.before.length + change.after.length,
      0,
    );
  }

  step(direction: HistoryDirection, read: (key: string) => string | undefined) {
    this.breakGroup();
    const from = direction === "undo" ? this.past : this.future;
    const to = direction === "undo" ? this.future : this.past;
    const step = from.at(-1);
    if (!step) return [];
    const changes = step.map((change) =>
      direction === "undo"
        ? { ...change, before: change.after, after: change.before }
        : change,
    );
    if (changes.some((change) => read(change.key) !== change.before))
      throw new Error(
        "Content changed outside this edit. Undo/redo cannot overwrite it.",
      );
    from.pop();
    to.push(step);
    return changes;
  }
}

type HistoryEditor = {
  composing: boolean;
  undo(): void;
  redo(): void;
  breakUndoGroup(): void;
};

declare global {
  interface Window {
    artemisApplyWorkspaceHistory?: (direction: HistoryDirection) => boolean;
  }
}
if (typeof window !== "undefined")
  window.artemisApplyWorkspaceHistory = (direction) => {
    const target = document.activeElement;
    if (!(target instanceof HTMLElement)) return false;
    return !target.dispatchEvent(
      new CustomEvent("artemis-workspace-history", {
        bubbles: true,
        cancelable: true,
        detail: direction,
      }),
    );
  };

export function useWorkspaceEditHistory<T extends HTMLElement>(
  editor: HistoryEditor,
) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const apply = (event: Event, direction: HistoryDirection) => {
      if (editor.composing || !(event.target instanceof HTMLElement)) return;
      const field = event.target.closest(
        "input,textarea,[contenteditable=true]",
      );
      // Comments and other controls retain their ordinary native text history.
      if (
        field &&
        !field.matches(
          ".office-page-edit-input,.office-sheet-grid input,.workspace-csv-file-editor textarea",
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      editor[direction]();
    };
    const key = (event: KeyboardEvent) => {
      const direction = workspaceHistoryShortcut(event);
      if (!event.defaultPrevented && !event.isComposing && direction)
        apply(event, direction);
    };
    const native = (event: Event) => {
      const direction = (event as CustomEvent).detail;
      if (direction === "undo" || direction === "redo") apply(event, direction);
    };
    const input = (event: Event) => {
      const type = (event as InputEvent).inputType;
      if (type === "historyUndo" || type === "historyRedo")
        apply(event, type === "historyUndo" ? "undo" : "redo");
    };
    const endGroup = () => {
      if (!editor.composing) editor.breakUndoGroup();
    };
    root.addEventListener("keydown", key);
    root.addEventListener("artemis-workspace-history", native);
    root.addEventListener("beforeinput", input);
    root.addEventListener("focusin", endGroup);
    root.addEventListener("focusout", endGroup);
    root.addEventListener("pointerdown", endGroup);
    return () => {
      root.removeEventListener("keydown", key);
      root.removeEventListener("artemis-workspace-history", native);
      root.removeEventListener("beforeinput", input);
      root.removeEventListener("focusin", endGroup);
      root.removeEventListener("focusout", endGroup);
      root.removeEventListener("pointerdown", endGroup);
    };
  }, [editor]);
  return ref;
}
