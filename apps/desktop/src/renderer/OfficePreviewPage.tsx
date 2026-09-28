import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { ArtifactSelection } from "@artemis/protocol";
import { InlineNotice } from "@artemis/ui/feedback";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { pageRegion } from "./office-preview-selection.js";
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
}: {
  document: PDFDocumentProxy;
  page: number;
  zoom: string;
  version: number;
  onRegion?(selection: ArtifactSelection, version: number): void;
  thumbnail?: boolean;
  label: string;
  selection?: ArtifactSelection | undefined;
  editor?: OfficeEditorState | undefined;
  editLabel?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const [drag, setDrag] =
    useState<Extract<ArtifactSelection, { kind: "region" }>>();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState<string>();
  const [painted, setPainted] = useState<{
    page: number;
    version: number;
    width: number;
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
    setError(undefined);
    setDrag(undefined);
    start.current = undefined;
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
        if (!active || !canvas.current) return;
        const output = canvas.current;
        output.width = temporary.width;
        output.height = temporary.height;
        output.style.width = `${viewport.width}px`;
        output.style.height = `${viewport.height}px`;
        output.getContext("2d")!.drawImage(temporary, 0, 0);
        output.dataset.previewVersion = String(version);
        output.dataset.previewPage = String(page);
        setPainted({ page, version, width: viewport.width });
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
    };
  }, [document, page, version, zoom, thumbnail, size]);

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
    >
      <canvas
        ref={canvas}
        aria-label={label}
        onPointerDown={(event) => {
          if (!onRegion || event.button !== 0) return;
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
          if (value) onRegion(value, version);
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
      {region && !thumbnail ? (
        <div
          className="office-region-selection"
          aria-hidden="true"
          style={{
            left: `${region.x * 100}%`,
            top: `${region.y * 100}%`,
            width: `${region.width * 100}%`,
            height: `${region.height * 100}%`,
          }}
        />
      ) : null}
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
    </div>
  );
}
