import {
  artifactSelectionSchema,
  type ArtifactOperation,
  type ArtifactSnapshot,
} from "@artemis/protocol";
import {
  readLocalDraft,
  registerWorkspaceAutosave,
  writeLocalDraft,
} from "./workspace-autosave.js";
import { TextEditHistory } from "./workspace-edit-history.js";
import type { HistoryDirection } from "../shared/workspace-history-shortcut.js";

type Target = ArtifactSnapshot["targets"][number];
type Draft = { target: Target; text: string };
export function officeTargetKey(target: Target) {
  const selection = target.selection;
  return JSON.stringify(
    selection.kind === "paragraph"
      ? { kind: selection.kind, index: selection.index }
      : selection,
  );
}
export function textOperation(target: Target, text: string): ArtifactOperation {
  const s = target.selection;
  if (s.kind === "paragraph") {
    // Replace only the changed run, preserving surrounding native formatting.
    let start = 0,
      end = target.text.length,
      tail = text.length;
    while (start < end && start < tail && target.text[start] === text[start])
      start++;
    while (
      end > start &&
      tail > start &&
      target.text[end - 1] === text[tail - 1]
    ) {
      end--;
      tail--;
    }
    return {
      type: "replace-text",
      paragraph: s.index,
      start,
      end,
      text: text.slice(start, tail),
    };
  }
  if (s.kind === "object")
    return {
      type: "set-object-text",
      page: s.page,
      object: s.index,
      ...(s.path ? { path: s.path } : {}),
      ...(s.cell ? { cell: s.cell } : {}),
      text,
    };
  if (s.kind !== "cells") throw new Error("This selection cannot be edited");
  const match = /^([A-Z]+)(\d+)$/u.exec(s.range);
  if (!match) throw new Error("Select one cell to edit");
  const row = Number(match[2]);
  const column = [...match[1]!].reduce(
    (value, letter) => value * 26 + letter.charCodeAt(0) - 64,
    0,
  );
  if (text.startsWith("="))
    return { type: "set-formula", sheet: s.sheet, row, column, formula: text };
  const numeric =
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/iu.test(text) &&
    Number.isFinite(Number(text));
  return {
    type: "set-cells",
    sheet: s.sheet,
    row,
    column,
    values: [[numeric ? Number(text) : text]],
  };
}

export class OfficeEditorState {
  snapshot: ArtifactSnapshot | undefined;
  drafts = new Map<string, Draft>();
  error: string | undefined;
  busy = false;
  composing = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private listeners = new Set<() => void>();
  private storageKey: string;
  private history = new TextEditHistory();
  private historyTargets = new Map<string, Target>();
  constructor(
    readonly threadId: string,
    readonly sessionId: string,
    readonly path: string,
  ) {
    this.storageKey = `artemis-office-draft:${threadId}:${sessionId}`;
    const saved = readLocalDraft(this.storageKey);
    if (Array.isArray(saved))
      for (const draft of saved.slice(0, 2000)) {
        if (
          typeof draft?.text === "string" &&
          typeof draft?.target?.text === "string" &&
          artifactSelectionSchema.safeParse(draft.target.selection).success
        )
          this.drafts.set(officeTargetKey(draft.target), draft);
      }
    registerWorkspaceAutosave(this.storageKey, this);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private notify() {
    for (const listener of this.listeners) listener();
  }
  update(snapshot: ArtifactSnapshot) {
    if (
      !this.snapshot ||
      snapshot.session.sequence > this.snapshot.session.sequence
    ) {
      this.snapshot = snapshot;
      this.notify();
    }
  }
  value(target: Target) {
    return (
      this.drafts.get(officeTargetKey(target))?.text ??
      target.formula ??
      target.text
    );
  }
  setComposing(value: boolean) {
    this.breakUndoGroup();
    this.composing = value;
    if (!value) this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    const flush = () => {
      if (!this.composing) void this.flush().catch(() => undefined);
    };
    this.timer = setTimeout(flush, 1000);
    this.deadline ??= setTimeout(flush, 10_000);
  }
  setText(target: Target, text: string) {
    this.setTexts([{ target, text }]);
  }
  setTexts(changes: Draft[]) {
    this.history.record(
      changes.map(({ target, text }) => ({
        key: officeTargetKey(target),
        before: this.value(target),
        after: text,
      })),
      this.composing,
    );
    this.writeTexts(changes);
  }
  breakUndoGroup() {
    this.history.breakGroup();
  }
  undo() {
    this.stepHistory("undo");
  }
  redo() {
    this.stepHistory("redo");
  }
  private stepHistory(direction: HistoryDirection) {
    if (this.composing) return;
    const targetFor = (key: string) => {
      const target = this.snapshot?.targets.find(
        (value) => officeTargetKey(value) === key,
      );
      const previous = this.historyTargets.get(key);
      return (
        target ??
        (previous?.selection.kind === "cells"
          ? { selection: previous.selection, text: "" }
          : undefined)
      );
    };
    try {
      const changes = this.history.step(direction, (key) => {
        const target = targetFor(key);
        return target && target.editable !== false
          ? this.value(target)
          : undefined;
      });
      if (changes.length)
        this.writeTexts(
          changes.map(({ key, after }) => ({
            target: targetFor(key)!,
            text: after,
          })),
        );
    } catch (error) {
      this.error = String(error);
      this.notify();
    }
  }
  private writeTexts(changes: Draft[]) {
    for (const { target, text } of changes) {
      const key = officeTargetKey(target);
      const base = this.drafts.get(key)?.target ?? target;
      this.historyTargets.set(key, target);
      this.drafts.set(key, { target: base, text });
    }
    this.error = undefined;
    writeLocalDraft(this.storageKey, [...this.drafts.values()]);
    this.notify();
    this.schedule();
  }
  flush = (): Promise<void> => {
    if (this.composing)
      return Promise.reject(new Error("Finish text input before saving"));
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    this.deadline = undefined;
    if (this.running) return this.running;
    this.running = this.save().finally(() => {
      this.running = undefined;
    });
    return this.running;
  };
  private async save() {
    if (
      !this.drafts.size &&
      (!this.snapshot ||
        this.snapshot.session.savedVersion === this.snapshot.session.version)
    )
      return;
    this.busy = true;
    this.error = undefined;
    this.notify();
    try {
      do {
        while (this.drafts.size) {
          if (this.composing)
            throw new Error("Finish text input before saving");
          const [key, draft] = this.drafts.entries().next().value!;
          const current = await window.artemis.readOfficeSnapshot(
            this.threadId,
            this.sessionId,
          );
          const target =
            current.targets.find((value) => officeTargetKey(value) === key) ??
            (draft.target.selection.kind === "cells"
              ? { selection: draft.target.selection, text: "" }
              : undefined);
          const alreadyApplied =
            target && (target.formula ?? target.text) === draft.text;
          if (
            !target ||
            target.editable === false ||
            (!alreadyApplied &&
              (target.text !== draft.target.text ||
                target.formula !== draft.target.formula))
          )
            throw new Error(
              "Content changed while you were editing. Your draft is retained; reopen or copy your text before resolving the conflict.",
            );
          const next = alreadyApplied
            ? current
            : await window.artemis.editOfficeFile(this.threadId, {
                protocolVersion: 2,
                requestId: crypto.randomUUID(),
                operationId: crypto.randomUUID(),
                operation: "apply",
                sessionId: this.sessionId,
                path: current.session.path,
                format: current.session.format,
                expectedVersion: current.session.version,
                change: textOperation(target, draft.text),
              });
          const pending = this.drafts.get(key);
          if (pending === draft) this.drafts.delete(key);
          else if (pending)
            pending.target = next.targets.find(
              (value) => officeTargetKey(value) === key,
            ) ?? { ...target, text: draft.text };
          this.snapshot = next;
          writeLocalDraft(
            this.storageKey,
            this.drafts.size ? [...this.drafts.values()] : undefined,
          );
          this.notify();
        }
        const current = await window.artemis.readOfficeSnapshot(
          this.threadId,
          this.sessionId,
        );
        this.snapshot = await window.artemis.editOfficeFile(this.threadId, {
          protocolVersion: 2,
          requestId: crypto.randomUUID(),
          operation: "save",
          sessionId: this.sessionId,
          path: current.session.path,
          format: current.session.format,
          expectedVersion: current.session.version,
        });
        // Input may arrive while the native engine exports the previous version.
      } while (this.drafts.size);
    } catch (error) {
      this.error = String(error);
      throw error;
    } finally {
      this.busy = false;
      this.notify();
    }
  }
}
const editors = new Map<string, OfficeEditorState>();
export function officeEditor(
  threadId: string,
  sessionId: string,
  path: string,
) {
  const key = `${threadId}:${sessionId}`;
  let editor = editors.get(key);
  if (!editor) {
    editor = new OfficeEditorState(threadId, sessionId, path);
    editors.set(key, editor);
  }
  return editor;
}
