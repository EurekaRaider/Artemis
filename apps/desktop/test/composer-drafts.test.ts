import { describe, expect, it } from "vitest";

import {
  appendPromptAttachments,
  clearComposerDraft,
  composerDraftFor,
  conversationDraftKey,
  moveComposerDraft,
  PromptAttachmentReadQueue,
  PromptAttachmentReadQueues,
  restoreComposerMessages,
  restoreComposerQueueItems,
  updateComposerDraft,
  type ComposerDrafts,
} from "../src/renderer/composer-drafts.js";

describe("conversation composer drafts", () => {
  it("waits for a pasted image read before the mixed prompt is submitted", async () => {
    const queue = new PromptAttachmentReadQueue();
    let finishRead!: () => void;
    const read = new Promise<void>((resolve) => {
      finishRead = resolve;
    });
    queue.track(read);
    let submitted = false;
    const submit = queue.waitForIdle().then(() => {
      submitted = true;
    });

    await Promise.resolve();
    expect(submitted).toBe(false);
    finishRead();
    await submit;
    expect(submitted).toBe(true);
  });

  it("waits only for attachment reads owned by the submitted conversation", async () => {
    const queues = new PromptAttachmentReadQueues();
    let finishFirst!: () => void;
    queues.track(
      "thread:first",
      new Promise<void>((resolve) => {
        finishFirst = resolve;
      }),
    );

    await expect(queues.waitForIdle("thread:second")).resolves.toBeUndefined();
    let firstSettled = false;
    const first = queues.waitForIdle("thread:first").then(() => {
      firstSettled = true;
    });
    await Promise.resolve();
    expect(firstSettled).toBe(false);
    finishFirst();
    await first;
  });

  it("adds pasted images without replacing text-era draft attachments", () => {
    const existing = {
      type: "file" as const,
      name: "notes.txt",
      mimeType: "text/plain",
      content: "notes",
    };
    const pasted = {
      name: "screenshot.png",
      mimeType: "image/png" as const,
      data: "iVBORw==",
    };

    expect(appendPromptAttachments([existing], [pasted])).toEqual({
      attachments: [existing, pasted],
      limited: false,
    });
  });

  it("keeps unsent prompts isolated and restores them per conversation", () => {
    const firstKey = conversationDraftKey("project-1", "thread-1");
    const secondKey = conversationDraftKey("project-1", "thread-2");
    let drafts: ComposerDrafts = {};

    drafts = updateComposerDraft(drafts, firstKey, (current) => ({
      ...current,
      prompt: "unfinished in conversation one",
    }));

    expect(composerDraftFor(drafts, secondKey).prompt).toBe("");
    expect(composerDraftFor(drafts, firstKey).prompt).toBe(
      "unfinished in conversation one",
    );
  });

  it("isolates the complete composer draft and clears only its owner", () => {
    const firstKey = conversationDraftKey("project-1", "thread-1");
    const secondKey = conversationDraftKey("project-1", "thread-2");
    let drafts = updateComposerDraft({}, firstKey, (current) => ({
      ...current,
      prompt: "inspect this",
      selectedSkillNames: ["pdf"],
      attachments: [
        {
          type: "file",
          name: "notes.txt",
          mimeType: "text/plain",
          content: "draft notes",
        },
      ],
    }));
    drafts = updateComposerDraft(drafts, secondKey, (current) => ({
      ...current,
      prompt: "other conversation",
    }));

    drafts = clearComposerDraft(drafts, firstKey);

    expect(composerDraftFor(drafts, firstKey)).toMatchObject({
      prompt: "",
      selectedSkillNames: [],
      attachments: [],
    });
    expect(composerDraftFor(drafts, secondKey).prompt).toBe(
      "other conversation",
    );
  });

  it("uses a separate new-conversation draft for each project", () => {
    expect(conversationDraftKey("project-1", undefined)).not.toBe(
      conversationDraftKey("project-2", undefined),
    );
  });

  it("moves an unsent new-conversation draft when a workspace tool materializes its task", () => {
    const draftKey = conversationDraftKey("project-1", undefined);
    const threadKey = conversationDraftKey("project-1", "thread-1");
    const drafts = updateComposerDraft({}, draftKey, (current) => ({
      ...current,
      prompt: "keep this draft",
      selectedSkillNames: ["pdf"],
    }));

    const moved = moveComposerDraft(drafts, draftKey, threadKey);

    expect(moved).not.toHaveProperty(draftKey);
    expect(composerDraftFor(moved, threadKey)).toMatchObject({
      prompt: "keep this draft",
      selectedSkillNames: ["pdf"],
    });
  });

  it("restores unexecuted queued messages ahead of the existing draft", () => {
    const key = conversationDraftKey("project-1", "thread-1");
    const drafts = updateComposerDraft({}, key, (current) => ({
      ...current,
      prompt: "new draft text",
    }));

    const restored = restoreComposerMessages(drafts, key, [
      "first unexecuted message",
      "second unexecuted message",
    ]);

    expect(composerDraftFor(restored, key).prompt).toBe(
      "first unexecuted message\n\nsecond unexecuted message\n\nnew draft text",
    );
  });

  it("restores queued image attachments only to their owning conversation", () => {
    const firstKey = conversationDraftKey("project-1", "thread-1");
    const secondKey = conversationDraftKey("project-1", "thread-2");

    const restored = restoreComposerQueueItems({}, firstKey, [
      {
        text: "inspect screenshot",
        attachments: [
          {
            name: "screenshot.png",
            mimeType: "image/png",
            data: "iVBORw==",
          },
        ],
      },
    ]);

    expect(composerDraftFor(restored, firstKey).attachments).toHaveLength(1);
    expect(composerDraftFor(restored, secondKey).attachments).toEqual([]);
  });
});
