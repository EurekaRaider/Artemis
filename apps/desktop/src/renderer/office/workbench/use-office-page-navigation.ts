import { useEffect } from "react";
import { type ArtifactSelection } from "@artemis/protocol";

import type { PDFDocumentProxy } from "pdfjs-dist";

interface UseOfficePageNavigationContext {
  readonly session: {
    protocolVersion: 1;
    documentId: string;
    sessionId: string;
    path: string;
    format: "excel" | "powerpoint" | "word";
    engineVersion: string;
    version: number;
    savedVersion: number;
    savePath?: string | undefined;
    previewVersion: number | null;
    sequence: number;
    status:
      | "closed"
      | "conflict"
      | "editing"
      | "failed"
      | "opening"
      | "recovering"
      | "saved"
      | "saving";
    error?: string | undefined;
  };
  readonly sheetView: string;
  readonly pdf:
    | {
        document: PDFDocumentProxy;
        version: number;
      }
    | undefined;
  readonly page: number;
  readonly scrollPage: import("react").RefObject<
    number | undefined | undefined
  >;
  readonly pageScroll: import("react").RefObject<HTMLDivElement | null>;
  readonly editor: import("../office-editor-state.js").OfficeEditorState;
  readonly error: string | undefined;
  readonly setDismissedError: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setSelection: import("react").Dispatch<
    import("react").SetStateAction<
      | {
          value: ArtifactSelection;
          version: number;
          quote?: string | undefined;
        }
      | undefined
    >
  >;
  readonly setFollowPaused: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
}
export function useOfficePageNavigation(
  context: UseOfficePageNavigationContext,
) {
  const {
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
  } = context;
  const isSheet = session.format === "excel";
  const showGrid = isSheet && sheetView === "grid";
  const pageCount = pdf?.document.numPages ?? 1;
  const currentPage = Math.min(page, pageCount);
  const continuous = !showGrid;
  useEffect(() => {
    if (!continuous || !pdf) return;
    if (scrollPage.current === currentPage) {
      scrollPage.current = undefined;
      return;
    }
    pageScroll.current
      ?.querySelector(`[data-page-number="${currentPage}"]`)
      ?.scrollIntoView({ block: "start" });
  }, [currentPage, continuous, pdf]);
  const displayedError = editor.error ?? error ?? session.error;
  useEffect(() => {
    setDismissedError(undefined);
  }, [displayedError]);
  const clearSelection = () => {
    setSelection(undefined);
    setFollowPaused(true);
  };
  return {
    isSheet,
    showGrid,
    pageCount,
    currentPage,
    continuous,
    displayedError,
    clearSelection,
  };
}
