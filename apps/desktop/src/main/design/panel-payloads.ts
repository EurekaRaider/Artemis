import { type DesignPanelAnnotation } from "./panel-contracts.js";

export const MAX_CANDIDATE_ANNOTATIONS = 20;

export const MAX_ANNOTATION_JSON_BYTES = 64 * 1024;

export const MAX_DOCUMENT_HTML_BYTES = 512 * 1024;

/** Attached panel images: data URLs only, bounded count/size (composer
 *  images flow into PromptImage base64, so the limits mirror it). */
export function sanitizeCandidateImages(input: unknown): string[] | undefined {
  if (!Array.isArray(input) || input.length === 0) return undefined;
  const out: string[] = [];
  for (const raw of input.slice(0, 6)) {
    if (typeof raw !== "string") continue;
    const match =
      /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
    if (!match) continue;
    if (raw.length > 10 * 1024 * 1024) continue;
    out.push(raw);
  }
  return out.length > 0 ? out : undefined;
}

export function sanitizeDocumentPayload(
  input: unknown,
): { documentId: string; documentName: string; html: string } | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const item = input as Record<string, unknown>;
  if (
    typeof item.documentId !== "string" ||
    typeof item.documentName !== "string" ||
    typeof item.html !== "string"
  ) {
    return undefined;
  }
  if (item.html.length > MAX_DOCUMENT_HTML_BYTES) return undefined;
  if (!item.html.trim()) return undefined;
  return {
    documentId: item.documentId.slice(0, 128),
    documentName: item.documentName.slice(0, 256),
    html: item.html,
  };
}

export function sanitizeAnnotations(
  input: unknown,
): DesignPanelAnnotation[] | undefined {
  if (!Array.isArray(input) || input.length === 0) return undefined;
  const out: DesignPanelAnnotation[] = [];
  for (const raw of input.slice(0, MAX_CANDIDATE_ANNOTATIONS)) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    out.push({
      ...(typeof item.id === "string" ? { id: item.id.slice(0, 128) } : {}),
      ...(typeof item.kind === "string"
        ? { kind: item.kind.slice(0, 32) }
        : {}),
      ...(typeof item.markKind === "string"
        ? { markKind: item.markKind.slice(0, 32) }
        : {}),
      ...(typeof item.label === "string"
        ? { label: item.label.slice(0, 256) }
        : {}),
      ...(typeof item.text === "string"
        ? { text: item.text.slice(0, 8_192) }
        : {}),
      documentId:
        typeof item.documentId === "string"
          ? item.documentId.slice(0, 128)
          : null,
      documentName:
        typeof item.documentName === "string"
          ? item.documentName.slice(0, 256)
          : null,
      ...(typeof item.currentText === "string"
        ? { currentText: item.currentText.slice(0, 512) }
        : {}),
      ...(typeof item.selector === "string"
        ? { selector: item.selector.slice(0, 512) }
        : {}),
      x: typeof item.x === "number" && Number.isFinite(item.x) ? item.x : null,
      y: typeof item.y === "number" && Number.isFinite(item.y) ? item.y : null,
      w: typeof item.w === "number" && Number.isFinite(item.w) ? item.w : null,
      h: typeof item.h === "number" && Number.isFinite(item.h) ? item.h : null,
      ...(typeof item.htmlHint === "string"
        ? { htmlHint: item.htmlHint.slice(0, 512) }
        : {}),
      ...(typeof item.style === "string"
        ? { style: item.style.slice(0, 512) }
        : {}),
    });
  }
  if (out.length === 0) return undefined;
  // Drop the whole sidecar when it would smuggle in oversized context.
  if (JSON.stringify(out).length > MAX_ANNOTATION_JSON_BYTES) return undefined;
  return out;
}
