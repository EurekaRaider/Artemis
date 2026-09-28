// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ArtifactSessionRequest,
  ArtifactSnapshot,
} from "@artemis/protocol";
import { OfficeEditorState } from "../src/renderer/office-editor-state.js";
import { CsvAutosave } from "../src/renderer/WorkspaceCsvFileEditor.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useWorkspaceEditHistory } from "../src/renderer/workspace-edit-history.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  localStorage.clear();
});

function wordFixture(beforeApply?: () => Promise<void>) {
  let snapshot: ArtifactSnapshot = {
    session: {
      protocolVersion: 1,
      documentId: "doc",
      sessionId: "session",
      path: "a.docx",
      format: "word",
      engineVersion: "test",
      version: 0,
      savedVersion: 0,
      sequence: 0,
      previewVersion: null,
      status: "saved",
    },
    targets: [
      {
        selection: { kind: "paragraph", index: 0, start: 0, end: 6 },
        text: "Before",
      },
    ],
    sheets: [],
    warnings: [],
  };
  const edit = vi.fn(
    async (_thread: string, request: ArtifactSessionRequest) => {
      if (
        request.operation === "apply" &&
        request.change.type === "replace-text"
      ) {
        await beforeApply?.();
        const change = request.change;
        const target = snapshot.targets[0]!;
        const text =
          target.text.slice(0, change.start) +
          change.text +
          target.text.slice(change.end);
        snapshot = {
          ...snapshot,
          session: {
            ...snapshot.session,
            version: snapshot.session.version + 1,
            sequence: snapshot.session.sequence + 1,
            status: "editing",
          },
          targets: [
            {
              selection: {
                kind: "paragraph",
                index: 0,
                start: 0,
                end: text.length,
              },
              text,
            },
          ],
        };
      } else if (request.operation === "save") {
        snapshot = {
          ...snapshot,
          session: {
            ...snapshot.session,
            sequence: snapshot.session.sequence + 1,
            savedVersion: snapshot.session.version,
            status: "saved",
          },
        };
      }
      return structuredClone(snapshot);
    },
  );
  stubWindowArtemis({
    readOfficeSnapshot: async () => structuredClone(snapshot),
    editOfficeFile: edit,
  });
  const editor = new OfficeEditorState("history", "session", "a.docx");
  editor.update(snapshot);
  return { editor, edit, snapshot: () => snapshot };
}

describe("document undo and redo", () => {
  it("handles document shortcuts and native undo while leaving comment input alone", () => {
    const editor = {
      composing: false,
      undo: vi.fn(),
      redo: vi.fn(),
      breakUndoGroup: vi.fn(),
    };
    function Surface() {
      const ref = useWorkspaceEditHistory<HTMLElement>(editor);
      return (
        <section ref={ref} tabIndex={-1} aria-label="Document panel">
          <textarea
            className="office-page-edit-input"
            aria-label="Document text"
          />
          <textarea aria-label="Comment" />
        </section>
      );
    }
    render(<Surface />);
    const input = screen.getByLabelText("Document text");
    input.focus();
    fireEvent.keyDown(input, { key: "z", metaKey: true });
    fireEvent.keyDown(input, { key: "Z", metaKey: true, shiftKey: true });
    expect(editor.undo).toHaveBeenCalledOnce();
    expect(editor.redo).toHaveBeenCalledOnce();
    screen.getByLabelText("Document panel").focus();
    expect(window.artemisApplyWorkspaceHistory?.("undo")).toBe(true);
    expect(editor.undo).toHaveBeenCalledTimes(2);
    screen.getByLabelText("Comment").focus();
    expect(window.artemisApplyWorkspaceHistory?.("undo")).toBe(false);
    fireEvent.keyDown(screen.getByLabelText("Comment"), {
      key: "z",
      ctrlKey: true,
    });
    expect(editor.undo).toHaveBeenCalledTimes(2);
  });
  it("undoes and redoes an Office edit after it has been saved", async () => {
    const { editor, snapshot } = wordFixture();
    editor.setText(snapshot().targets[0]!, "After");
    await editor.flush();
    editor.undo();
    await editor.flush();
    expect(snapshot().targets[0]!.text).toBe("Before");
    expect(snapshot().session.savedVersion).toBe(2);
    editor.redo();
    await editor.flush();
    expect(snapshot().targets[0]!.text).toBe("After");
    expect(snapshot().session.savedVersion).toBe(3);
  });

  it("queues undo behind an in-flight native edit without losing it", async () => {
    let finish!: () => void;
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { editor, snapshot, edit } = wordFixture(async () => {
      began();
      await pending;
    });
    editor.setText(snapshot().targets[0]!, "After");
    const saving = editor.flush();
    await started;
    editor.undo();
    finish();
    await saving;
    expect(snapshot().targets[0]!.text).toBe("Before");
    expect(
      edit.mock.calls.filter((call) => call[1].operation === "apply"),
    ).toHaveLength(2);
  });

  it("drops redo when the user makes a different edit", async () => {
    const { editor, snapshot } = wordFixture();
    editor.setText(snapshot().targets[0]!, "After");
    await editor.flush();
    editor.undo();
    editor.setText(editor.snapshot!.targets[0]!, "Different");
    editor.redo();
    expect(editor.value(editor.snapshot!.targets[0]!)).toBe("Different");
    await editor.flush();
    expect(snapshot().targets[0]!.text).toBe("Different");
  });

  it("undoes a multi-cell paste together and restores the original formula", () => {
    const { editor, snapshot } = wordFixture();
    const formula = {
      selection: { kind: "cells" as const, sheet: "Sheet1", range: "A1" },
      text: "6",
      formula: "=2*3",
    };
    const empty = {
      selection: { kind: "cells" as const, sheet: "Sheet1", range: "B1" },
      text: "",
    };
    editor.snapshot = { ...snapshot(), targets: [formula], sheets: ["Sheet1"] };
    editor.setTexts([
      { target: formula, text: "10" },
      { target: empty, text: "pasted" },
    ]);
    editor.undo();
    expect(editor.value(formula)).toBe("=2*3");
    expect(editor.value(empty)).toBe("");
    editor.redo();
    expect(editor.value(formula)).toBe("10");
    expect(editor.value(empty)).toBe("pasted");
  });

  it("does not undo over an external Office change", async () => {
    const { editor, snapshot, edit } = wordFixture();
    editor.setText(snapshot().targets[0]!, "After");
    await editor.flush();
    editor.update({
      ...snapshot(),
      session: {
        ...snapshot().session,
        sequence: snapshot().session.sequence + 1,
      },
      targets: [{ ...snapshot().targets[0]!, text: "Agent edit" }],
    });
    editor.undo();
    expect(editor.value(editor.snapshot!.targets[0]!)).toBe("Agent edit");
    expect(editor.error).toContain("changed");
    expect(edit).toHaveBeenCalledTimes(2);
  });

  it("retains CSV history across saves and uses the current disk baseline", async () => {
    const save = vi.fn().mockResolvedValue({});
    stubWindowArtemis({ saveWorkspaceCsv: save });
    const editor = new CsvAutosave(
      "csv-undo",
      "a.csv",
      "id,name\n001,Before\n",
    );
    editor.change("id,name\n001,After\n");
    await editor.flush();
    editor.undo();
    await editor.flush();
    editor.redo();
    await editor.flush();
    expect(save.mock.calls.map((call) => call.slice(2))).toEqual([
      ["id,name\n001,After\n", "id,name\n001,Before\n"],
      ["id,name\n001,Before\n", "id,name\n001,After\n"],
      ["id,name\n001,After\n", "id,name\n001,Before\n"],
    ]);
  });

  it("treats one IME composition as one undo step without undoing mid-composition", () => {
    const editor = new CsvAutosave("ime-undo", "a.csv", "id,name\n001,\n");
    editor.setComposing(true);
    editor.change("id,name\n001,z\n");
    vi.setSystemTime(Date.now() + 5000);
    editor.change("id,name\n001,中文\n");
    editor.undo();
    expect(editor.content).toContain("中文");
    editor.setComposing(false);
    editor.undo();
    expect(editor.content).toBe("id,name\n001,\n");
  });
});
