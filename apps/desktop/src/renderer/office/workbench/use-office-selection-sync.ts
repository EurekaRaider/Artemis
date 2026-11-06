import { useEffect } from "react";
import {
  type ArtifactAnnotation,
  type ArtifactSelection,
  type ArtifactSnapshot,
  type ArtifactViewState,
} from "@artemis/protocol";

import type { PDFDocumentProxy } from "pdfjs-dist";

interface UseOfficeSelectionSyncContext {
  readonly annotationFocus:
    | {
        protocolVersion: 1;
        id: string;
        documentId: string;
        sessionId: string;
        sourceVersion: number;
        selection:
          | {
              kind: "paragraph";
              index: number;
              start: number;
              end: number;
            }
          | {
              kind: "object";
              page: number;
              index: number;
              path?: number[] | undefined;
              cell?:
                | {
                    row: number;
                    column: number;
                  }
                | undefined;
            }
          | {
              kind: "cells";
              sheet: string;
              range: string;
            }
          | {
              kind: "region";
              page: number;
              x: number;
              y: number;
              width: number;
              height: number;
            };
        quote?: string | undefined;
        text: string;
      }
    | undefined;
  readonly snapshot: ArtifactSnapshot | undefined;
  readonly handledFocus: import("react").RefObject<
    ArtifactAnnotation | undefined | undefined
  >;
  readonly setFollowPaused: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setAnnotationOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly sessionId: string;
  readonly setStaleAnnotation: import("react").Dispatch<
    import("react").SetStateAction<boolean>
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
  readonly setPage: import("react").Dispatch<
    import("react").SetStateAction<number>
  >;
  readonly setSheet: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setRange: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setSheetViewOverride: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly follow: boolean;
  readonly view: ArtifactViewState;
  readonly annotationOpen: boolean;
  readonly selection:
    | {
        value: ArtifactSelection;
        version: number;
        quote?: string | undefined;
      }
    | undefined;
  readonly pdf:
    | {
        document: PDFDocumentProxy;
        version: number;
      }
    | undefined;
}
export function useOfficeSelectionSync(context: UseOfficeSelectionSyncContext) {
  const {
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
  } = context;
  useEffect(() => {
    if (
      !annotationFocus ||
      !snapshot ||
      handledFocus.current === annotationFocus
    )
      return;
    handledFocus.current = annotationFocus;
    setFollowPaused(true);
    setAnnotationOpen(false);
    const sameVersion =
      annotationFocus.documentId === snapshot.session.documentId &&
      annotationFocus.sessionId === sessionId &&
      annotationFocus.sourceVersion === snapshot.session.version;
    setStaleAnnotation(!sameVersion);
    if (!sameVersion) {
      setSelection(undefined);
      return;
    }
    const value = annotationFocus.selection;
    setSelection({ value, version: annotationFocus.sourceVersion });
    if (value.kind === "region" || value.kind === "object") setPage(value.page);
    if (value.kind === "cells") {
      setSheet(value.sheet);
      setRange(value.range);
      setSheetViewOverride("grid");
    }
  }, [annotationFocus, snapshot, sessionId]);
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
  const navigationSelection = follow
    ? view.selection
    : selection?.version === snapshot?.session.version
      ? selection?.value
      : undefined;
  useEffect(() => {
    if (
      annotationOpen ||
      !pdf ||
      navigationSelection?.kind !== "paragraph" ||
      !snapshot ||
      pdf.version !== snapshot.session.version
    )
      return;
    const index = navigationSelection.index;
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
  }, [pdf, snapshot, navigationSelection, annotationOpen]);
  return {};
}
