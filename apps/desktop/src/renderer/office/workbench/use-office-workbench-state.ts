import { reviewDraftSchema } from "./review-draft-schema.js";

import { useEffect, useRef, useState } from "react";
import {
  type ArtifactSelection,
  type ArtifactSnapshot,
  type ArtifactViewState,
} from "@artemis/protocol";

import type { PDFDocumentProxy } from "pdfjs-dist";

import { officeCopy } from "../office-copy.js";

import {
  readLocalDraft,
  writeLocalDraft,
} from "../../workspace/workspace-autosave.js";
import { officeReviewCopy } from "../office-review-copy.js";

import {
  booleanUiState,
  officeZoomState,
  officeSheetViewState,
  usePersistentUiState,
} from "../../app/ui-state.js";

interface UseOfficeWorkbenchStateContext {
  readonly locale:
    | "ar"
    | "de"
    | "en"
    | "es"
    | "fr"
    | "hi"
    | "id"
    | "it"
    | "ja"
    | "ko"
    | "pt-BR"
    | "ru"
    | "zh-CN"
    | "zh-TW";
  readonly threadId: string;
  readonly view: ArtifactViewState;
}
export function useOfficeWorkbenchState(
  context: UseOfficeWorkbenchStateContext,
) {
  const { locale, threadId, view } = context;
  const t = officeCopy(locale);
  const review = officeReviewCopy(locale);
  const draftKey = `artemis-office-review:${threadId}:${view.session.sessionId}`;
  const [savedDraft] = useState(() => {
    const parsed = reviewDraftSchema.safeParse(readLocalDraft(draftKey));
    return parsed.success ? parsed.data : undefined;
  });
  const [snapshot, setSnapshot] = useState<ArtifactSnapshot>();
  const [pdf, setPdf] = useState<{
    document: PDFDocumentProxy;
    version: number;
  }>();
  const [page, setPage] = useState(
    savedDraft?.selection?.value.kind === "region" ||
      savedDraft?.selection?.value.kind === "object"
      ? savedDraft.selection.value.page
      : 1,
  );
  const [zoom, setZoom] = usePersistentUiState<string>(
    `artemis-office-zoom:${view.session.format}`,
    officeZoomState,
    view.session.format === "powerpoint" ? "page" : "width",
  );
  const [annotationOpen, setAnnotationOpen] = useState(
    savedDraft?.open === true,
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [preferredSheetView, setPreferredSheetView] =
    usePersistentUiState<string>(
      "artemis-office-sheet-view",
      officeSheetViewState,
      "grid",
    );
  const [sheetViewOverride, setSheetViewOverride] = useState<string>();
  const sheetView = sheetViewOverride ?? preferredSheetView;
  const setSheetView = (value: string) => {
    setSheetViewOverride(undefined);
    setPreferredSheetView(value);
  };
  const [followPreference, setFollowPreference] = usePersistentUiState(
    "artemis-office-follow",
    booleanUiState,
    true,
  );
  const [followPaused, setFollowPaused] = useState(false);
  const follow = followPreference && !followPaused;
  const [sheet, setSheet] = useState(
    savedDraft?.selection?.value.kind === "cells"
      ? savedDraft.selection.value.sheet
      : "",
  );
  const [sheetPages, setSheetPages] = useState<Record<string, number>>({});
  const mappedSheet = useRef<string | undefined>(undefined);
  const [range, setRange] = useState("A1");
  const [note, setNote] = useState(
    typeof savedDraft?.note === "string" ? savedDraft.note.slice(0, 8192) : "",
  );
  const [selection, setSelection] = useState<
    | {
        value: ArtifactSelection;
        version: number;
        quote?: string | undefined;
      }
    | undefined
  >(savedDraft?.selection);
  useEffect(() => {
    writeLocalDraft(draftKey, {
      protocolVersion: 1,
      open: annotationOpen,
      note,
      selection,
    });
  }, [draftKey, annotationOpen, note, selection]);
  const stage = useRef<HTMLDivElement>(null);
  const pageScroll = useRef<HTMLDivElement>(null);
  const scrollPage = useRef<number | undefined>(undefined);
  const annotationPanel = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number }>();
  const moving = useRef<
    { x: number; y: number; left: number; top: number } | undefined
  >(undefined);
  return {
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
  };
}
