import { appCopy } from "../app-copy.js";
import { type ToastContent } from "../app-types.js";

import {
  useCallback,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type SetStateAction,
} from "react";

import { type PromptAttachment } from "@artemis/protocol";

import {
  appendPromptAttachments,
  PromptAttachmentReadQueues,
} from "../../conversation/composer-drafts.js";

interface UsePromptAttachmentsContext {
  readonly setToast: (content: ToastContent | undefined) => void;
  readonly activeComposerDraftKey: string;
  readonly draftAttachments: import("react").RefObject<
    Map<string, import("@artemis/protocol").PromptAttachment[]>
  >;
  readonly setAttachments: (action: SetStateAction<PromptAttachment[]>) => void;
  readonly t: ReturnType<typeof appCopy>;
  readonly pendingAttachmentReads: import("react").RefObject<PromptAttachmentReadQueues>;
  readonly attachments: (
    | {
        type: "attachment";
        id: string;
        kind: "file" | "image";
        name: string;
        mimeType: string;
        size: number;
        status: "error" | "pending" | "ready";
        parseStatus?: "complete" | "error" | "processing" | undefined;
        indexVersion?: number | undefined;
        error?: string | undefined;
        pages?: number | undefined;
        characters?: number | undefined;
        width?: number | undefined;
        height?: number | undefined;
        displayWidth?: number | undefined;
        displayHeight?: number | undefined;
        thumbnail?: string | undefined;
      }
    | {
        attachmentId?: string | undefined;
        name: string;
        mimeType: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
        data: string;
      }
    | {
        type: "file";
        name: string;
        mimeType: string;
        content: string;
      }
  )[];
  readonly setAttachmentDragActive: import("react").Dispatch<
    SetStateAction<boolean>
  >;
}
export function usePromptAttachments(context: UsePromptAttachmentsContext) {
  const {
    setToast,
    activeComposerDraftKey,
    draftAttachments,
    setAttachments,
    t,
    pendingAttachmentReads,
    attachments,
    setAttachmentDragActive,
  } = context;
  const addPromptAttachments = useCallback(
    (response: import("../../../shared/api.js").AttachmentImportResponse) => {
      const selected = Array.isArray(response)
        ? response
        : response.attachments;
      if (!Array.isArray(response) && response.errors.length)
        setToast(response.errors.join("\n"));
      const { attachments: next, limited } = appendPromptAttachments(
        draftAttachments.current.get(activeComposerDraftKey) ?? [],
        selected,
      );
      draftAttachments.current.set(activeComposerDraftKey, next);
      setAttachments(next);
      if (limited) {
        setToast(t.attachmentLimit);
      }
    },
    [activeComposerDraftKey, setAttachments, t.attachmentLimit],
  );

  const selectPromptAttachments = useCallback(async () => {
    try {
      await pendingAttachmentReads.current.track(
        activeComposerDraftKey,
        window.artemis.selectPromptAttachments().then((selected) => {
          if (selected) addPromptAttachments(selected);
        }),
      );
    } catch (error) {
      setToast(
        `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [
    addPromptAttachments,
    attachments.length,
    t.attachmentLimit,
    t.taskError,
  ]);

  const handleAttachmentDragEnter = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      event.stopPropagation();
      setAttachmentDragActive(true);
    },
    [],
  );

  const handleAttachmentDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      setAttachmentDragActive(true);
    },
    [],
  );

  const handleAttachmentDragLeave = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const relatedTarget = event.relatedTarget;
      if (
        relatedTarget instanceof Node &&
        event.currentTarget.contains(relatedTarget)
      ) {
        return;
      }
      setAttachmentDragActive(false);
    },
    [],
  );

  const handleAttachmentDrop = useCallback(
    async (event: ReactDragEvent<HTMLDivElement>) => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      event.stopPropagation();
      setAttachmentDragActive(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) return;
      try {
        await pendingAttachmentReads.current.track(
          activeComposerDraftKey,
          window.artemis
            .readPromptAttachments(files)
            .then(addPromptAttachments),
        );
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [activeComposerDraftKey, addPromptAttachments, t.taskError],
  );

  const handleAttachmentPaste = useCallback(
    async (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData.files);
      if (files.length === 0) return;
      event.preventDefault();
      try {
        await pendingAttachmentReads.current.track(
          activeComposerDraftKey,
          window.artemis
            .readPromptAttachments(files)
            .then(addPromptAttachments),
        );
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [activeComposerDraftKey, addPromptAttachments, t.taskError],
  );
  return {
    addPromptAttachments,
    selectPromptAttachments,
    handleAttachmentDragEnter,
    handleAttachmentDragOver,
    handleAttachmentDragLeave,
    handleAttachmentDrop,
    handleAttachmentPaste,
  };
}
