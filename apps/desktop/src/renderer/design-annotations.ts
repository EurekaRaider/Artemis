// Word 插件式附件化（对照 open-design）：要操作的页面作为附件
// （text/html，随 prompt 内联），批注渲染成消息体里的结构化提示块
// （OD 的 <attached-preview-comments> 等价物），发送时拼进 outgoing text。
import type { PromptAttachment, PromptFile } from "@artemis/protocol";

/** Loose wire shape (panel → host → renderer); re-validated on use. */
export type DesignAnnotationInput = {
  id?: string;
  kind?: string;
  /** Visual mark subtype (OD markKind): stroke / box / text. */
  markKind?: string;
  label?: string;
  text?: string;
  documentId?: string | null;
  documentName?: string | null;
  currentText?: string;
  selector?: string;
  x?: number | null;
  y?: number | null;
  /** Element box in stage coordinates (OD position 的宽高部分). */
  w?: number | null;
  h?: number | null;
  /** outerHTML snippet captured at pick time (panel 截到 500 字符). */
  htmlHint?: string;
  /** Key computed styles captured at pick time (panel 截到 400 字符). */
  style?: string;
};

export type DesignDocumentPayload = {
  documentId: string;
  documentName: string;
  html: string;
};

const MAX_DOCUMENT_HTML_BYTES = 512 * 1024;

/**
 * The annotated page as a prompt file attachment (deduped by document name:
 * repeated candidates merge into one up-to-date page copy).
 */
export function designDocumentAttachment(
  document: DesignDocumentPayload,
): PromptFile {
  return {
    type: "file",
    name: document.documentName || `${document.documentId}.html`,
    mimeType: "text/html",
    content: document.html,
  };
}

export function readDesignDocument(
  attachment: PromptAttachment,
): DesignDocumentPayload | undefined {
  if (
    !("type" in attachment) ||
    attachment.type !== "file" ||
    attachment.mimeType !== "text/html"
  ) {
    return undefined;
  }
  return {
    documentId: "",
    documentName: attachment.name,
    html: attachment.content,
  };
}

/**
 * Add/replace the annotated page in the composer attachments. Returns
 * undefined when a slot limit would be exceeded (caller toasts).
 */
export function addDesignDocumentAttachment(
  attachments: readonly PromptAttachment[],
  document: DesignDocumentPayload,
): PromptAttachment[] | undefined {
  if (!document.html.trim()) return [...attachments];
  const name = document.documentName || `${document.documentId}.html`;
  const index = attachments.findIndex(
    (item) =>
      "type" in item &&
      item.type === "file" &&
      item.mimeType === "text/html" &&
      item.name === name,
  );
  const attachment = designDocumentAttachment(document);
  if (index >= 0) {
    const next = [...attachments];
    next[index] = attachment;
    return next;
  }
  return [attachment, ...attachments];
}

/**
 * OD 渲染器的单行压缩截断（comments.ts trimContextText/trimHtmlHint 同款
 * 预算：currentText 160、htmlHint 180；超长以 ... 收尾）。
 */
function trimOneLine(value: string | undefined | null, max: number): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** selector 末段即 OD 意义上的 elementId（div.page > button.primary → button.primary）。 */
function elementIdOf(annotation: DesignAnnotationInput): string {
  const selector = String(annotation.selector ?? "").trim();
  if (selector) {
    const last = selector.split(">").at(-1)?.trim();
    if (last) return last;
  }
  return annotation.label || "(unlabeled)";
}

/**
 * OD-style structured hint appended to the outgoing message body at send
 * time (the composer textarea keeps only the user's own words).
 *
 * 对齐 open-design 的 renderCommentAttachmentHint：request 区放批注原文
 * （无前缀包装），本块只承载定位信息；query 语义下 comment 字段不再在
 * 块内重复。字段顺序与 OD 相同：elementId → targetKind → file → label →
 * selector → position → currentText → htmlHint → computedStyle。
 * 与 OD 的两处有意差异：工具约束句（受限线程只能走 plugin_* 工具）与
 * 页面附件说明（agent 没有文件工具）保留。
 */
export function buildDesignAnnotationHint(
  annotations: readonly DesignAnnotationInput[],
  document?: DesignDocumentPayload,
): string {
  const usable = annotations.filter(
    (item) =>
      item.kind === "visual" ||
      (typeof item.text === "string" && item.text.trim().length > 0),
  );
  if (usable.length === 0) return "";
  const documentName = document?.documentName || usable[0]?.documentName || "";
  const lines = [
    "",
    "",
    "<attached-preview-comments>",
    `Hard scope: change ONLY the elements identified below by selector / position. Do NOT modify sibling sub-pages, parent layout, global CSS, design tokens, or unrelated rules even if you notice issues there — surface those as a follow-up note in your reply instead of editing them. If the user's request cannot be satisfied without touching outside this scope, ask the user before proceeding.` +
      (documentName
        ? ` Apply the changes to the design document "${documentName}" through the design plugin tools (plugin_apply_edit / plugin_create_document) with that document's documentId — file writes are not available in this task; the full current page is attached below.`
        : " Apply the changes through the design plugin tools (plugin_apply_edit / plugin_create_document) — file writes are not available in this task; the full current page is attached below."),
  ];
  usable.slice(0, 20).forEach((item, index) => {
    // visual 标记（画笔/方框/文字）：OD 的 targetKind visual 段——
    // 无截图 fallback=按 file+position 定位（OD #4084 同款 intent）。
    if (item.kind === "visual") {
      const markKind =
        item.markKind === "box"
          ? "box"
          : item.markKind === "text"
            ? "text"
            : "stroke";
      lines.push(
        "",
        `${index + 1}. ${item.label || "visual mark"}`,
        "targetKind: visual",
        `markKind: ${markKind}`,
        `file: ${item.documentName || documentName || "(unknown)"}`,
      );
      if (typeof item.x === "number" && typeof item.y === "number") {
        const size =
          typeof item.w === "number" && typeof item.h === "number"
            ? ` ${item.w}x${item.h}`
            : "";
        lines.push(`position: x${item.x} y${item.y}${size}`);
      }
      const markText = trimOneLine(item.htmlHint, 180);
      if (markText) lines.push(`text: ${markText}`);
      lines.push(
        "intent: The user marked a region of the live preview; no screenshot was captured, so locate the region using file and position.",
      );
      return;
    }
    lines.push(
      "",
      `${index + 1}. ${elementIdOf(item)}`,
      `targetKind: ${item.kind === "free" ? "free" : "element"}`,
      `file: ${item.documentName || documentName || "(unknown)"}`,
      `label: ${item.label || "(unlabeled)"}`,
    );
    if (item.selector) lines.push(`selector: ${item.selector}`);
    if (typeof item.x === "number" && typeof item.y === "number") {
      const size =
        typeof item.w === "number" && typeof item.h === "number"
          ? ` ${item.w}x${item.h}`
          : "";
      lines.push(`position: x${item.x} y${item.y}${size}`);
    }
    lines.push(
      `currentText: ${trimOneLine(item.currentText, 160) || "(empty)"}`,
    );
    lines.push(`htmlHint: ${trimOneLine(item.htmlHint, 180) || "(none)"}`);
    const style = trimOneLine(item.style, 400);
    if (style) lines.push(`computedStyle: ${style}`);
  });
  lines.push("</attached-preview-comments>");
  return lines.join("\n");
}

/**
 * Composer-binding hint (OD activeFileContext 等价物的设计插件形态)：
 * 面板文档 tab 锁定 composer 后，随每条消息说明目标文档。
 */
export function buildDesignBindingHint(binding: {
  documentId: string | null;
  name?: string;
}): string {
  if (!binding.documentId || !binding.name) return "";
  return [
    "",
    "",
    "<design-context>",
    `This message targets the attached design document "${binding.name}" (documentId: ${binding.documentId}). Apply the requested change to it through the design plugin tools (plugin_apply_edit) — do not create a new document.`,
    "</design-context>",
  ].join("\n");
}

/**
 * Timeline display: the structured block is model-facing payload (composed
 * into the stored message at the send boundary); the chat bubble keeps only
 * the user's own words — OD renders comment attachments as chips instead of
 * raw XML, this is the display-side equivalent.
 */
export function stripDesignAnnotationBlock(text: string): string {
  return text
    .replace(
      /<attached-preview-comments>[\s\S]*?<\/attached-preview-comments>\s*/g,
      "",
    )
    .replace(/<design-context>[\s\S]*?<\/design-context>\s*/g, "")
    .trimEnd();
}

/** Pending annotations for the current draft, consumed at send time. */
export class DesignAnnotationDraft {
  private annotations: DesignAnnotationInput[] = [];
  private document: DesignDocumentPayload | undefined;

  add(
    annotations: readonly DesignAnnotationInput[] | undefined,
    document?: DesignDocumentPayload,
  ): void {
    if (document) this.document = document;
    for (const item of annotations ?? []) {
      if (!item.id) {
        this.annotations.push(item);
        continue;
      }
      const index = this.annotations.findIndex(
        (existing) => existing.id === item.id,
      );
      if (index >= 0) this.annotations[index] = item;
      else this.annotations.push(item);
    }
  }

  /** Compose the hint for the outgoing text and clear the pending set. */
  takeForSend(): { hint: string; document?: DesignDocumentPayload } {
    const hint = buildDesignAnnotationHint(this.annotations, this.document);
    const document = this.document;
    this.annotations = [];
    this.document = undefined;
    return {
      hint,
      ...(document ? { document } : {}),
    };
  }

  get size(): number {
    return this.annotations.length;
  }
}
