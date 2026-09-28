// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ArtifactSnapshot,
  ArtifactSessionRequest,
} from "@artemis/protocol";
import {
  OfficeEditorState,
  textOperation,
} from "../src/renderer/office-editor-state.js";
import { CsvAutosave } from "../src/renderer/WorkspaceCsvFileEditor.js";
import { replaceWorkspaceCsvCell } from "../src/renderer/workspace-csv.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

import {
  flushWorkspaceEdits,
  retainWorkspaceDrafts,
} from "../src/renderer/workspace-autosave.js";
afterEach(() => localStorage.clear());
describe("local editor autosave", () => {
  it("splices a CSV field without losing unseen rows, quotes, identifiers or CRLF", () => {
    const original =
      '\uFEFFid,note\r\n001,"a,b"\r\n002,"line1\nline2"\r\n' +
      "003,unchanged\r\n".repeat(250);
    expect(replaceWorkspaceCsvCell(original, 1, 1, 'new "quote", value')).toBe(
      original.replace('"a,b"', '"new ""quote"", value"'),
    );
  });
  it("retains newer CSV input while an older save is in flight", async () => {
    let finish!: () => void;
    const first = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const save = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({});
    stubWindowArtemis({ saveWorkspaceCsv: save });
    const editor = new CsvAutosave("csv-race", "data.csv", "001,old");
    editor.change("001,first");
    const pending = editor.flush();
    editor.change("001,newest");
    finish();
    await pending;
    await editor.flush();
    expect(save.mock.calls.map((call) => call.slice(2))).toEqual([
      ["001,first", "001,old"],
      ["001,newest", "001,first"],
    ]);
    expect(editor.content).toBe("001,newest");
    expect(editor.base).toBe(editor.content);
  });
  it("keeps a CSV draft and the expected disk baseline after a failed save", async () => {
    stubWindowArtemis({
      saveWorkspaceCsv: vi.fn().mockRejectedValue(new Error("External edit")),
    });
    const editor = new CsvAutosave("csv-conflict", "data.csv", "old");
    editor.change("draft");
    await expect(editor.flush()).rejects.toThrow("External edit");
    const restored = new CsvAutosave("csv-conflict", "data.csv", "external");
    expect(restored.content).toBe("draft");
    expect(restored.base).toBe("old");
    expect(restored.error).toContain("changed outside");
  });
  it("serializes Office edits, saves the acknowledged version and preserves unchanged text runs", async () => {
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
          selection: { kind: "paragraph", index: 0, start: 0, end: 11 },
          text: "Hello world",
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
          const change = request.change;
          snapshot = {
            ...snapshot,
            session: {
              ...snapshot.session,
              version: 1,
              sequence: 1,
              status: "editing",
            },
            targets: [{ ...snapshot.targets[0]!, text: "Hello there" }],
          };
          expect(change).toEqual({
            type: "replace-text",
            paragraph: 0,
            start: 6,
            end: 11,
            text: "there",
          });
        } else if (request.operation === "save") {
          expect(request.expectedVersion).toBe(1);
          snapshot = {
            ...snapshot,
            session: {
              ...snapshot.session,
              savedVersion: 1,
              sequence: 2,
              status: "saved",
              savePath: "a.copy.docx",
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
    const editor = new OfficeEditorState("office-test", "session", "a.docx");
    editor.update(snapshot);
    editor.setText(snapshot.targets[0]!, "Hello there");
    await editor.flush();
    expect(editor.snapshot?.session.savePath).toBe("a.copy.docx");
    expect(editor.drafts.size).toBe(0);
    expect(edit).toHaveBeenCalledTimes(2);
  });
  it("refuses to overwrite an Office target changed by the agent", async () => {
    const editor = new OfficeEditorState("conflict", "session", "a.docx");
    const target = {
      selection: { kind: "paragraph" as const, index: 0, start: 0, end: 3 },
      text: "old",
    };
    const edit = vi.fn();
    stubWindowArtemis({
      readOfficeSnapshot: async () => ({
        targets: [{ ...target, text: "agent" }],
      }),
      editOfficeFile: edit,
    });
    editor.setText(target, "manual");
    await expect(editor.flush()).rejects.toThrow("Content changed");
    expect(editor.value(target)).toBe("manual");
    expect(edit).not.toHaveBeenCalled();
  });
  it("keeps leading zeros and interprets explicit spreadsheet formulas", () => {
    const target = {
      selection: { kind: "cells" as const, sheet: "Sheet1", range: "AA51" },
      text: "",
    };
    expect(textOperation(target, "001")).toMatchObject({
      type: "set-cells",
      row: 51,
      column: 27,
      values: [["001"]],
    });
    expect(textOperation(target, "=SUM(A1:A3)")).toMatchObject({
      type: "set-formula",
      formula: "=SUM(A1:A3)",
    });
  });
  it("flushes input arriving during an Office export before permitting close", async () => {
    let finish!: () => void;
    let exported!: () => void;
    const started = new Promise<void>((resolve) => {
      exported = resolve;
    });
    const exporting = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let snapshot: ArtifactSnapshot = {
      session: {
        protocolVersion: 1,
        documentId: "race",
        sessionId: "race",
        path: "race.docx",
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
          selection: { kind: "paragraph", index: 0, start: 0, end: 3 },
          text: "old",
        },
      ],
      sheets: [],
      warnings: [],
    };
    const edit = vi.fn(async (_: string, request: ArtifactSessionRequest) => {
      if (
        request.operation === "apply" &&
        request.change.type === "replace-text"
      ) {
        const change = request.change;
        const text = snapshot.targets[0]!.text;
        snapshot = {
          ...snapshot,
          targets: [
            {
              ...snapshot.targets[0]!,
              text:
                text.slice(0, change.start) +
                change.text +
                text.slice(change.end),
            },
          ],
          session: {
            ...snapshot.session,
            version: snapshot.session.version + 1,
            sequence: snapshot.session.sequence + 1,
            status: "editing",
          },
        };
      } else if (request.operation === "save") {
        if (snapshot.session.version === 1) {
          exported();
          await exporting;
        }
        snapshot = {
          ...snapshot,
          session: {
            ...snapshot.session,
            savedVersion: snapshot.session.version,
            sequence: snapshot.session.sequence + 1,
            status: "saved",
          },
        };
      }
      return structuredClone(snapshot);
    });
    stubWindowArtemis({
      readOfficeSnapshot: async () => structuredClone(snapshot),
      editOfficeFile: edit,
    });
    const editor = new OfficeEditorState("late-input", "race", "race.docx");
    editor.update(snapshot);
    editor.setText(snapshot.targets[0]!, "first");
    const closing = editor.flush();
    await started;
    editor.setText(snapshot.targets[0]!, "latest");
    finish();
    await closing;
    expect(snapshot.targets[0]?.text).toBe("latest");
    expect(snapshot.session.savedVersion).toBe(2);
    expect(editor.drafts.size).toBe(0);
  });
  it("does not save an unfinished IME composition and clears reverted CSV drafts", async () => {
    const save = vi.fn().mockResolvedValue({});
    stubWindowArtemis({ saveWorkspaceCsv: save });
    const editor = new CsvAutosave("ime", "data.csv", "old");
    editor.composing = true;
    editor.change("拼");
    await expect(editor.flush()).rejects.toThrow("Finish text input");
    expect(save).not.toHaveBeenCalled();
    editor.composing = false;
    editor.change("old");
    await editor.flush();
    expect(localStorage.getItem("artemis-csv-draft:ime:data.csv")).toBeNull();
  });
});

it("retains a failed Office draft before closing and resumes its save gate on reopen", async () => {
  const editor = new OfficeEditorState("retain-close", "session", "draft.docx");
  stubWindowArtemis({
    readOfficeSnapshot: vi
      .fn()
      .mockRejectedValue(new Error("Session unavailable")),
  });
  editor.setText(
    {
      selection: { kind: "paragraph", index: 0, start: 0, end: 3 },
      text: "old",
    },
    "my draft",
  );
  await expect(
    flushWorkspaceEdits("retain-close", "draft.docx"),
  ).rejects.toThrow("Session unavailable");
  retainWorkspaceDrafts("retain-close", "draft.docx");
  expect(
    localStorage.getItem("artemis-office-draft:retain-close:session"),
  ).toContain("my draft");
  await expect(
    flushWorkspaceEdits("retain-close", "draft.docx"),
  ).resolves.toBeUndefined();
  editor.resumeAutosave();
  await expect(
    flushWorkspaceEdits("retain-close", "draft.docx"),
  ).rejects.toThrow("Session unavailable");
  retainWorkspaceDrafts("retain-close", "draft.docx");
});

it("keeps the save gate when draft retention fails", async () => {
  const editor = new OfficeEditorState(
    "retain-failure",
    "session",
    "draft.docx",
  );
  stubWindowArtemis({
    readOfficeSnapshot: vi
      .fn()
      .mockRejectedValue(new Error("Session unavailable")),
  });
  editor.setText(
    {
      selection: { kind: "paragraph", index: 0, start: 0, end: 3 },
      text: "old",
    },
    "draft",
  );
  await expect(editor.flush()).rejects.toThrow();
  const storage = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("Storage full");
    });
  expect(() => retainWorkspaceDrafts("retain-failure", "draft.docx")).toThrow(
    "Storage full",
  );
  await expect(
    flushWorkspaceEdits("retain-failure", "draft.docx"),
  ).rejects.toThrow("Session unavailable");
  storage.mockRestore();
  retainWorkspaceDrafts("retain-failure", "draft.docx");
});
