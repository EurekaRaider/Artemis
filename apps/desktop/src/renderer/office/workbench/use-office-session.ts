import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ArtifactAnnotation,
  type ArtifactSnapshot,
  type ArtifactViewState,
} from "@artemis/protocol";

import { officeEditor } from "../office-editor-state.js";
import { officeEditCopy } from "../office-edit-copy.js";

import { useWorkspaceEditHistory } from "../../workspace/workspace-edit-history.js";

interface UseOfficeSessionContext {
  readonly view: ArtifactViewState;
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
  readonly setSnapshot: import("react").Dispatch<
    import("react").SetStateAction<ArtifactSnapshot | undefined>
  >;
  readonly snapshot: ArtifactSnapshot | undefined;
  readonly onSnapshot: ((snapshot: ArtifactSnapshot) => void) | undefined;
}
export function useOfficeSession(context: UseOfficeSessionContext) {
  const { view, locale, threadId, setSnapshot, snapshot, onSnapshot } = context;
  const [dismissedError, setDismissedError] = useState<string>();
  const [error, setError] = useState<string>();
  const [staleAnnotation, setStaleAnnotation] = useState(false);
  const handledFocus = useRef<ArtifactAnnotation | undefined>(undefined);
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
  return {
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
  };
}
