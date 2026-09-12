import {
  MAX_PROMPT_ATTACHMENTS,
  MAX_PROMPT_IMAGES,
  MAX_PROMPT_FILES,
  MAX_PROMPT_TOTAL_BYTES,
  attachmentIsImage,
  attachmentBytes,
  type PromptAttachment,
} from "@artemis/protocol";

export interface ComposerDraft {
  prompt: string;
  selectedSkillNames: string[];
  attachments: PromptAttachment[];
  /**
   * Structured @ sub-agent task blocks. Ride the draft so per-thread
   * composition keeps it; the send path mints the invocationId per
   * submission. Each block retains its own text and stable UI identity.
   */
  customAgentTasks?: CustomAgentDraftTask[];
}

/**
 * Renderer-side @ chip state. revision is pinned at selection time so the
 * main process can reject a stale reference with CUSTOM_AGENT_REVISION_CONFLICT;
 * name/color are display caches for the chip only.
 */
export interface CustomAgentDraftReference {
  definitionId: string;
  revision: number;
  name: string;
  color: string;
}

export interface CustomAgentDraftTask extends CustomAgentDraftReference {
  id: string;
  text: string;
}

export type ComposerDrafts = Record<string, ComposerDraft>;

const EMPTY_COMPOSER_DRAFT: ComposerDraft = {
  prompt: "",
  selectedSkillNames: [],
  attachments: [],
};

function isPromptImage(attachment: PromptAttachment): boolean {
  return attachmentIsImage(attachment);
}

const GENERIC_CLIPBOARD_IMAGE_NAME =
  /^(?:image|pasted-image)(?:[-_ ]?\d+)?\.(?:gif|jpe?g|png|webp)$/iu;

function imageExtension(mimeType: string): string {
  return mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length);
}

function uniqueAttachment(
  attachment: PromptAttachment,
  usedNames: Set<string>,
  imageSequence: number,
): PromptAttachment {
  const original = attachment.name.trim();
  let name = original;
  if (
    isPromptImage(attachment) &&
    GENERIC_CLIPBOARD_IMAGE_NAME.test(original)
  ) {
    let sequence = imageSequence;
    do {
      name = `image-${sequence}.${imageExtension(attachment.mimeType)}`;
      sequence += 1;
    } while (usedNames.has(name.toLocaleLowerCase()));
  } else if (usedNames.has(name.toLocaleLowerCase())) {
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    let sequence = 2;
    do {
      name = `${base}-${sequence}${extension}`;
      sequence += 1;
    } while (usedNames.has(name.toLocaleLowerCase()));
  }
  usedNames.add(name.toLocaleLowerCase());
  return name === attachment.name ? attachment : { ...attachment, name };
}

export function appendPromptAttachments(
  current: readonly PromptAttachment[],
  selected: readonly PromptAttachment[],
): { attachments: PromptAttachment[]; limited: boolean } {
  const attachments = [...current];
  let imageCount = attachments.filter(isPromptImage).length;
  const usedNames = new Set(
    attachments.map((attachment) => attachment.name.toLocaleLowerCase()),
  );
  let limited = false;
  for (const attachment of selected) {
    if (
      attachments.length >= MAX_PROMPT_ATTACHMENTS ||
      (isPromptImage(attachment) && imageCount >= MAX_PROMPT_IMAGES) ||
      (!isPromptImage(attachment) &&
        attachments.length - imageCount >= MAX_PROMPT_FILES) ||
      attachments.reduce((sum, item) => sum + attachmentBytes(item), 0) +
        attachmentBytes(attachment) >
        MAX_PROMPT_TOTAL_BYTES
    ) {
      limited = true;
      continue;
    }
    const normalized = uniqueAttachment(attachment, usedNames, imageCount + 1);
    attachments.push(normalized);
    if (isPromptImage(normalized)) imageCount += 1;
  }
  return { attachments, limited };
}

export class PromptAttachmentReadQueue {
  readonly #pending = new Set<Promise<unknown>>();

  track<T>(read: Promise<T>): Promise<T> {
    this.#pending.add(read);
    void read.then(
      () => this.#pending.delete(read),
      () => this.#pending.delete(read),
    );
    return read;
  }

  async waitForIdle(): Promise<void> {
    while (this.#pending.size > 0) {
      await Promise.allSettled([...this.#pending]);
    }
  }
}

export class PromptAttachmentReadQueues {
  readonly #queues = new Map<string, PromptAttachmentReadQueue>();

  track<T>(draftKey: string, read: Promise<T>): Promise<T> {
    let queue = this.#queues.get(draftKey);
    if (!queue) {
      queue = new PromptAttachmentReadQueue();
      this.#queues.set(draftKey, queue);
    }
    return queue.track(read);
  }

  async waitForIdle(draftKey: string): Promise<void> {
    await this.#queues.get(draftKey)?.waitForIdle();
  }
}

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

export function restoreComposerQueueItems(
  drafts: ComposerDrafts,
  key: string,
  items: readonly {
    text: string;
    attachments?: readonly PromptAttachment[];
  }[],
): ComposerDrafts {
  const restored = restoreComposerMessages(
    drafts,
    key,
    items.map((item) => item.text),
  );
  const attachments = items.flatMap((item) => item.attachments ?? []);
  if (attachments.length === 0) return restored;
  return updateComposerDraft(restored, key, (current) => ({
    ...current,
    attachments: appendPromptAttachments(current.attachments, attachments)
      .attachments,
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
