import { useEffect } from "react";
import { type ArtifactSnapshot } from "@artemis/protocol";

import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

interface UseOfficePdfPreviewContext {
  readonly snapshot: ArtifactSnapshot | undefined;
  readonly setError: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setPdf: import("react").Dispatch<
    import("react").SetStateAction<
      | {
          document: PDFDocumentProxy;
          version: number;
        }
      | undefined
    >
  >;
  readonly setPage: import("react").Dispatch<
    import("react").SetStateAction<number>
  >;
  readonly threadId: string;
  readonly sessionId: string;
}
export function useOfficePdfPreview(context: UseOfficePdfPreviewContext) {
  const { snapshot, setError, setPdf, setPage, threadId, sessionId } = context;
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
  return {};
}
