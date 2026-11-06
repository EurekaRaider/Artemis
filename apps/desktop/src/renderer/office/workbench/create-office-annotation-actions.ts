import {
  artifactAnnotationSchema,
  type ArtifactAnnotation,
  type ArtifactSelection,
} from "@artemis/protocol";

import { officeSelectionLabel } from "../office-annotations.js";

interface CreateOfficeAnnotationActionsContext {
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
  readonly selection:
    | {
        value: ArtifactSelection;
        version: number;
        quote?: string | undefined;
      }
    | undefined;
  readonly note: string;
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
  readonly sessionId: string;
  readonly setError: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly onAnnotate: (annotation: ArtifactAnnotation) => void | boolean;
  readonly setNote: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly setAnnotationOpen: import("react").Dispatch<
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
}
export function createOfficeAnnotationActions(
  context: CreateOfficeAnnotationActionsContext,
) {
  const {
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
  } = context;
  function selectionLabel(value: ArtifactSelection): string {
    return officeSelectionLabel(value, locale);
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
      ...(selection.quote ? { quote: selection.quote } : {}),
      text: note,
    });
    if (!parsed.success) {
      setError(parsed.error.message);
      return;
    }
    if (onAnnotate(parsed.data) === false) return;
    setNote("");
    setAnnotationOpen(false);
    setSelection(undefined);
  }
  return { selectionLabel, addNote };
}
