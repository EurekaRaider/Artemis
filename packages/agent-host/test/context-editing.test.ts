import { expect, it, vi } from "vitest";
import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { RunMode } from "@artemis/protocol";
import { contextEditingExtension } from "../src/context-editing.js";

function fixture(mode: RunMode) {
  const hooks = new Map<string, (...args: unknown[]) => unknown>();
  let tool: ToolDefinition;
  const branch = vi.fn(() => [
    {
      id: "user",
      type: "message",
      message: { role: "user", content: "Keep these instructions" },
    },
    {
      id: "assistant",
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Obsolete answer" }],
      },
    },
    {
      id: "tool",
      type: "message",
      message: {
        role: "toolResult",
        content: [{ type: "text", text: "Old result" }],
      },
    },
  ]);
  contextEditingExtension(() => mode)({
    on: (name: string, hook: (...args: unknown[]) => unknown) =>
      hooks.set(name, hook),
    registerTool: (value: ToolDefinition) => {
      tool = value;
    },
  } as unknown as ExtensionAPI);
  return {
    branch,
    hooks,
    execute: (args: unknown) =>
      tool.execute("edit", args, new AbortController().signal, undefined, {
        sessionManager: { getBranch: branch },
      } as never),
  };
}
it("denies Plan before accessing context and prevents edits to user instructions", async () => {
  const plan = fixture("plan");
  await expect(plan.execute({})).rejects.toThrow("Work or Codemode");
  expect(plan.branch).not.toHaveBeenCalled();
  const work = fixture("work");
  await expect(
    work.execute({
      edits: [
        { entryId: "assistant", replacement: "shorter" },
        { entryId: "user", replacement: null },
      ],
    }),
  ).rejects.toThrow("Only earlier assistant");
  expect(work.hooks.get("turn_end")!()).toBeUndefined();
});
it.each(["work", "codemode"] as const)(
  "applies %s edits once at the Pi turn boundary without rewriting original entries",
  async (mode) => {
    const f = fixture(mode);
    const original = JSON.stringify(f.branch());
    const list = await f.execute({});
    expect(JSON.stringify(list)).not.toContain('"id":"user"');
    await f.execute({
      edits: [
        { entryId: "assistant", replacement: "shorter" },
        { entryId: "tool", replacement: null },
      ],
    });
    expect(JSON.stringify(f.branch())).toBe(original);
    expect(f.hooks.get("turn_end")!()).toEqual({
      entries: [
        {
          type: "context_edit",
          targetId: "assistant",
          replacement: { content: [{ type: "text", text: "shorter" }] },
        },
        { type: "context_edit", targetId: "tool", replacement: null },
      ],
    });
    expect(f.hooks.get("turn_end")!()).toBeUndefined();
  },
);
