import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ArtifactAnnotation, PromptAttachment } from "@artemis/protocol";
import { AttachmentStore } from "../src/main/attachment-store.js";
import {
  addOfficeAnnotation,
  changeOfficeAnnotation,
  officeAnnotationAttachment,
  officeSelectionLabel,
  readOfficeAnnotations,
  restoreOfficeAnnotationAttachment,
} from "../src/renderer/office-annotations.js";
import {
  clearComposerDraft,
  composerDraftFor,
  moveComposerDraft,
  restoreComposerQueueItems,
} from "../src/renderer/composer-drafts.js";

const annotation: ArtifactAnnotation = {
  protocolVersion: 1,
  id: "comment-1",
  documentId: "document",
  sessionId: "session",
  sourceVersion: 4,
  selection: {
    kind: "region",
    page: 2,
    x: 0.1,
    y: 0.4,
    width: 0.7,
    height: 0.2,
  },
  text: "单价是多少？",
};
describe("Office annotation transport", () => {
  it("retains every selection and version while using one attachment per file", () => {
    let attachments: PromptAttachment[] = [];
    for (let index = 0; index < 12; index++)
      attachments = addOfficeAnnotation(attachments, "报价.docx", {
        ...annotation,
        id: String(index),
      })!;
    attachments = addOfficeAnnotation(attachments, "预算.xlsx", {
      ...annotation,
      selection: { kind: "cells", sheet: "Budget", range: "D5:D8" },
    })!;
    expect(attachments).toHaveLength(2);
    expect(readOfficeAnnotations(attachments[0]!)!.annotations).toHaveLength(
      12,
    );
    expect(readOfficeAnnotations(attachments[0]!)!.annotations[0]).toEqual({
      ...annotation,
      id: "0",
    });
    expect(
      officeSelectionLabel(
        {
          kind: "object",
          page: 3,
          index: 1,
          path: [2],
          cell: { row: 0, column: 2 },
        },
        "en",
      ),
    ).toBe("Page 3 · Object 2.3 · R1C3");
  });
  it("edits and removes a single comment without touching sibling comments or files", () => {
    const one = addOfficeAnnotation([], "报价.docx", annotation)!;
    const two = addOfficeAnnotation(one, "报价.docx", {
      ...annotation,
      id: "comment-2",
      text: "另一条批注",
    })!;
    const next = changeOfficeAnnotation(two, 0, "comment-1", "修改后的问题")!;
    expect(readOfficeAnnotations(next[0]!)!.annotations).toEqual([
      { ...annotation, text: "修改后的问题" },
      { ...annotation, id: "comment-2", text: "另一条批注" },
    ]);
    expect(readOfficeAnnotations(two[0]!)!.annotations[0]).toEqual(annotation);
    expect(changeOfficeAnnotation(two, 0, "comment-1", " ")).toBeUndefined();
    const remaining = changeOfficeAnnotation(next, 0, "comment-1", undefined)!;
    expect(readOfficeAnnotations(remaining[0]!)!.annotations).toHaveLength(1);
    expect(
      changeOfficeAnnotation(remaining, 0, "comment-2", undefined),
    ).toEqual([]);
  });
  it("preserves cards and ordinary text when moving or restoring a conversation draft", () => {
    const attachments = addOfficeAnnotation([], "报价.docx", annotation)!;
    const drafts = {
      "new:": { prompt: "补充说明", attachments, selectedSkillNames: [] },
    };
    const moved = moveComposerDraft(drafts, "new:", "thread:a");
    expect(composerDraftFor(moved, "thread:a")).toEqual(drafts["new:"]);
    expect(composerDraftFor(moved, "thread:b").attachments).toEqual([]);
    const cleared = clearComposerDraft(moved, "thread:a");
    const restored = restoreComposerQueueItems(cleared, "thread:a", [
      { text: "补充说明", attachments },
    ]);
    expect(composerDraftFor(restored, "thread:a")).toEqual(drafts["new:"]);
    expect(composerDraftFor(restored, "thread:a").prompt).not.toContain(
      "protocolVersion",
    );
  });
  it("round-trips bound queue references through the real attachment store including pagination", async () => {
    const root = await mkdtemp(join(tmpdir(), "office-comments-"));
    try {
      const original = officeAnnotationAttachment({
        protocolVersion: 1,
        path: "报价.docx",
        annotations: [
          annotation,
          { ...annotation, id: "long", text: "待核对的内容".repeat(1000) },
        ],
      });
      const store = new AttachmentStore(root);
      const [ref] = await store.bind("thread-a", [original]);
      let pages = 0;
      const restored = await restoreOfficeAnnotationAttachment(
        ref!,
        async (offset) => {
          pages++;
          return store.previewFile(ref!.id, offset, "thread-a");
        },
      );
      expect(pages).toBeGreaterThan(1);
      expect(restored).toEqual(original);
      const modelRead = await store.operate("thread-a", {
        action: "read",
        id: ref!.id,
      });
      expect(JSON.stringify(modelRead)).toContain("sourceVersion");
      expect(JSON.stringify(modelRead)).toContain("单价是多少");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("rejects over-limit additions without changing the existing draft", () => {
    const files: PromptAttachment[] = Array.from({ length: 10 }, (_, i) => ({
      type: "file",
      name: `${i}.txt`,
      mimeType: "text/plain",
      content: "",
    }));
    expect(addOfficeAnnotation(files, "报价.docx", annotation)).toBeUndefined();
    expect(files).toHaveLength(10);
    expect(
      readOfficeAnnotations({
        type: "file",
        name: "bad.docx",
        mimeType: "application/vnd.artemis.office-annotations+json",
        content: "{}",
      }),
    ).toBeUndefined();
  });
});
