import { describe, expect, it } from "vitest";
import {
  addDesignDocumentAttachment,
  buildDesignAnnotationHint,
  buildDesignBindingHint,
  DesignAnnotationDraft,
  readDesignDocument,
  stripDesignAnnotationBlock,
} from "../src/renderer/design-annotations.js";
import type { PromptAttachment } from "@artemis/protocol";

const document = {
  documentId: "doc-1",
  documentName: "customer.html",
  html: '<!doctype html><html><body><button class="primary">保存设置</button></body></html>',
};

const annotation = {
  id: "c1",
  kind: "element",
  label: "button.primary",
  text: "颜色对比不足",
  documentId: "doc-1",
  documentName: "customer.html",
  currentText: "保存设置",
  selector: "div.mock-actions > button.primary",
  x: 312,
  y: 480,
};

describe("design page attachment", () => {
  it("attaches the page as a text/html prompt file", () => {
    const next = addDesignDocumentAttachment([], document)!;
    expect(next).toHaveLength(1);
    expect(readDesignDocument(next[0]!)?.documentName).toBe("customer.html");
  });

  it("replaces an existing copy of the same page instead of stacking", () => {
    const first = addDesignDocumentAttachment([], document)!;
    const updated = addDesignDocumentAttachment(first, {
      ...document,
      html: "<!doctype html><html><body>v2</body></html>",
    })!;
    expect(updated).toHaveLength(1);
    expect(updated[0]!.content).toContain("v2");
  });

  it("keeps unrelated attachments", () => {
    const existing: PromptAttachment[] = [
      { type: "file", name: "notes.txt", mimeType: "text/plain", content: "x" },
    ];
    const next = addDesignDocumentAttachment(existing, document)!;
    expect(next.map((item) => ("name" in item ? item.name : ""))).toEqual([
      "customer.html",
      "notes.txt",
    ]);
  });
});

describe("design annotation hint (message body)", () => {
  it("renders the OD field set inside <attached-preview-comments>", () => {
    const hint = buildDesignAnnotationHint(
      [
        {
          ...annotation,
          w: 88,
          h: 44,
          htmlHint: '<button class="primary">保存设置</button>',
          style: "color:#ffffff; background:#0f172a",
        },
      ],
      document,
    );
    expect(hint).toContain("<attached-preview-comments>");
    expect(hint).toContain('the design document "customer.html"');
    expect(hint).toContain("plugin_apply_edit");
    expect(hint).toContain("file writes are not available");
    // OD 语义：request 区已承载批注文本，块内不重复（无 comment 行）
    expect(hint).not.toContain("comment:");
    expect(hint).not.toContain("颜色对比不足");
    expect(hint).toContain("1. button.primary");
    expect(hint).toContain("targetKind: element");
    expect(hint).toContain("file: customer.html");
    expect(hint).toContain("selector: div.mock-actions > button.primary");
    expect(hint).toContain("position: x312 y480 88x44");
    expect(hint).toContain("currentText: 保存设置");
    expect(hint).toContain(
      'htmlHint: <button class="primary">保存设置</button>',
    );
    expect(hint).toContain("computedStyle: color:#ffffff; background:#0f172a");
  });

  it("truncates long context fields like OD (160/180)", () => {
    const hint = buildDesignAnnotationHint(
      [
        {
          ...annotation,
          currentText: "长".repeat(200),
          htmlHint: "<b>" + "x".repeat(200) + "</b>",
        },
      ],
      document,
    );
    expect(hint).toMatch(/currentText: 长{157}\.\.\./);
    // slice(0,177) = "<b>" + 174 个 x，再补 "..."
    expect(hint).toMatch(/htmlHint: <b>x{174}\.\.\./);
  });

  it("renders visual marks with OD markKind fields and no-screenshot intent", () => {
    const hint = buildDesignAnnotationHint(
      [
        {
          ...annotation,
          kind: "visual",
          markKind: "box",
          label: "方框标记",
          selector: "",
          x: 40,
          y: 60,
          w: 120,
          h: 80,
        },
        {
          ...annotation,
          kind: "visual",
          markKind: "text",
          label: "文字标记",
          selector: "",
          x: 200,
          y: 30,
          w: 90,
          h: 24,
          htmlHint: "这里太挤",
        },
      ],
      document,
    );
    expect(hint).toContain("targetKind: visual");
    expect(hint).toContain("markKind: box");
    expect(hint).toContain("markKind: text");
    expect(hint).toContain("position: x40 y60 120x80");
    expect(hint).toContain("text: 这里太挤");
    expect(hint).toContain("no screenshot was captured");
  });

  it("builds the composer binding hint and strips it for display", () => {
    const hint = buildDesignBindingHint({
      documentId: "doc-1",
      name: "customer.html",
    });
    expect(hint).toContain("<design-context>");
    expect(hint).toContain("customer.html");
    expect(hint).toContain("doc-1");
    expect(buildDesignBindingHint({ documentId: null })).toBe("");
    const stored = `换个标题${hint}`;
    expect(stripDesignAnnotationBlock(stored)).toBe("换个标题");
  });

  it("returns empty for empty annotations", () => {
    expect(buildDesignAnnotationHint([], document)).toBe("");
    expect(buildDesignAnnotationHint([{ ...annotation, text: "  " }])).toBe("");
  });

  it("strips the structured block for timeline display", () => {
    const hint = buildDesignAnnotationHint([annotation], document);
    const stored = `把「保存设置」改成「提交」${hint}`;
    expect(stripDesignAnnotationBlock(stored)).toBe(
      "把「保存设置」改成「提交」",
    );
    expect(stripDesignAnnotationBlock("普通消息")).toBe("普通消息");
  });

  it("draft accumulates, dedupes by id, and consumes on send", () => {
    const draft = new DesignAnnotationDraft();
    draft.add([annotation], document);
    draft.add([{ ...annotation, id: "c1", text: "更新后的意见" }]);
    draft.add([{ ...annotation, id: "c2", text: "第二条" }]);
    expect(draft.size).toBe(2);
    const { hint, document: doc } = draft.takeForSend();
    // 新语义：批注文本不再进块（request 区承载）；块内条目数证去重
    expect(hint).not.toContain("更新后的意见");
    expect(hint).toContain("1. button.primary");
    expect(hint).toContain("2. button.primary");
    expect(doc?.documentName).toBe("customer.html");
    expect(draft.size).toBe(0);
    expect(draft.takeForSend().hint).toBe("");
  });
});
