import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  artifactAnnotationSchema,
  type AppLocale,
  type ArtifactAnnotation,
  type ArtifactSelection,
  type ArtifactSnapshot,
  type ArtifactViewState,
} from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { Checkbox, Select, TextAreaField, TextField } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { officeCopy } from "./office-copy.js";
import "./office-workbench.css";

function OfficePage({
  document,
  page,
  zoom,
  version,
  onRegion,
  thumbnail = false,
  label,
}: {
  document: PDFDocumentProxy;
  page: number;
  zoom: number;
  version: number;
  onRegion?(selection: ArtifactSelection, version: number): void;
  thumbnail?: boolean;
  label: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    let task: RenderTask | undefined;
    setError(undefined);
    void document
      .getPage(page)
      .then(async (pdfPage) => {
        const viewport = pdfPage.getViewport({
          scale: thumbnail
            ? 96 / pdfPage.getViewport({ scale: 1 }).width
            : zoom,
        });
        const scale = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );
        const temporary = window.document.createElement("canvas");
        temporary.width = Math.ceil(viewport.width * scale);
        temporary.height = Math.ceil(viewport.height * scale);
        task = pdfPage.render({
          canvas: temporary,
          viewport,
          transform: [scale, 0, 0, scale, 0, 0],
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
  }, [document, page, version, zoom, thumbnail]);
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };
  return (
    <>
      <canvas
        ref={canvas}
        aria-label={label}
        onPointerDown={(event) => {
          if (!onRegion) return;
          start.current = point(event);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          const initial = start.current;
          start.current = undefined;
          if (
            !initial ||
            !onRegion ||
            Number(event.currentTarget.dataset.previewVersion) !== version
          )
            return;
          const end = point(event);
          const width = Math.abs(end.x - initial.x),
            height = Math.abs(end.y - initial.y);
          if (width > 0.005 && height > 0.005)
            onRegion(
              {
                kind: "region",
                page,
                x: Math.min(initial.x, end.x),
                y: Math.min(initial.y, end.y),
                width,
                height,
              },
              version,
            );
        }}
      />
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
    </>
  );
}

export function OfficeWorkbenchPanel({
  threadId,
  view,
  locale,
  onAnnotate,
  onSnapshot,
}: {
  threadId: string;
  view: ArtifactViewState;
  locale: AppLocale;
  onAnnotate(annotation: ArtifactAnnotation): void;
  onSnapshot?(snapshot: ArtifactSnapshot): void;
}) {
  const t = officeCopy(locale);
  const [snapshot, setSnapshot] = useState<ArtifactSnapshot>();
  const [pdf, setPdf] = useState<{
    document: PDFDocumentProxy;
    version: number;
  }>();
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState("1");
  const [follow, setFollow] = useState(true);
  const [sheet, setSheet] = useState("");
  const [sheetPages, setSheetPages] = useState<Record<string, number>>({});
  const mappedSheet = useRef<string | undefined>(undefined);
  const [range, setRange] = useState("A1");
  const [note, setNote] = useState("");
  const [selection, setSelection] = useState<{
    value: ArtifactSelection;
    version: number;
  }>();
  const [error, setError] = useState<string>();
  const sessionId = view.session.sessionId;
  useEffect(() => {
    let active = true;
    void window.artemis
      .readOfficeSnapshot(threadId, sessionId)
      .then((next) => {
        if (!active) return;
        setSnapshot((previous) =>
          !previous || next.session.sequence >= previous.session.sequence
            ? next
            : previous,
        );
        setError(undefined);
        if (view.needsSnapshot) onSnapshot?.(next);
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [view, sessionId, threadId, onSnapshot]);
  const assetId = snapshot?.preview?.assetId;
  useEffect(() => {
    if (!assetId) return;
    let active = true;
    let loading: PDFDocumentLoadingTask | undefined;
    void Promise.all([
      import("pdfjs-dist"),
      window.artemis.openOfficePreview(threadId, sessionId, assetId),
    ])
      .then(async ([pdfjs, bytes]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const data = Uint8Array.from(atob(bytes.data), (value) =>
          value.charCodeAt(0),
        );
        if (!active) return;
        loading = pdfjs.getDocument({ data });
        const loaded = await loading.promise;
        if (!active) return;
        setPdf({ document: loaded, version: bytes.version });
        setPage((previous) => Math.min(previous, loaded.numPages));
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
      void loading?.destroy();
    };
  }, [assetId, sessionId, threadId]);
  useEffect(() => {
    if (!follow || !view.selection) return;
    const value = view.selection;
    setSelection({ value, version: view.session.version });
    if (value.kind === "object" || value.kind === "region") setPage(value.page);
    if (value.kind === "cells") {
      setSheet(value.sheet);
      setRange(value.range);
    }
  }, [follow, view.selection, view.session.version]);
  useEffect(() => {
    if (
      !follow ||
      !pdf ||
      view.selection?.kind !== "paragraph" ||
      !snapshot ||
      pdf.version !== snapshot.session.version
    )
      return;
    const index = view.selection.index;
    const target = snapshot.targets.find(
      (target) =>
        target.selection.kind === "paragraph" &&
        target.selection.index === index,
    );
    const quote = target?.text.replace(/\s/gu, "").slice(0, 60);
    if (!quote) return;
    let active = true;
    void (async () => {
      for (let current = 1; current <= pdf.document.numPages; current++) {
        if (!active) return;
        const text = await (
          await pdf.document.getPage(current)
        ).getTextContent();
        if (
          text.items
            .map((item) => ("str" in item ? item.str : ""))
            .join("")
            .replace(/\s/gu, "")
            .includes(quote)
        ) {
          if (active) setPage(current);
          return;
        }
      }
    })().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [follow, pdf, snapshot, view.selection]);
  const currentSheet = sheet || snapshot?.sheets[0] || "";
  useEffect(() => {
    setSheetPages({});
    if (!pdf || !snapshot?.sheets.length) return;
    let active = true;
    void (async () => {
      const pages: Record<string, number> = {};
      const outline = await pdf.document.getOutline();
      for (const item of outline ?? []) {
        if (!snapshot.sheets.includes(item.title)) continue;
        const destination =
          typeof item.dest === "string"
            ? await pdf.document.getDestination(item.dest)
            : item.dest;
        if (!destination?.length) continue;
        const index =
          typeof destination[0] === "number"
            ? destination[0]
            : await pdf.document.getPageIndex(destination[0]);
        if (index >= 0 && index < pdf.document.numPages)
          pages[item.title] = index + 1;
      }
      if (active) setSheetPages(pages);
    })().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [pdf, snapshot?.sheets]);
  useEffect(() => {
    const targetPage = sheetPages[currentSheet];
    if (
      targetPage &&
      (mappedSheet.current !== currentSheet ||
        (follow && view.selection?.kind === "cells"))
    ) {
      mappedSheet.current = currentSheet;
      setPage(targetPage);
    }
  }, [currentSheet, sheetPages, follow, view.selection]);
  const targets = (snapshot?.targets ?? []).filter(
    (target) =>
      target.selection.kind !== "cells" ||
      target.selection.sheet === currentSheet,
  );
  const session = snapshot?.session ?? view.session;
  function selectionLabel(value: ArtifactSelection): string {
    if (value.kind === "paragraph") return `${t.paragraph} ${value.index + 1}`;
    if (value.kind === "object")
      return `${t.page} ${value.page} · ${t.object} ${[value.index, ...(value.path ?? [])].map((index) => index + 1).join(".")}${value.cell ? ` · R${value.cell.row + 1}C${value.cell.column + 1}` : ""}`;
    if (value.kind === "cells") return `${value.sheet} · ${value.range}`;
    return `${t.regionSelection} · ${t.page} ${value.page}`;
  }
  function addNote() {
    if (!selection || !note.trim()) return;
    const parsed = artifactAnnotationSchema.safeParse({
      protocolVersion: 1,
      id: crypto.randomUUID(),
      documentId: session.documentId,
      sessionId,
      sourceVersion: selection.version,
      selection: selection.value,
      text: note,
    });
    if (!parsed.success) {
      setError(parsed.error.message);
      return;
    }
    onAnnotate(parsed.data);
    setNote("");
  }
  return (
    <section
      className="office-workbench"
      aria-label={session.path}
      data-document-version={session.version}
    >
      <header className="office-toolbar">
        <span role="status">
          {t[session.status]} · {t.version} {session.version} · {t.preview}{" "}
          {session.previewVersion ?? "—"}
        </span>
        <Checkbox
          label={t.follow}
          checked={follow}
          onCheckedChange={setFollow}
        />
      </header>
      {error || session.error ? (
        <InlineNotice tone="warning">{error ?? session.error}</InlineNotice>
      ) : null}
      <div className="office-toolbar">
        <Select
          label={t.page}
          value={String(page)}
          onValueChange={(value) => setPage(Number(value))}
          options={Array.from(
            { length: pdf?.document.numPages ?? 1 },
            (_, index) => ({
              value: String(index + 1),
              label: String(index + 1),
            }),
          )}
        />
        <Select
          label={t.zoom}
          value={zoom}
          onValueChange={setZoom}
          options={["0.5", "0.75", "1", "1.25", "1.5", "2"].map((value) => ({
            value,
            label: `${Number(value) * 100}%`,
          }))}
        />
        {snapshot?.sheets.length ? (
          <Select
            label={t.sheet}
            value={currentSheet}
            onValueChange={setSheet}
            options={snapshot.sheets.map((value) => ({ value, label: value }))}
          />
        ) : null}
      </div>
      {pdf && session.format === "powerpoint" ? (
        <nav className="office-toolbar" aria-label={t.slides}>
          {Array.from(
            { length: Math.min(5, pdf.document.numPages) },
            (_, index) =>
              Math.max(1, Math.min(page - 2, pdf.document.numPages - 4)) +
              index,
          ).map((number) => (
            <Button
              key={number}
              label={`${t.page} ${number}`}
              selected={number === page}
              variant="quiet"
              onClick={() => setPage(number)}
            >
              <OfficePage
                document={pdf.document}
                page={number}
                zoom={1}
                version={pdf.version}
                thumbnail
                label={`${t.page} ${number}`}
              />
              {number}
            </Button>
          ))}
        </nav>
      ) : null}
      <div className="office-page-scroll">
        {pdf ? (
          <OfficePage
            document={pdf.document}
            page={Math.min(page, pdf.document.numPages)}
            zoom={Number(zoom)}
            version={pdf.version}
            label={`${t.page} ${Math.min(page, pdf.document.numPages)}`}
            onRegion={(value, version) => setSelection({ value, version })}
          />
        ) : (
          <p role="status">{t.noPreview}</p>
        )}
      </div>
      <div className="office-annotation">
        <small>{t.region}</small>
        {targets.length ? (
          <Select
            label={t.selection}
            value={selection ? JSON.stringify(selection.value) : ""}
            onValueChange={(value) =>
              setSelection({
                value: JSON.parse(value) as ArtifactSelection,
                version: session.version,
              })
            }
            options={[
              { value: "", label: t.select, disabled: true },
              ...targets.slice(0, 2_000).map((target) => ({
                value: JSON.stringify(target.selection),
                label:
                  selectionLabel(target.selection) +
                  (target.text ? ` · ${target.text.slice(0, 100)}` : ""),
              })),
              ...(selection &&
              !targets.some(
                (target) =>
                  JSON.stringify(target.selection) ===
                  JSON.stringify(selection.value),
              )
                ? [
                    {
                      value: JSON.stringify(selection.value),
                      label: `${selectionLabel(selection.value)} · ${t.version} ${selection.version}`,
                    },
                  ]
                : []),
            ]}
          />
        ) : null}
        {snapshot?.sheets.length ? (
          <TextField
            label={t.range}
            value={range}
            onValueChange={(value) => {
              setRange(value);
              setSelection({
                value: { kind: "cells", sheet: currentSheet, range: value },
                version: session.version,
              });
            }}
          />
        ) : null}
        <TextAreaField
          label={t.note}
          value={note}
          onValueChange={setNote}
          rows={2}
          maxLength={8_192}
        />
        <Button disabled={!selection || !note.trim()} onClick={addNote}>
          {t.addNote}
        </Button>
        {snapshot?.warnings.map((warning) => (
          <small key={warning}>
            {warning.startsWith("Cell selection index covers A1:Z50 per sheet;")
              ? t.cellLimit
              : warning}
          </small>
        ))}
      </div>
    </section>
  );
}
