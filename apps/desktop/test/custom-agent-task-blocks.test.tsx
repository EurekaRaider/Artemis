// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CustomAgentTaskBlocks } from "../src/renderer/CustomAgentTaskBlocks.js";
import {
  composerDraftFor,
  moveComposerDraft,
  updateComposerDraft,
  type CustomAgentDraftTask,
} from "../src/renderer/composer-drafts.js";
import "./renderer-test-utils.js";

const tasks: CustomAgentDraftTask[] = [
  {
    id: "one",
    definitionId: "review",
    revision: 1,
    name: "Reviewer",
    color: "red",
    text: "Review only",
  },
  {
    id: "two",
    definitionId: "test",
    revision: 1,
    name: "Tester",
    color: "teal",
    text: "Test only",
  },
];
function Harness() {
  const [value, setValue] = useState(tasks);
  return (
    <CustomAgentTaskBlocks
      tasks={value}
      focusTaskId={undefined}
      zh={false}
      onChange={(id, text) =>
        setValue((current) =>
          current.map((task) => (task.id === id ? { ...task, text } : task)),
        )
      }
      onRemove={(id) =>
        setValue((current) => current.filter((task) => task.id !== id))
      }
    />
  );
}
describe("sub-agent task blocks", () => {
  it("keeps text associated with its own agent when editing or deleting another block", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Task for @Reviewer"), {
      target: { value: "New review task" },
    });
    expect(screen.getByLabelText("Task for @Tester")).toHaveValue("Test only");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove task: Reviewer" }),
    );
    expect(screen.queryByLabelText("Task for @Reviewer")).toBeNull();
    expect(screen.getByLabelText("Task for @Tester")).toHaveValue("Test only");
  });
  it("preserves task ownership across thread drafts and new-thread handoff", () => {
    const drafts = updateComposerDraft({}, "new:project", () => ({
      prompt: "Summarize",
      selectedSkillNames: [],
      attachments: [],
      customAgentTasks: tasks,
    }));
    expect(
      composerDraftFor(drafts, "thread:other").customAgentTasks,
    ).toBeUndefined();
    const moved = moveComposerDraft(drafts, "new:project", "thread:created");
    expect(composerDraftFor(moved, "thread:created").customAgentTasks).toEqual(
      tasks,
    );
    expect(
      composerDraftFor(moved, "new:project").customAgentTasks,
    ).toBeUndefined();
  });
});
