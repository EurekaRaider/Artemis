import { describe, expect, it } from "vitest";
import {
  browserSessionCommandSchema,
  browserHumanInputSchema,
  computerPreviewCommandSchema,
} from "../src/index.js";
describe("preview IPC boundaries", () => {
  it("accepts bounded real input without accepting scripts, handles, or arbitrary CDP", () => {
    expect(
      browserHumanInputSchema.safeParse({
        type: "composition",
        text: "你好",
        selectionStart: 2,
        selectionEnd: 2,
      }).success,
    ).toBe(true);
    for (const input of [
      { type: "script", script: "process.exit()" },
      { type: "cdp", method: "Runtime.evaluate" },
      { type: "text", text: "a".repeat(16001) },
      { type: "mouseMove", x: -1, y: 0, button: "left", clickCount: 0 },
      { type: "text", text: "hello", ntHandle: "123" },
    ])
      expect(browserHumanInputSchema.safeParse(input).success).toBe(false);
  });
  it("requires owned tab identity, subscription tokens, and bounded dimensions", () => {
    expect(
      browserSessionCommandSchema.safeParse({
        action: "subscribe",
        threadId: "task",
        tabId: "tab",
        token: "bad",
        width: 1280,
        height: 720,
      }).success,
    ).toBe(false);
    expect(
      browserSessionCommandSchema.safeParse({
        action: "open",
        threadId: "task",
        tabId: "tab",
        contentsId: 42,
      }).success,
    ).toBe(false);
    expect(
      computerPreviewCommandSchema.safeParse({
        action: "subscribe",
        sessionId: "7b024335-93fc-46b2-a846-5c74ec0d68fd",
        token: "7b024335-93fc-46b2-a846-5c74ec0d68fd",
      }).success,
    ).toBe(true);
  });
});
