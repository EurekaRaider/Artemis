import { describe, expect, it } from "vitest";

import type { ToolState } from "@artemis/protocol";

import {
  appendTimelineActivities,
  groupTimelineActivities,
  latestVisibleToolGroupKey,
} from "../src/renderer/tool-activity-groups.js";

function tool(
  id: string,
  name: string,
  input?: unknown,
  status: ToolState["status"] = "completed",
): ToolState {
  return {
    id,
    name,
    ...(input === undefined ? {} : { input }),
    output: "",
    status,
  };
}

describe("timeline tool activity groups", () => {
  it("updates grouping from only the newly appended timeline suffix", () => {
    const tools = {
      first: tool("first", "read", { path: "one.ts" }),
      second: tool("second", "read", { path: "two.ts" }),
    };
    const initial = groupTimelineActivities(["tool:first"], tools);
    expect(appendTimelineActivities(initial, ["tool:first"], tools, 1)).toBe(
      initial,
    );

    expect(
      appendTimelineActivities(
        initial,
        ["tool:first", "tool:second", "part:answer"],
        tools,
        1,
      ),
    ).toEqual([
      {
        kind: "tool-group",
        key: "file-exploration:first",
        toolIds: ["first", "second"],
      },
      { kind: "entry", key: "part:answer", entry: "part:answer" },
    ]);
  });

  it("folds Bash searches and reads into one chronological file-operation group", () => {
    const tools = {
      search: tool("search", "bash", {
        command: 'rg -n "PiAdapter" packages/protocol',
      }),
      readOne: tool("readOne", "read", { path: "schema.ts" }),
      readTwo: tool("readTwo", "read", { path: "reducer.ts" }),
    };

    expect(
      groupTimelineActivities(
        ["tool:search", "tool:readOne", "tool:readTwo"],
        tools,
      ),
    ).toEqual([
      {
        kind: "tool-group",
        key: "file-exploration:search",
        toolIds: ["search", "readOne", "readTwo"],
      },
    ]);
  });

  it("folds observed Bash, wait, and cancel calls into one Bash group", () => {
    const tools = {
      bash: tool("bash", "bash", { command: "npm test" }, "running"),
      plan: tool("plan", "update_plan", {}),
      wait: tool("wait", "bash_wait", { execution_id: "execution-1" }),
      cancel: tool("cancel", "bash_cancel", { execution_id: "execution-1" }),
    };

    expect(
      groupTimelineActivities(
        ["tool:bash", "tool:plan", "tool:wait", "tool:cancel"],
        tools,
      ),
    ).toEqual([
      {
        kind: "tool-group",
        key: "bash:bash",
        toolIds: ["bash", "wait", "cancel"],
      },
    ]);
  });

  it("keeps file edits and unrelated tools in separate groups", () => {
    const tools = {
      read: tool("read", "read", { path: "App.tsx" }),
      write: tool("write", "write", { path: "App.tsx" }),
      custom: tool("custom", "mcp_lookup", { query: "App" }),
    };

    expect(
      groupTimelineActivities(
        ["tool:read", "tool:write", "tool:custom"],
        tools,
      ).map((entry) => entry.kind === "tool-group" && entry.toolIds),
    ).toEqual([["read"], ["write"], ["custom"]]);
  });

  it("keeps the latest completed tool group visually active through hidden reasoning", () => {
    const entries = [
      {
        kind: "tool-group" as const,
        key: "bash:bash",
        toolIds: ["bash"],
      },
      {
        kind: "entry" as const,
        key: "part:thinking",
        entry: "part:thinking",
      },
    ];

    expect(
      latestVisibleToolGroupKey(entries, {
        thinking: { id: "thinking", type: "thinking", text: "" },
      }),
    ).toBe("bash:bash");
  });

  it("stops tool-group activity highlighting after visible assistant text", () => {
    const entries = [
      {
        kind: "tool-group" as const,
        key: "file-exploration:read",
        toolIds: ["read"],
      },
      { kind: "entry" as const, key: "part:text", entry: "part:text" },
    ];

    expect(
      latestVisibleToolGroupKey(entries, {
        text: { id: "text", type: "text", text: "Done" },
      }),
    ).toBeUndefined();
  });
});
