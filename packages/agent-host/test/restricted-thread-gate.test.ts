import { describe, expect, it } from "vitest";
import {
  RestrictedProfileDeniedError,
  assertToolAllowedForRestrictedThread,
  classifyToolForRestrictedProfile,
  isToolDeniedForRestrictedThread,
} from "../src/restricted-thread-gate.js";

// The full built-in customTools roster from runtime.ts assembly order.
const builtinToolNames = [
  "attachment_list",
  "web_search",
  "read",
  "local_file_read",
  "local_file_write",
  "request_user_input",
  "write",
  "office_document",
  "load_workspace_dependencies",
  "update_plan",
  "get_goal",
  "create_goal",
  "update_goal",
  "save_memory",
  "spawn_agent",
  "list_agents",
  "wait_team",
  "send_message",
  "set_agent_write_scope",
  "finish_team",
  "wait_agent",
  "get_agent_status",
  "steer_agent",
  "cancel_agent",
  "retry_agent",
  "shell",
  "shell_wait",
  "shell_cancel",
  "search_mcp_tools",
];

describe("restricted-thread gate classification", () => {
  it("classifies every builtin tool to a known category", () => {
    for (const name of builtinToolNames) {
      expect(classifyToolForRestrictedProfile(name)).not.toBe("unknown");
    }
  });

  it("classifies plugin and attachment tools as plugin-tool", () => {
    expect(classifyToolForRestrictedProfile("plugin_replace_document")).toBe(
      "plugin-tool",
    );
    expect(classifyToolForRestrictedProfile("attachment_list")).toBe(
      "plugin-tool",
    );
  });
});

describe("restricted-thread gate (§7 denial matrix)", () => {
  it("denies shell, filesystem, subagents, MCP and web for restricted threads", () => {
    for (const name of [
      "shell",
      "shell_wait",
      "shell_cancel",
      "write",
      "read",
      "local_file_read",
      "local_file_write",
      "web_search",
      "office_document",
      "spawn_agent",
      "list_agents",
      "wait_team",
      "send_message",
      "finish_team",
      "steer_agent",
      "cancel_agent",
      "search_mcp_tools",
    ]) {
      expect(isToolDeniedForRestrictedThread(name), name).toBe(true);
    }
  });

  it("allows plan, goal, memory, user-input and plugin tools", () => {
    for (const name of [
      "update_plan",
      "get_goal",
      "save_memory",
      "request_user_input",
      "load_workspace_dependencies",
      "plugin_notes_append",
      "attachment_list",
    ]) {
      expect(isToolDeniedForRestrictedThread(name), name).toBe(false);
    }
  });

  it("denies unknown tool names by default (allow-list semantics)", () => {
    expect(isToolDeniedForRestrictedThread("mystery_tool")).toBe(true);
    expect(classifyToolForRestrictedProfile("mystery_tool")).toBe("unknown");
  });
});

describe("restricted-thread dispatch guard (simulated agent loop)", () => {
  // Simulates what the wrapped execute closures do inside a restricted
  // thread's customTools: every dispatch passes through the guard before the
  // real tool runs, regardless of how the call was initiated.
  function dispatchThroughGuard(name: string): string {
    assertToolAllowedForRestrictedThread(name);
    return `${name} executed`;
  }

  it("executes plugin tools through the guard", () => {
    expect(dispatchThroughGuard("plugin_notes_append")).toBe(
      "plugin_notes_append executed",
    );
    expect(dispatchThroughGuard("update_plan")).toBe("update_plan executed");
  });

  it("throws RestrictedProfileDeniedError before executing denied tools", () => {
    for (const name of ["shell", "write", "spawn_agent", "search_mcp_tools"]) {
      expect(() => dispatchThroughGuard(name)).toThrow(
        RestrictedProfileDeniedError,
      );
      expect(() => dispatchThroughGuard(name)).toThrow(
        /denied for plugin-restricted threads/,
      );
    }
  });

  it("a malicious prompt-injected tool name is still refused (stale-list regression)", () => {
    // Even if a stale tool list leaked "shell" into a restricted session,
    // the wrapped execute closure refuses before any broker request.
    const staleListLeak = "shell";
    expect(() => dispatchThroughGuard(staleListLeak)).toThrow(
      RestrictedProfileDeniedError,
    );
  });

  it("the filter and the guard agree on every builtin tool", () => {
    for (const name of builtinToolNames) {
      const denied = isToolDeniedForRestrictedThread(name);
      if (denied) {
        expect(() => assertToolAllowedForRestrictedThread(name)).toThrow();
      } else {
        expect(() => assertToolAllowedForRestrictedThread(name)).not.toThrow();
      }
    }
  });
});
