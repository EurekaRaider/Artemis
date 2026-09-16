import { expect, it } from "vitest";
import { collaborationCommandSchema } from "../src/im.js";

it.each([
  [
    {
      action: "delegate",
      assignments: [{ participantId: "solar", text: "Memory?" }],
    },
    /delegate-many/,
  ],
  [{ action: "delegate", text: "Memory?" }, /participantId/],
  [{ action: "delegate", participantId: "solar", text: "  " }, /nonempty text/],
  [{ action: "delegate-many" }, /assignments/],
  [
    {
      action: "delegate-many",
      assignments: [{ participantId: "solar", text: "  " }],
    },
    /nonempty text/,
  ],
  [{ action: "message", participantId: "solar", text: "Memory?" }, /taskId/],
  [{ action: "message", taskId: "task", text: " " }, /nonempty text/],
  [{ action: "cancel" }, /taskId/],
  [{ action: "finish", text: " " }, /nonempty text/],
])(
  "rejects malformed collaboration commands with actionable errors: %j",
  (command, error) => {
    expect(() => collaborationCommandSchema.parse(command)).toThrow(error);
  },
);

it.each([
  { action: "participants" },
  { action: "status" },
  { action: "delegate", participantId: "solar", text: "Memory?" },
  {
    action: "delegate-many",
    assignments: [{ participantId: "solar", text: "Memory?" }],
  },
  { action: "message", taskId: "task", text: "More details?" },
  { action: "cancel", taskId: "task" },
  { action: "finish", text: "Done" },
])("accepts valid collaboration commands: %j", (command) => {
  expect(collaborationCommandSchema.parse(command)).toMatchObject(command);
});
