import { useEffect, useMemo, useRef, useState } from "react";
import {
  artifactAnnotationSchema,
  artifactSelectionSchema,
  type AppLocale,
  type ArtifactAnnotation,
  type ArtifactSelection,
  type ArtifactSnapshot,
  type ArtifactViewState,
} from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
import { Switch, Select, TextAreaField, TextField } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ArtemisIcon } from "@artemis/ui/icons";
import { OfficePreviewPage } from "./OfficePreviewPage.js";
import { OfficeSpreadsheet } from "./OfficeSpreadsheet.js";
import { officeCopy } from "./office-copy.js";
import "./office-workbench.css";
import { officeEditor } from "./office-editor-state.js";
import { officeEditCopy } from "./office-edit-copy.js";
import documentsIcon from "../../resources/bundled-artifact-plugins/plugins/documents/assets/icon.png";
import presentationsIcon from "../../resources/bundled-artifact-plugins/plugins/presentations/assets/icon.png";
import spreadsheetsIcon from "../../resources/bundled-artifact-plugins/plugins/spreadsheets/assets/icon.png";
import { useWorkspaceEditHistory } from "./workspace-edit-history.js";

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
  const [zoom, setZoom] = useState(
    view.session.format === "powerpoint" ? "page" : "width",
  );
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [sheetView, setSheetView] = useState("grid");
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
  const editCopy = officeEditCopy(locale);
  const [, refreshEditor] = useState(0);
  const editor = useMemo(
    () => officeEditor(threadId, sessionId, view.session.path),
    [threadId, sessionId, view.session.path],
  );
  const historyRef = useWorkspaceEditHistory<HTMLElement>(editor);
  useEffect(
    () =>
      editor.subscribe(() => {
        refreshEditor((value) => value + 1);
        if (editor.snapshot)
          setSnapshot((previous) =>
            !previous ||
            editor.snapshot!.session.sequence >= previous.session.sequence
              ? editor.snapshot
              : previous,
          );
      }),
    [editor],
  );
  useEffect(() => {
    if (snapshot) editor.update(snapshot);
  }, [editor, snapshot]);
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
    if (!follow || !view.selection || annotationOpen) return;
    const value = view.selection;
    setSelection({ value, version: view.session.version });
    if (value.kind === "object" || value.kind === "region") setPage(value.page);
    if (value.kind === "cells") {
      setSheet(value.sheet);
      setRange(value.range);
    }
  }, [follow, view.selection, view.session.version, annotationOpen]);
  useEffect(() => {
    if (
      !follow ||
      annotationOpen ||
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
  }, [follow, pdf, snapshot, view.selection, annotationOpen]);
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
    setAnnotationOpen(false);
    setSelection(undefined);
  }
  const isSheet = session.format === "excel";
  const showGrid = isSheet && sheetView === "grid";
  const pageCount = pdf?.document.numPages ?? 1;
  const currentPage = Math.min(page, pageCount);
  const slides = useRef<HTMLElement>(null);
  useEffect(() => {
    const strip = slides.current;
    if (!strip) return;
    const revealCurrentSlide = () =>
      strip
        .querySelector('[aria-pressed="true"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const observer = new ResizeObserver(revealCurrentSlide);
    observer.observe(strip);
    revealCurrentSlide();
    return () => observer.disconnect();
  }, [currentPage, pdf]);
  const fileName = session.path.split(/[\\/]/u).pop() ?? session.path;
  const selectedValue = selection ? JSON.stringify(selection.value) : "";
  const validSelection =
    selection && artifactSelectionSchema.safeParse(selection.value).success;
  const quote =
    selection?.version === session.version
      ? targets.find(
          (target) => JSON.stringify(target.selection) === selectedValue,
        )?.text
      : undefined;
  const targetOptions = (isSheet ? [] : targets)
    .filter(
      (target) =>
        target.selection.kind !== "object" ||
        target.selection.page === currentPage,
    )
    .slice(0, 2_000)
    .map((target) => ({
      value: JSON.stringify(target.selection),
      label:
        selectionLabel(target.selection) +
        (target.text ? ` · ${target.text.slice(0, 100)}` : ""),
    }));
  if (
    !isSheet &&
    selection &&
    !targetOptions.some((target) => target.value === selectedValue)
  ) {
    targetOptions.push({
      value: selectedValue,
      label: selectionLabel(selection.value),
    });
  }
  const chooseSelection = (
    value: ArtifactSelection,
    version = session.version,
  ) => {
    setSelection({ value, version });
    setAnnotationOpen(true);
    if (value.kind === "cells") setRange(value.range);
  };

  return (
    <section
      ref={historyRef}
      tabIndex={-1}
      className="office-workbench"
      aria-label={session.path}
      data-document-version={session.version}
      data-format={session.format}
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          void editor.flush().catch(() => undefined);
          return;
        }
        if (event.defaultPrevented || !annotationOpen) return;
        if (event.key === "Escape") {
          event.preventDefault();
          setAnnotationOpen(false);
        } else if (
          event.key === "Enter" &&
          (event.metaKey || event.ctrlKey) &&
          validSelection &&
          note.trim()
        ) {
          event.preventDefault();
          addNote();
        }
      }}
    >
      <header className="office-header">
        <img
          className="office-file-icon"
          alt=""
          draggable={false}
          src={
            isSheet
              ? spreadsheetsIcon
              : session.format === "powerpoint"
                ? presentationsIcon
                : documentsIcon
          }
        />
        <div className="office-file-info">
          <strong title={session.path}>{fileName}</strong>
          <span
            className="office-status"
            role="status"
            data-status={session.status}
            title={
              session.savePath
                ? `${editCopy.destination}: ${session.savePath}`
                : editCopy.copy
            }
          >
            <ArtemisIcon
              name={
                session.status === "saved"
                  ? "check"
                  : session.status === "failed" || session.status === "conflict"
                    ? "warning"
                    : "clock"
              }
            />
            {editor.busy
              ? t.saving
              : editor.drafts.size
                ? editCopy.pending
                : t[session.status]}{" "}
            <span>
              · {t.version} {session.version}
            </span>
            {session.previewVersion !== session.version ? (
              <span>
                · {t.preview} {session.previewVersion ?? "—"}
              </span>
            ) : null}
          </span>
        </div>
        <Switch
          className="office-follow"
          label={t.follow}
          checked={follow}
          onCheckedChange={setFollow}
        />
      </header>
      {error || session.error || editor.error ? (
        <InlineNotice tone="warning">
          {editor.error ?? error ?? session.error}
        </InlineNotice>
      ) : null}
      <div className="office-toolbar" role="group" aria-label={t.preview}>
        {isSheet ? (
          <div className="office-view-modes">
            <Button
              variant="quiet"
              selected={showGrid}
              icon={<ArtemisIcon name="spreadsheet" />}
              onClick={() => setSheetView("grid")}
            >
              {t.grid}
            </Button>
            <Button
              variant="quiet"
              selected={!showGrid}
              icon={<ArtemisIcon name="file" />}
              onClick={() => setSheetView("print")}
            >
              {t.printPreview}
            </Button>
          </div>
        ) : null}
        {!showGrid ? (
          <div className="office-page-navigation">
            <IconButton
              label={t.previousPage}
              disabled={!pdf || currentPage <= 1}
              icon={<ArtemisIcon name="chev-left" />}
              onClick={() => setPage(currentPage - 1)}
            />
            <Select
              className="office-page-picker"
              size="compact"
              label={t.page}
              value={String(currentPage)}
              disabled={!pdf}
              onValueChange={(value) => setPage(Number(value))}
              options={Array.from({ length: pageCount }, (_, index) => ({
                value: String(index + 1),
                label: `${index + 1} / ${pageCount}`,
              }))}
            />
            <IconButton
              label={t.nextPage}
              disabled={!pdf || currentPage >= pageCount}
              icon={<ArtemisIcon name="chev-right" />}
              onClick={() => setPage(currentPage + 1)}
            />
          </div>
        ) : null}
        {!showGrid ? (
          <Select
            className="office-zoom-picker"
            label={t.zoom}
            size="compact"
            value={zoom}
            onValueChange={setZoom}
            options={[
              { value: "width", label: t.fitWidth },
              { value: "page", label: t.fitPage },
              ...["0.5", "0.75", "1", "1.25", "1.5", "2"].map((value) => ({
                value,
                label: `${Number(value) * 100}%`,
              })),
            ]}
          />
        ) : null}
        <Button
          className="office-note-toggle"
          variant="quiet"
          selected={annotationOpen}
          icon={<ArtemisIcon name="message" />}
          onClick={() => setAnnotationOpen((open) => !open)}
        >
          {t.note}
        </Button>
      </div>
      <div className="office-stage">
        <div
          className="office-page-scroll"
          data-view={showGrid ? "grid" : "print"}
        >
          {showGrid && snapshot ? (
            <OfficeSpreadsheet
              key={currentSheet}
              targets={snapshot.targets}
              sheet={currentSheet}
              selection={
                selection?.version === session.version
                  ? selection.value
                  : undefined
              }
              label={t.grid}
              editor={editor}
              onSelect={(value) => {
                setRange(value);
                setSelection({
                  value: {
                    kind: "cells",
                    sheet: currentSheet,
                    range: value,
                  },
                  version: session.version,
                });
              }}
            />
          ) : pdf && !showGrid ? (
            <OfficePreviewPage
              editor={isSheet || annotationOpen ? undefined : editor}
              editLabel={editCopy.text}
              document={pdf.document}
              page={currentPage}
              zoom={zoom}
              version={pdf.version}
              label={`${t.page} ${currentPage}`}
              selection={
                selection?.version === pdf.version ? selection.value : undefined
              }
              onRegion={chooseSelection}
            />
          ) : (
            <div className="office-preview-empty" role="status">
              <ArtemisIcon name="document" />
              <p>{t.noPreview}</p>
            </div>
          )}
        </div>
        {annotationOpen ? (
          <section className="office-annotation" aria-label={t.note}>
            <div className="office-annotation-heading">
              <ArtemisIcon name="message" />
              <strong>
                {selection ? selectionLabel(selection.value) : t.note}
              </strong>
              <IconButton
                label={t.close}
                icon={<ArtemisIcon name="close" />}
                onClick={() => setAnnotationOpen(false)}
              />
            </div>
            {selection ? (
              <small className="office-annotation-version">
                {t.version} {selection.version}
              </small>
            ) : null}
            {targetOptions.length ? (
              <Select
                label={t.selection}
                size="compact"
                value={selectedValue}
                onValueChange={(value) =>
                  chooseSelection(JSON.parse(value) as ArtifactSelection)
                }
                options={[
                  { value: "", label: t.select, disabled: true },
                  ...targetOptions,
                ]}
              />
            ) : null}
            {isSheet ? (
              <TextField
                label={t.range}
                size="compact"
                value={range}
                placeholder="A1:B4"
                error={
                  selection?.value.kind === "cells" && !validSelection
                    ? t.invalidRange
                    : undefined
                }
                onValueChange={(value) => {
                  setRange(value);
                  setSelection({
                    value: {
                      kind: "cells",
                      sheet: currentSheet,
                      range: value.toUpperCase(),
                    },
                    version: session.version,
                  });
                }}
              />
            ) : null}
            {quote ? (
              <blockquote className="office-selection-quote">
                {quote.slice(0, 180)}
              </blockquote>
            ) : null}
            {!selection ? (
              <small>{showGrid ? t.cellHint : t.region}</small>
            ) : null}
            <TextAreaField
              label={t.note}
              labelVisibility="hidden"
              placeholder={t.notePlaceholder}
              value={note}
              onValueChange={setNote}
              rows={3}
              maxLength={8_192}
            />
            <div className="office-annotation-actions">
              <span>Esc</span>
              <Button
                variant="primary"
                icon={<ArtemisIcon name="send" />}
                disabled={!validSelection || !note.trim()}
                onClick={addNote}
              >
                {t.addNote}
              </Button>
            </div>
          </section>
        ) : null}
      </div>
      {isSheet && snapshot?.sheets.length ? (
        <nav className="office-sheet-tabs" aria-label={t.sheet}>
          {snapshot.sheets.map((name) => (
            <Button
              key={name}
              variant="quiet"
              selected={name === currentSheet}
              onClick={() => setSheet(name)}
            >
              {name}
            </Button>
          ))}
        </nav>
      ) : null}
      {pdf && session.format === "powerpoint" ? (
        <nav ref={slides} className="office-slide-strip" aria-label={t.slides}>
          {Array.from(
            { length: Math.min(5, pageCount) },
            (_, index) =>
              Math.max(1, Math.min(currentPage - 2, pageCount - 4)) + index,
          ).map((number) => (
            <Button
              className="office-slide"
              key={number}
              label={`${t.page} ${number}`}
              selected={number === currentPage}
              variant="quiet"
              onClick={() => setPage(number)}
            >
              <OfficePreviewPage
                document={pdf.document}
                page={number}
                zoom="1"
                version={pdf.version}
                thumbnail
                label={`${t.page} ${number}`}
              />
              <span>{number}</span>
            </Button>
          ))}
        </nav>
      ) : null}
      {showGrid ? <p className="office-grid-hint">{t.gridHint}</p> : null}
      {detailsOpen ? (
        <div className="office-preview-details">
          <small>
            {session.savePath
              ? `${editCopy.destination}: ${session.savePath}`
              : editCopy.copy}
          </small>
          <small>
            {t.version} {session.version} · {t.preview}{" "}
            {session.previewVersion ?? "—"}
          </small>
          {snapshot?.warnings.map((warning) => (
            <small key={warning}>
              {warning.startsWith(
                "Cell selection index covers A1:Z50 per sheet;",
              )
                ? t.cellLimit
                : warning}
            </small>
          ))}
        </div>
      ) : null}
      <footer className="office-footer">
        <span>
          {selection
            ? selectionLabel(selection.value)
            : showGrid
              ? t.cellHint
              : annotationOpen
                ? t.region
                : editCopy.hint}
        </span>
        {!showGrid && pdf ? (
          <span>
            {currentPage} / {pageCount}
          </span>
        ) : null}
        <IconButton
          label={t.previewDetails}
          aria-expanded={detailsOpen}
          icon={<ArtemisIcon name="info" />}
          onClick={() => setDetailsOpen((open) => !open)}
        />
      </footer>
    </section>
  );
}
