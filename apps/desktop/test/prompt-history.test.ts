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
      "",
      { index: -1, draft: "" },
      "previous",
    );
    expect(first).toEqual({
      index: 0,
      draft: "",
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
      draft: "",
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

  it("walks forward and returns to empty input after the newest prompt", () => {
    const next = navigatePromptHistory(
      ["newest", "oldest"],
      "oldest",
      { index: 1, draft: "" },
      "next",
    );
    expect(next).toEqual({
      index: 0,
      draft: "",
      value: "newest",
    });

    expect(
      navigatePromptHistory(["newest", "oldest"], next!.value, next!, "next"),
    ).toEqual({
      index: -1,
      draft: "",
      value: "",
    });
  });

  it.each(["draft", "newest", " ", "\n", "first line\nsecond line"])(
    "preserves manually entered content %j for both arrow directions",
    (value) => {
      for (const direction of ["previous", "next"] as const) {
        expect(
          navigatePromptHistory(
            ["newest", "oldest"],
            value,
            { index: -1, draft: value },
            direction,
          ),
        ).toBeUndefined();
      }
    },
  );

  it("stops browsing after editing recalled text and resumes after clearing", () => {
    const history = ["newest", "oldest"];
    const recalled = navigatePromptHistory(
      history,
      "",
      { index: -1, draft: "" },
      "previous",
    )!;
    const edited = `${recalled.value} edited`;
    // The composer's onChange resets navigation whenever the user edits.
    const stateAfterEdit = { index: -1, draft: edited };
    expect(
      navigatePromptHistory(history, edited, stateAfterEdit, "previous"),
    ).toBeUndefined();
    expect(
      navigatePromptHistory(history, edited, stateAfterEdit, "next"),
    ).toBeUndefined();
    expect(
      navigatePromptHistory(history, "", { index: -1, draft: "" }, "previous"),
    ).toEqual(recalled);
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
