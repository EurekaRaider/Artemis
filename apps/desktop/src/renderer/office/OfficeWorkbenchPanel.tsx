import { useOfficeWorkbenchState } from "./workbench/use-office-workbench-state.js";
import { useOfficeAnnotationPosition } from "./workbench/use-office-annotation-position.js";
import { useOfficeSession } from "./workbench/use-office-session.js";
import { useOfficePdfPreview } from "./workbench/use-office-pdf-preview.js";
import { useOfficeSelectionSync } from "./workbench/use-office-selection-sync.js";
import { useOfficeSheetPagination } from "./workbench/use-office-sheet-pagination.js";
import { createOfficeAnnotationActions } from "./workbench/create-office-annotation-actions.js";
import { useOfficePageNavigation } from "./workbench/use-office-page-navigation.js";
import { useOfficeSlideNavigation } from "./workbench/use-office-slide-navigation.js";
import { createOfficeSelectionOptions } from "./workbench/create-office-selection-options.js";
import { uiText } from "../../shared/i18n/ui-text.js";

import {
  type AppLocale,
  type ArtifactAnnotation,
  type ArtifactSelection,
  type ArtifactSnapshot,
  type ArtifactViewState,
} from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
import { Switch, Select, TextAreaField, TextField } from "@artemis/ui/forms";
import { InlineNotice } from "@artemis/ui/feedback";

import { ArtemisIcon } from "@artemis/ui/icons";
import { OfficePreviewPage } from "./OfficePreviewPage.js";
import { OfficeSpreadsheet } from "./OfficeSpreadsheet.js";
import { officeAnnotationCopy } from "./office-annotation-copy.js";

import "./office-workbench.css";

import { WorkspaceFileIcon } from "../workspace/WorkspaceFilesPanel.js";
import { filePresentation } from "../workspace/workspace-file-presentation.js";

export function OfficeWorkbenchPanel(
  props: Parameters<typeof OfficeWorkbenchContent>[0],
) {
  return (
    <OfficeWorkbenchContent
      key={`${props.threadId}:${props.view.session.sessionId}`}
      {...props}
    />
  );
}

function OfficeWorkbenchContent({
  threadId,
  view,
  locale,
  onAnnotate,
  onSnapshot,
  annotationFocus,
}: {
  threadId: string;
  view: ArtifactViewState;
  locale: AppLocale;
  onAnnotate(annotation: ArtifactAnnotation): void | boolean;
  annotationFocus?: ArtifactAnnotation | undefined;
  onSnapshot?(snapshot: ArtifactSnapshot): void;
}) {
  const useOfficeWorkbenchStateRuntime = useOfficeWorkbenchState({
    locale,
    threadId,
    view,
  });
  const {
    t,
    review,
    snapshot,
    setSnapshot,
    pdf,
    setPdf,
    page,
    setPage,
    zoom,
    setZoom,
    annotationOpen,
    setAnnotationOpen,
    detailsOpen,
    setDetailsOpen,
    setSheetViewOverride,
    sheetView,
    setSheetView,
    setFollowPreference,
    setFollowPaused,
    follow,
    sheet,
    setSheet,
    sheetPages,
    setSheetPages,
    mappedSheet,
    range,
    setRange,
    note,
    setNote,
    selection,
    setSelection,
    stage,
    pageScroll,
    scrollPage,
    annotationPanel,
    position,
    setPosition,
    moving,
  } = useOfficeWorkbenchStateRuntime;

  const useOfficeAnnotationPositionRuntime = useOfficeAnnotationPosition({
    annotationOpen,
    stage,
    annotationPanel,
    setPosition,
  });

  const useOfficeSessionRuntime = useOfficeSession({
    view,
    locale,
    threadId,
    setSnapshot,
    snapshot,
    onSnapshot,
  });
  const {
    dismissedError,
    setDismissedError,
    error,
    setError,
    staleAnnotation,
    setStaleAnnotation,
    handledFocus,
    sessionId,
    editCopy,
    editor,
    historyRef,
  } = useOfficeSessionRuntime;

  const useOfficePdfPreviewRuntime = useOfficePdfPreview({
    snapshot,
    setError,
    setPdf,
    setPage,
    threadId,
    sessionId,
  });

  const useOfficeSelectionSyncRuntime = useOfficeSelectionSync({
    annotationFocus,
    snapshot,
    handledFocus,
    setFollowPaused,
    setAnnotationOpen,
    sessionId,
    setStaleAnnotation,
    setSelection,
    setPage,
    setSheet,
    setRange,
    setSheetViewOverride,
    follow,
    view,
    annotationOpen,
    selection,
    pdf,
  });

  const useOfficeSheetPaginationRuntime = useOfficeSheetPagination({
    sheet,
    snapshot,
    setSheetPages,
    pdf,
    sheetPages,
    mappedSheet,
    setPage,
    follow,
    view,
  });
  const { currentSheet } = useOfficeSheetPaginationRuntime;

  const targets = (snapshot?.targets ?? []).filter(
    (target) =>
      target.selection.kind !== "cells" ||
      target.selection.sheet === currentSheet,
  );
  const session = snapshot?.session ?? view.session;
  const createOfficeAnnotationActionsRuntime = createOfficeAnnotationActions({
    locale,
    selection,
    note,
    session,
    sessionId,
    setError,
    onAnnotate,
    setNote,
    setAnnotationOpen,
    setSelection,
  });
  function selectionLabel(
    value: ArtifactSelection,
  ): ReturnType<typeof createOfficeAnnotationActionsRuntime.selectionLabel> {
    return createOfficeAnnotationActionsRuntime.selectionLabel(value);
  }
  function addNote(): ReturnType<
    typeof createOfficeAnnotationActionsRuntime.addNote
  > {
    return createOfficeAnnotationActionsRuntime.addNote();
  }

  const useOfficePageNavigationRuntime = useOfficePageNavigation({
    session,
    sheetView,
    pdf,
    page,
    scrollPage,
    pageScroll,
    editor,
    error,
    setDismissedError,
    setSelection,
    setFollowPaused,
  });
  const {
    isSheet,
    showGrid,
    pageCount,
    currentPage,
    continuous,
    displayedError,
    clearSelection,
  } = useOfficePageNavigationRuntime;

  const useOfficeSlideNavigationRuntime = useOfficeSlideNavigation({
    currentPage,
    pdf,
  });
  const { slides } = useOfficeSlideNavigationRuntime;

  const createOfficeSelectionOptionsRuntime = createOfficeSelectionOptions({
    session,
    selection,
    targets,
    selectionLabel,
    currentPage,
    isSheet,
    setFollowPaused,
    setSelection,
    setAnnotationOpen,
    setRange,
  });
  const {
    fileName,
    selectedValue,
    validSelection,
    quote,
    targetOptions,
    chooseSelection,
  } = createOfficeSelectionOptionsRuntime;

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
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          clearSelection();
          setAnnotationOpen(false);
        } else if (
          annotationOpen &&
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
        <span className="office-file-icon">
          <WorkspaceFileIcon
            path={session.path}
            presentation={filePresentation(session.path)}
            symlink={false}
          />
        </span>
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
          title={uiText(locale, "OfficeWorkbench.followHint")}
          checked={follow}
          onCheckedChange={(value) => {
            setFollowPreference(value);
            setFollowPaused(false);
          }}
        />
      </header>
      {staleAnnotation ? (
        <InlineNotice tone="warning">
          {officeAnnotationCopy(locale).stale}
        </InlineNotice>
      ) : null}
      {displayedError && dismissedError !== displayedError ? (
        <InlineNotice tone="warning">
          {displayedError}
          <IconButton
            label={review.dismissError}
            icon={<ArtemisIcon name="close" />}
            onClick={() => setDismissedError(displayedError)}
          />
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
          onClick={() => {
            if (annotationOpen) clearSelection();
            setAnnotationOpen((open) => !open);
          }}
        >
          {t.note}
        </Button>
      </div>
      {annotationOpen && !showGrid ? (
        <p className="office-region-hint">
          {t.region} {review.escape}
        </p>
      ) : null}
      <div className="office-stage" ref={stage}>
        <div
          ref={pageScroll}
          className="office-page-scroll"
          onScroll={() => {
            if (!continuous || !pageScroll.current) return;
            const top = pageScroll.current.getBoundingClientRect().top;
            const pages = [
              ...pageScroll.current.querySelectorAll<HTMLElement>(
                "[data-page-number]",
              ),
            ];
            const visible = pages.find(
              (item) => item.getBoundingClientRect().bottom > top + 40,
            );
            const number = Number(visible?.dataset.pageNumber);
            if (number && number !== currentPage) {
              scrollPage.current = number;
              setPage(number);
            }
          }}
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
            Array.from({ length: pageCount }, (_, index) => index + 1).map(
              (number) => (
                <OfficePreviewPage
                  key={number}
                  lazy
                  onClearSelection={clearSelection}
                  selecting={annotationOpen}
                  editor={isSheet || annotationOpen ? undefined : editor}
                  editLabel={editCopy.text}
                  document={pdf.document}
                  page={number}
                  zoom={zoom}
                  version={pdf.version}
                  label={`${t.page} ${number}`}
                  selection={
                    selection?.version === pdf.version
                      ? selection.value
                      : undefined
                  }
                  onRegion={chooseSelection}
                />
              ),
            )
          ) : (
            <div className="office-preview-empty" role="status">
              <ArtemisIcon name="document" />
              <p>{t.noPreview}</p>
            </div>
          )}
        </div>
        {annotationOpen ? (
          <section
            ref={annotationPanel}
            className="office-annotation"
            aria-label={t.note}
            style={
              position
                ? {
                    left: position.x,
                    top: position.y,
                    right: "auto",
                    bottom: "auto",
                  }
                : undefined
            }
          >
            <div
              className="office-annotation-heading"
              onPointerDown={(event) => {
                if (
                  event.button !== 0 ||
                  (event.target as HTMLElement).closest("button")
                )
                  return;
                const panel = annotationPanel.current!.getBoundingClientRect();
                const bounds = stage.current!.getBoundingClientRect();
                moving.current = {
                  x: event.clientX,
                  y: event.clientY,
                  left: panel.left - bounds.left,
                  top: panel.top - bounds.top,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (
                  !moving.current ||
                  !stage.current ||
                  !annotationPanel.current
                )
                  return;
                const move = moving.current;
                setPosition({
                  x: Math.max(
                    0,
                    Math.min(
                      stage.current.clientWidth -
                        annotationPanel.current.offsetWidth,
                      move.left + event.clientX - move.x,
                    ),
                  ),
                  y: Math.max(
                    0,
                    Math.min(
                      stage.current.clientHeight -
                        annotationPanel.current.offsetHeight,
                      move.top + event.clientY - move.y,
                    ),
                  ),
                });
              }}
              onPointerUp={(event) => {
                moving.current = undefined;
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => {
                moving.current = undefined;
              }}
              onLostPointerCapture={() => {
                moving.current = undefined;
              }}
            >
              <ArtemisIcon name="message" />
              <strong>
                {selection ? selectionLabel(selection.value) : t.note}
              </strong>
              <IconButton
                label={t.close}
                icon={<ArtemisIcon name="close" />}
                onClick={() => {
                  clearSelection();
                  setAnnotationOpen(false);
                }}
              />
            </div>
            {selection ? (
              <Button variant="quiet" onClick={clearSelection}>
                {review.clearSelection}
              </Button>
            ) : null}
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
