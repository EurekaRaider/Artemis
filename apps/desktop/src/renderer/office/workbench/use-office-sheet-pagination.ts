import { useEffect } from "react";
import {
  type ArtifactSnapshot,
  type ArtifactViewState,
} from "@artemis/protocol";

import type { PDFDocumentProxy } from "pdfjs-dist";

interface UseOfficeSheetPaginationContext {
  readonly sheet: string;
  readonly snapshot: ArtifactSnapshot | undefined;
  readonly setSheetPages: import("react").Dispatch<
    import("react").SetStateAction<Record<string, number>>
  >;
  readonly pdf:
    | {
        document: PDFDocumentProxy;
        version: number;
      }
    | undefined;
  readonly sheetPages: Record<string, number>;
  readonly mappedSheet: import("react").RefObject<
    string | undefined | undefined
  >;
  readonly setPage: import("react").Dispatch<
    import("react").SetStateAction<number>
  >;
  readonly follow: boolean;
  readonly view: ArtifactViewState;
}
export function useOfficeSheetPagination(
  context: UseOfficeSheetPaginationContext,
) {
  const {
    sheet,
    snapshot,
    setSheetPages,
    pdf,
    sheetPages,
    mappedSheet,
    setPage,
    follow,
    view,
  } = context;
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
  return { currentSheet };
}
