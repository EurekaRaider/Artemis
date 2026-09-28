import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { OfficeEditorState } from "./office-editor-state.js";
import { officeTargetKey } from "./office-editor-state.js";
import {
  pageTextAnchors,
  pageTextHitBounds,
  type PageTextAnchor,
  type PageTextRun,
} from "./office-page-text.js";

export function OfficePageEditor({
  document,
  page,
  version,
  width,
  canvas,
  editor,
  label,
}: {
  document: PDFDocumentProxy;
  page: number;
  version: number;
  width: number;
  canvas: HTMLCanvasElement;
  editor: OfficeEditorState;
  label: string;
}) {
  const [anchors, setAnchors] = useState<PageTextAnchor[]>([]);
  const hitBounds = useMemo(
    () => anchors.map((anchor) => pageTextHitBounds(anchor, anchors)),
    [anchors],
  );
  const [active, setActive] = useState<
    PageTextAnchor & { pageWidth: number }
  >();
  const input = useRef<HTMLTextAreaElement>(null);
  const editingToken = useRef(0);
  useEffect(
    () => () => {
      if (editor.composing) editor.setComposing(false);
    },
    [editor],
  );
  const [colors, setColors] = useState({ background: "#fff", color: "#111" });
  useEffect(() => {
    let current = true;
    void document
      .getPage(page)
      .then(async (pdfPage) => {
        const scale = width / pdfPage.getViewport({ scale: 1 }).width;
        const viewport = pdfPage.getViewport({ scale });
        const content = await pdfPage.getTextContent();
        const runs: PageTextRun[] = [];
        for (const item of content.items) {
          if (
            !("str" in item) ||
            !item.str.trim() ||
            Math.abs(item.transform[1]!) > 0.01 ||
            Math.abs(item.transform[2]!) > 0.01
          )
            continue;
          const [left, baseline] = viewport.convertToViewportPoint(
            item.transform[4]!,
            item.transform[5]!,
          );
          const height = Math.abs(item.transform[3]!) * scale;
          const style = content.styles[item.fontName];
          runs.push({
            text: item.str,
            left: left!,
            top: baseline! - height * (style?.ascent ?? 0.8),
            width: item.width * scale,
            height,
            font: style?.fontFamily ?? "sans-serif",
          });
        }
        if (current && editor.snapshot?.session.version === version)
          setAnchors(
            pageTextAnchors(runs, editor.snapshot.targets, page, scale),
          );
      })
      .catch(() => {
        if (current) setAnchors([]);
      });
    return () => {
      current = false;
    };
  }, [document, page, version, width, editor]);
  const target =
    active &&
    (editor.snapshot?.targets.find(
      (value) => officeTargetKey(value) === active.key,
    ) ??
      active.target);
  const text = target ? editor.value(target) : "";
  const scale = active ? width / active.pageWidth : 1;
  useEffect(() => {
    if (!input.current || !active) return;
    const height = active.height * scale;
    input.current.style.height = `${height}px`;
    input.current.style.height = `${Math.max(height, input.current.scrollHeight)}px`;
  }, [text, active, scale]);
  function start(anchor: PageTextAnchor) {
    // Sample the rendered paper/shape so an in-place edit keeps its background.
    const density = canvas.width / width;
    const x = Math.max(0, Math.floor(anchor.left * density));
    const y = Math.max(0, Math.floor(anchor.top * density));
    const w = Math.max(
      1,
      Math.min(512, canvas.width - x, Math.ceil(anchor.width * density)),
    );
    const h = Math.max(
      1,
      Math.min(128, canvas.height - y, Math.ceil(anchor.height * density)),
    );
    const pixels = canvas.getContext("2d")?.getImageData(x, y, w, h).data;
    const counts = new Map<string, number>();
    if (pixels)
      for (let i = 0; i < pixels.length; i += 4) {
        const color = `${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`;
        counts.set(color, (counts.get(color) ?? 0) + 1);
      }
    const common = [...counts].sort((a, b) => b[1] - a[1]);
    const background = common[0]?.[0] ?? "255,255,255";
    const bg = background.split(",").map(Number);
    const foreground =
      common.find(
        ([color, count]) =>
          count > 2 &&
          color
            .split(",")
            .some((value, index) => Math.abs(Number(value) - bg[index]!) > 90),
      )?.[0] ?? "0,0,0";
    setColors({
      background: `rgb(${background})`,
      color: `rgb(${foreground})`,
    });
    editingToken.current++;
    const nearby = anchors.filter(
      (other) =>
        other.key !== anchor.key &&
        other.left > anchor.left + anchor.width &&
        other.top < anchor.top + anchor.height &&
        other.top + other.height > anchor.top,
    );
    const right = nearby.length
      ? Math.min(...nearby.map((other) => other.left)) - 8
      : width - Math.min(anchor.left, width * 0.15);
    setActive({
      ...anchor,
      pageWidth: width,
      width:
        anchor.target.selection.kind === "paragraph"
          ? Math.max(anchor.width, right - anchor.left)
          : anchor.width,
    });
  }
  return (
    <div className="office-page-edit-layer">
      {editor.snapshot?.session.version === version
        ? anchors.map((anchor, index) => (
            <button
              key={anchor.key}
              type="button"
              className="office-page-edit-hit"
              aria-label={`${label}: ${anchor.target.text.slice(0, 80)}`}
              title={label}
              style={hitBounds[index]}
              onClick={() => start(anchor)}
            />
          ))
        : null}
      {active && target ? (
        <textarea
          key={active.key}
          ref={input}
          autoFocus
          className="office-page-edit-input"
          aria-label={label}
          value={text}
          spellCheck={false}
          style={{
            left: active.left * scale,
            top: active.top * scale,
            width: active.width * scale,
            minHeight: active.height * scale,
            fontSize: active.fontSize * scale,
            lineHeight: `${active.lineHeight * scale}px`,
            fontFamily: active.font,
            ...colors,
          }}
          onChange={(event) => editor.setText(target, event.target.value)}
          onCompositionStart={() => editor.setComposing(true)}
          onCompositionEnd={() => editor.setComposing(false)}
          onKeyDown={(event) => {
            if (
              !event.nativeEvent.isComposing &&
              (event.key === "Escape" ||
                (event.key === "Enter" && !event.shiftKey))
            ) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          onBlur={(event) => {
            // Enter and clicks on the paper must leave undo scoped to this file.
            if (!event.relatedTarget)
              event.currentTarget
                .closest<HTMLElement>(".office-workbench")
                ?.focus({ preventScroll: true });
            const token = editingToken.current;
            void editor
              .flush()
              .then(() => {
                if (editingToken.current === token) setActive(undefined);
              })
              .catch(() => undefined);
          }}
        />
      ) : null}
    </div>
  );
}
