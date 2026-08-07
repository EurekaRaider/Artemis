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

export function restoreComposerMessages(
  drafts: ComposerDrafts,
  key: string,
  messages: readonly string[],
): ComposerDrafts {
  const restored = messages.filter(Boolean).join("\n\n");
  if (!restored) return drafts;
  return updateComposerDraft(drafts, key, (current) => ({
    ...current,
    prompt: current.prompt ? `${restored}\n\n${current.prompt}` : restored,
  }));
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
