import type { PromptAttachment } from "@artemis/protocol";

export interface ComposerDraft {
  prompt: string;
  selectedSkillNames: string[];
  attachments: PromptAttachment[];
}

export type ComposerDrafts = Record<string, ComposerDraft>;

const EMPTY_COMPOSER_DRAFT: ComposerDraft = {
  prompt: "",
  selectedSkillNames: [],
  attachments: [],
};

export function conversationDraftKey(
  projectId: string | undefined,
  threadId: string | undefined,
): string {
  return threadId ? `thread:${threadId}` : `new:${projectId ?? ""}`;
}

export function composerDraftFor(
  drafts: ComposerDrafts,
  key: string,
): ComposerDraft {
  return drafts[key] ?? EMPTY_COMPOSER_DRAFT;
}

export function updateComposerDraft(
  drafts: ComposerDrafts,
  key: string,
  update: (current: ComposerDraft) => ComposerDraft,
): ComposerDrafts {
  return {
    ...drafts,
    [key]: update(composerDraftFor(drafts, key)),
  };
}

export function clearComposerDraft(
  drafts: ComposerDrafts,
  key: string,
): ComposerDrafts {
  if (!(key in drafts)) return drafts;
  const next = { ...drafts };
  delete next[key];
  return next;
}

export function moveComposerDraft(
  drafts: ComposerDrafts,
  sourceKey: string,
  destinationKey: string,
): ComposerDrafts {
  const draft = drafts[sourceKey];
  if (!draft || sourceKey === destinationKey) return drafts;
  const next = { ...drafts, [destinationKey]: draft };
  delete next[sourceKey];
  return next;
}
