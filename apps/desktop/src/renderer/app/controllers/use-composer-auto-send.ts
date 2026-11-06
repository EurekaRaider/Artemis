import { useEffect, type SetStateAction } from "react";

import type { InstalledSkill, ReviewComment } from "../../../shared/api.js";

interface UseComposerAutoSendContext {
  readonly designPanelAutoSendText: import("react").RefObject<{
    draftKey: string;
    text: string;
  } | null | null>;
  readonly activeComposerDraftKey: string;
  readonly designPanelCredentials: import("react").RefObject<
    Map<
      string,
      {
        text: string;
        credential: string;
      }
    >
  >;
  readonly prompt: string;
  readonly busy: boolean;
  readonly retiredGroup: "archived" | "dissolved" | undefined;
  readonly sendPrompt: () => Promise<void>;
  readonly reviewCommentAutoSendText: import("react").RefObject<{
    draftKey: string;
    text: string;
  } | null | null>;
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
  readonly selectedSkills: InstalledSkill[];
  readonly customAgentTasks: import("../../conversation/composer-drafts.js").CustomAgentDraftTask[];
  readonly saveReviewComment: (
    lineId: string,
  ) => Promise<ReviewComment | undefined>;
  readonly activeThreadIdRef: import("react").RefObject<string | undefined>;
  readonly setPrompt: (action: SetStateAction<string>) => void;
}
export function useComposerAutoSend(context: UseComposerAutoSendContext) {
  const {
    designPanelAutoSendText,
    activeComposerDraftKey,
    designPanelCredentials,
    prompt,
    busy,
    retiredGroup,
    sendPrompt,
    reviewCommentAutoSendText,
    attachments,
    selectedSkills,
    customAgentTasks,
    saveReviewComment,
    activeThreadIdRef,
    setPrompt,
  } = context;
  useEffect(() => {
    const pending = designPanelAutoSendText.current;
    if (pending == null || pending.draftKey !== activeComposerDraftKey) return;
    if (prompt.trim() !== pending.text) {
      designPanelAutoSendText.current = null;
      const candidate = designPanelCredentials.current.get(
        activeComposerDraftKey,
      );
      designPanelCredentials.current.delete(activeComposerDraftKey);
      if (candidate)
        void window.artemis
          .discardDesignPanelCandidate(candidate.credential)
          .catch(() => undefined);
      return;
    }
    if (busy || retiredGroup) return;
    designPanelAutoSendText.current = null;
    void sendPrompt();
  }, [activeComposerDraftKey, busy, prompt, retiredGroup, sendPrompt]);

  // Review comments use the ordinary composer submission path, including
  // its run mode, follow-up queue and approval checks. Never replace a draft.
  useEffect(() => {
    const pending = reviewCommentAutoSendText.current;
    if (!pending) return;
    if (
      pending.draftKey !== activeComposerDraftKey ||
      prompt.trim() !== pending.text ||
      attachments.length > 0 ||
      selectedSkills.length > 0 ||
      customAgentTasks.length > 0
    ) {
      reviewCommentAutoSendText.current = null;
      return;
    }
    if (busy || retiredGroup) return;
    reviewCommentAutoSendText.current = null;
    void sendPrompt();
  }, [
    activeComposerDraftKey,
    attachments.length,
    busy,
    customAgentTasks.length,
    prompt,
    retiredGroup,
    selectedSkills.length,
    sendPrompt,
  ]);

  const sendReviewComment = async (lineId: string) => {
    if (
      busy ||
      retiredGroup ||
      prompt.trim() ||
      attachments.length ||
      selectedSkills.length ||
      customAgentTasks.length
    )
      return;
    const comment = await saveReviewComment(lineId);
    if (!comment || activeThreadIdRef.current !== comment.threadId) return;
    const text = `${comment.path}:${comment.newLine ?? comment.oldLine ?? 1}\n\n${comment.body}`;
    reviewCommentAutoSendText.current = {
      draftKey: activeComposerDraftKey,
      text,
    };
    setPrompt((current) => (current.trim() ? current : text));
  };
  return { sendReviewComment };
}
