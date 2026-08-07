import { describe, expect, it } from "vitest";

import {
  clearComposerDraft,
  composerDraftFor,
  conversationDraftKey,
  moveComposerDraft,
  restoreComposerMessages,
  updateComposerDraft,
  type ComposerDrafts,
} from "../src/renderer/composer-drafts.js";

describe("conversation composer drafts", () => {
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
});
