import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { ArtifactSelection } from "@artemis/protocol";
import { InlineNotice } from "@artemis/ui/feedback";
import { TextLayer, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import { pageRegion, pageRegionQuote } from "./office-preview-selection.js";
import { OfficePageEditor } from "./OfficePageEditor.js";
import type { OfficeEditorState } from "./office-editor-state.js";

export function OfficePreviewPage({
  document,
  page,
  zoom,
  version,
  onRegion,
  thumbnail = false,
  label,
  selection,
  editor,
  editLabel,
  lazy = false,
  selecting = false,
  onClearSelection,
}: {
  document: PDFDocumentProxy;
  page: number;
  zoom: string;
  version: number;
  onRegion?(
    selection: ArtifactSelection,
    version: number,
    quote?: string,
  ): void;
  thumbnail?: boolean;
  label: string;
  selection?: ArtifactSelection | undefined;
  editor?: OfficeEditorState | undefined;
  editLabel?: string;
  lazy?: boolean;
  selecting?: boolean;
  onClearSelection?(): void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(
    !lazy || typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    if (!lazy || !frame.current || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!!entry?.isIntersecting),
      { root: frame.current.parentElement, rootMargin: "800px" },
    );
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, [lazy]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const textRuns = useRef<{
    page: number;
    version: number;
    runs: Parameters<typeof pageRegionQuote>[1];
  }>(undefined);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const [drag, setDrag] =
    useState<Extract<ArtifactSelection, { kind: "region" }>>();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState<string>();
  const [painted, setPainted] = useState<{
    page: number;
    version: number;
    width: number;
    height: number;
  }>();

  useEffect(() => {
    const viewport = frame.current?.parentElement;
    if (!viewport || thumbnail) return;
    const measure = () => {
      const style = getComputedStyle(viewport);
      const width =
        viewport.clientWidth -
        (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0);
      const height =
        viewport.clientHeight -
        (parseFloat(style.paddingTop) || 0) -
        (parseFloat(style.paddingBottom) || 0);
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    measure();
    return () => observer.disconnect();
  }, [thumbnail]);

  useEffect(() => {
    let active = true;
    let task: RenderTask | undefined;
    let layer: TextLayer | undefined;
    textLayer.current?.replaceChildren();
    setError(undefined);
    setDrag(undefined);
    start.current = undefined;
    textRuns.current = undefined;
    void document
      .getPage(page)
      .then(async (pdfPage) => {
        if (!active) return;
        const original = pdfPage.getViewport({ scale: 1 });
        const widthScale = size.width > 0 ? size.width / original.width : 1;
        const heightScale = size.height > 0 ? size.height / original.height : 1;
        const scale = thumbnail
          ? 120 / original.width
          : zoom === "width"
            ? widthScale
            : zoom === "page"
              ? Math.min(widthScale, heightScale)
              : Number(zoom);
        const viewport = pdfPage.getViewport({ scale: Math.max(0.1, scale) });
        if (canvas.current) {
          canvas.current.style.width = `${viewport.width}px`;
          canvas.current.style.height = `${viewport.height}px`;
        }
        if (!visible) {
          if (canvas.current) {
            canvas.current.width = 0;
            canvas.current.height = 0;
          }
          setPainted(undefined);
          return;
        }
        const density = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );
        const temporary = window.document.createElement("canvas");
        temporary.width = Math.ceil(viewport.width * density);
        temporary.height = Math.ceil(viewport.height * density);
        task = pdfPage.render({
          canvas: temporary,
          viewport,
          transform: [density, 0, 0, density, 0, 0],
        });
        await task.promise;
        const runs: Array<{
          text: string;
          x: number;
          y: number;
          width: number;
          height: number;
        }> = [];
        if (!thumbnail) {
          try {
            const content = await pdfPage.getTextContent();
            if (!active) return;
            if (textLayer.current) {
              textLayer.current.style.setProperty(
                "--total-scale-factor",
                String(viewport.scale * (viewport.userUnit ?? 1)),
              );
              layer = new TextLayer({
                textContentSource: content,
                container: textLayer.current,
                viewport,
              });
              await layer.render();
            }
            for (const item of content.items) {
              if (
                !("str" in item) ||
                !item.str.trim() ||
                Math.abs(item.transform[1]!) > 0.01 ||
                Math.abs(item.transform[2]!) > 0.01
              )
                continue;
              const [x, baseline] = viewport.convertToViewportPoint(
                item.transform[4]!,
                item.transform[5]!,
              );
              const height = Math.abs(item.transform[3]!) * viewport.scale;
              const ascent = content.styles[item.fontName]?.ascent ?? 0.8;
              runs.push({
                text: item.str,
                x: x! / viewport.width,
                y: (baseline! - height * ascent) / viewport.height,
                width: (item.width * viewport.scale) / viewport.width,
                height: height / viewport.height,
              });
            }
          } catch {
            /* Image-only previews still retain their exact region. */
          }
        }
        if (active) textRuns.current = { page, version, runs };
        if (!active || !canvas.current) return;
        const output = canvas.current;
        output.width = temporary.width;
        output.height = temporary.height;
        output.style.width = `${viewport.width}px`;
        output.style.height = `${viewport.height}px`;
        output.getContext("2d")!.drawImage(temporary, 0, 0);
        output.dataset.previewVersion = String(version);
        output.dataset.previewPage = String(page);
        setPainted({
          page,
          version,
          width: viewport.width,
          height: viewport.height,
        });
        if (!thumbnail)
          window.dispatchEvent(
            new CustomEvent("artemis-office-preview-painted", {
              detail: { version, page, at: performance.now() },
            }),
          );
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
      task?.cancel();
      layer?.cancel();
    };
  }, [document, page, version, zoom, thumbnail, size, visible]);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };
  const region =
    drag ??
    (selection?.kind === "region" && selection.page === page
      ? selection
      : undefined);
  return (
    <div
      ref={frame}
      className="office-page"
      data-thumbnail={thumbnail || undefined}
      data-page-number={page}
      data-selecting={selecting || undefined}
    >
      <canvas
        ref={canvas}
        aria-label={label}
        tabIndex={thumbnail ? undefined : 0}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            start.current = undefined;
            setDrag(undefined);
            onClearSelection?.();
          }
        }}
        onPointerDown={(event) => {
          if (!onRegion || event.button !== 0) return;
          event.currentTarget.focus({ preventScroll: true });
          start.current = point(event);
          setDrag(undefined);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (start.current)
            setDrag(pageRegion(page, start.current, point(event)));
        }}
        onPointerUp={(event) => {
          const initial = start.current;
          start.current = undefined;
          setDrag(undefined);
          if (
            !initial ||
            !onRegion ||
            Number(event.currentTarget.dataset.previewPage) !== page ||
            Number(event.currentTarget.dataset.previewVersion) !== version
          )
            return;
          const value = pageRegion(page, initial, point(event));
          if (value) {
            const text = textRuns.current;
            onRegion(
              value,
              version,
              text?.page === page && text.version === version
                ? pageRegionQuote(value, text.runs)
                : undefined,
            );
          } else onClearSelection?.();
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          start.current = undefined;
          setDrag(undefined);
        }}
        onLostPointerCapture={() => {
          start.current = undefined;
          setDrag(undefined);
        }}
      />
      {!thumbnail ? (
        <div
          ref={textLayer}
          className="office-text-layer"
          hidden={!selecting}
          tabIndex={selecting ? 0 : -1}
          onPointerDown={() =>
            textLayer.current?.focus({ preventScroll: true })
          }
          onPointerUp={() => {
            const selected = window.getSelection();
            const root = textLayer.current;
            if (
              !root ||
              !selected ||
              selected.isCollapsed ||
              !selected.rangeCount ||
              painted?.page !== page ||
              painted.version !== version
            )
              return;
            const range = selected.getRangeAt(0);
            if (
              !root.contains(range.startContainer) ||
              !root.contains(range.endContainer)
            )
              return;
            const quote = selected.toString().slice(0, 8192);
            const bounds = root.getBoundingClientRect();
            const rect = range.getBoundingClientRect();
            if (!quote.trim() || !bounds.width || !bounds.height) return;
            const x = Math.max(0, (rect.left - bounds.left) / bounds.width);
            const y = Math.max(0, (rect.top - bounds.top) / bounds.height);
            onRegion?.(
              {
                kind: "region",
                page,
                x,
                y,
                width: Math.min(rect.width / bounds.width, 1 - x),
                height: Math.min(rect.height / bounds.height, 1 - y),
              },
              version,
              quote,
            );
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              window.getSelection()?.removeAllRanges();
              onClearSelection?.();
            }
          }}
        />
      ) : null}
      {!thumbnail && editor && canvas.current && painted?.page === page ? (
        <OfficePageEditor
          key={page}
          document={document}
          page={page}
          version={painted.version}
          width={painted.width}
          canvas={canvas.current}
          editor={editor}
          label={editLabel ?? "Edit text"}
        />
      ) : null}
      {region &&
      !thumbnail &&
      painted?.page === page &&
      painted.version === version ? (
        <div
          className="office-region-selection"
          aria-hidden="true"
          style={{
            left: region.x * painted.width,
            top: region.y * painted.height,
            width: region.width * painted.width,
            height: region.height * painted.height,
          }}
        />
      ) : null}
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
    </div>
  );
}
