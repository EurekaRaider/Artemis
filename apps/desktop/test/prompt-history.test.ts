import { describe, expect, it } from "vitest";

import {
  addPromptHistoryEntry,
  navigatePromptHistory,
  promptHistoryForConversation,
} from "../src/renderer/prompt-history.js";

describe("prompt history", () => {
  it("keeps unique prompts in most-recently-used order", () => {
    expect(
      addPromptHistoryEntry(["second", "first", "older"], " first "),
    ).toEqual(["first", "second", "older"]);
    expect(addPromptHistoryEntry(["first"], "   ")).toEqual(["first"]);
  });

  it("walks backward through history and stops at the oldest prompt", () => {
    const first = navigatePromptHistory(
      ["newest", "oldest"],
      "draft",
      { index: -1, draft: "" },
      "previous",
    );
    expect(first).toEqual({
      index: 0,
      draft: "draft",
      value: "newest",
    });

    const second = navigatePromptHistory(
      ["newest", "oldest"],
      first!.value,
      first!,
      "previous",
    );
    expect(second).toEqual({
      index: 1,
      draft: "draft",
      value: "oldest",
    });

    expect(
      navigatePromptHistory(
        ["newest", "oldest"],
        second!.value,
        second!,
        "previous",
      ),
    ).toEqual(second);
  });

  it("walks forward and restores the draft after the newest prompt", () => {
    const next = navigatePromptHistory(
      ["newest", "oldest"],
      "oldest",
      { index: 1, draft: "unfinished draft" },
      "next",
    );
    expect(next).toEqual({
      index: 0,
      draft: "unfinished draft",
      value: "newest",
    });

    expect(
      navigatePromptHistory(["newest", "oldest"], next!.value, next!, "next"),
    ).toEqual({
      index: -1,
      draft: "unfinished draft",
      value: "unfinished draft",
    });
  });

  it("leaves arrow keys untouched when there is no history to browse", () => {
    expect(
      navigatePromptHistory([], "draft", { index: -1, draft: "" }, "previous"),
    ).toBeUndefined();
    expect(
      navigatePromptHistory(
        ["newest"],
        "draft",
        { index: -1, draft: "" },
        "next",
      ),
    ).toBeUndefined();
  });

  it("uses only the active conversation history after its first message", () => {
    expect(
      promptHistoryForConversation(
        ["global newest", "global older"],
        ["first task prompt", "second task prompt", "first task prompt"],
      ),
    ).toEqual(["first task prompt", "second task prompt"]);
    expect(promptHistoryForConversation(["global newest"], undefined)).toEqual([
      "global newest",
    ]);
    expect(promptHistoryForConversation(["global newest"], [])).toEqual([]);
  });
});
