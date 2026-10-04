import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { WorkspaceCsvEditor } from "./WorkspaceCsvEditor.js";
import {
  readLocalDraft,
  registerWorkspaceAutosave,
  writeLocalDraft,
} from "./workspace-autosave.js";
import {
  TextEditHistory,
  useWorkspaceEditHistory,
} from "./workspace-edit-history.js";
import type { HistoryDirection } from "../../shared/workspace-history-shortcut.js";

export class CsvAutosave {
  content: string;
  base: string;
  error: string | undefined;
  busy = false;
  composing = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private listeners = new Set<() => void>();
  private key: string;
  private history = new TextEditHistory();
  constructor(
    readonly threadId: string,
    readonly path: string,
    content: string,
  ) {
    this.key = `artemis-csv-draft:${threadId}:${path}`;
    const draft = readLocalDraft(this.key) as
      { content?: unknown; base?: unknown } | undefined;
    this.base = typeof draft?.base === "string" ? draft.base : content;
    this.content = typeof draft?.content === "string" ? draft.content : content;
    if (this.base !== content)
      this.error =
        "CSV changed outside Artemis. The recovered draft is preserved.";
    registerWorkspaceAutosave(this.key, this);
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private notify() {
    for (const listener of this.listeners) listener();
  }
  change(content: string) {
    this.history.record(
      [{ key: this.path, before: this.content, after: content }],
      this.composing,
    );
    this.write(content);
  }
  breakUndoGroup() {
    this.history.breakGroup();
  }
  setComposing(value: boolean) {
    this.breakUndoGroup();
    this.composing = value;
    if (!value) this.schedule();
  }
  undo() {
    this.stepHistory("undo");
  }
  redo() {
    this.stepHistory("redo");
  }
  private stepHistory(direction: HistoryDirection) {
    if (this.composing) return;
    try {
      const changes = this.history.step(direction, () => this.content);
      if (changes.length) this.write(changes[0]!.after);
    } catch (error) {
      this.error = String(error);
      this.notify();
    }
  }
  private write(content: string) {
    this.content = content;
    this.error = undefined;
    writeLocalDraft(
      this.key,
      content === this.base ? undefined : { base: this.base, content },
    );
    this.notify();
    this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    const save = () => {
      if (!this.composing) void this.flush().catch(() => undefined);
    };
    this.timer = setTimeout(save, 1500);
    this.deadline ??= setTimeout(save, 10_000);
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
    if (this.content === this.base) return;
    this.busy = true;
    this.error = undefined;
    this.notify();
    try {
      while (this.content !== this.base) {
        if (this.composing) throw new Error("Finish text input before saving");
        const sent = this.content;
        await window.artemis.saveWorkspaceCsv(
          this.threadId,
          this.path,
          sent,
          this.base,
        );
        this.base = sent;
        writeLocalDraft(
          this.key,
          this.content === this.base
            ? undefined
            : { content: this.content, base: this.base },
        );
      }
    } catch (error) {
      this.error = String(error);
      throw error;
    } finally {
      this.busy = false;
      this.notify();
    }
  }
}
const editors = new Map<string, CsvAutosave>();
type Props = Omit<
  ComponentProps<typeof WorkspaceCsvEditor>,
  "content" | "dirty" | "onChange" | "onSave" | "saveState" | "saveError"
> & { threadId: string; content: string };
export function WorkspaceCsvFileEditor({ threadId, content, ...props }: Props) {
  const editor = useMemo(() => {
    const key = `${threadId}:${props.path}`;
    let value = editors.get(key);
    if (
      !value ||
      (value.content === value.base && !value.busy && value.base !== content)
    ) {
      value = new CsvAutosave(threadId, props.path, content);
      editors.set(key, value);
    }
    return value;
  }, [threadId, props.path, content]);
  const historyRef = useWorkspaceEditHistory<HTMLDivElement>(editor);
  const [, refresh] = useState(0);
  useEffect(
    () => editor.subscribe(() => refresh((value) => value + 1)),
    [editor],
  );
  return (
    <div
      ref={historyRef}
      tabIndex={-1}
      className="workspace-csv-file-editor"
      onCompositionStart={() => {
        editor.setComposing(true);
      }}
      onCompositionEnd={() => {
        editor.setComposing(false);
      }}
    >
      <WorkspaceCsvEditor
        {...props}
        content={editor.content}
        dirty={editor.content !== editor.base}
        saveState={
          editor.busy
            ? "saving"
            : editor.content === editor.base
              ? "saved"
              : "idle"
        }
        saveError={editor.error}
        onChange={(value) => editor.change(value)}
        onSave={() => {
          void editor.flush().catch(() => undefined);
        }}
      />
    </div>
  );
}
