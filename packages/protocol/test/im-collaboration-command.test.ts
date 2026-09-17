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

it.each([
  { action: "wait" },
  { action: "wait", taskIds: ["a"], text: "" },
  { action: "wait", taskIds: ["a"], text: "Continue", waitSeconds: 61 },
  { action: "wait", taskIds: ["a"], text: "Continue", timeoutSeconds: 0 },
  { action: "status", taskIds: ["a"] },
])("rejects invalid durable waits: %j", (command) => {
  expect(() => collaborationCommandSchema.parse(command)).toThrow();
});
it("accepts immediate durable waits with a bounded deadline", () => {
  expect(
    collaborationCommandSchema.parse({
      action: "wait",
      taskIds: ["a"],
      text: "Review",
      waitSeconds: 0,
      timeoutSeconds: 3600,
    }),
  ).toMatchObject({ action: "wait", waitSeconds: 0 });
});
