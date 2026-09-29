import { describe, expect, it } from "vitest";
import {
  assertToolAllowedForRestrictedProfile,
  filterToolsForRestrictedProfile,
  type ToolDescriptor,
} from "../src/main/design-plugin-tool-gate.js";

// The host tool inventory as categories, mirroring runtime.ts customTools.
const hostTools: ToolDescriptor[] = [
  { name: "web_search", category: "web-search" },
  { name: "read", category: "read" },
  { name: "write", category: "write" },
  { name: "local_file_read", category: "local-file-read" },
  { name: "local_file_write", category: "local-file-write" },
  { name: "office_document", category: "office-document" },
  { name: "shell", category: "bash" },
  { name: "shell_wait", category: "bash-wait" },
  { name: "shell_cancel", category: "bash-cancel" },
  { name: "spawn_agent", category: "spawn-agent" },
  { name: "wait_agent", category: "wait-agent" },
  { name: "send_message", category: "send-message" },
  { name: "search_mcp_tools", category: "mcp" },
  { name: "extension_call", category: "extension" },
  { name: "attachment_read", category: "attachment" },
  { name: "plugin_replace_document", category: "plugin-tool" },
  { name: "plugin_get_snapshot", category: "plugin-tool" },
];

describe("restricted-profile tool gate (S0 layer 1: list filtering)", () => {
  it("keeps only attachment and plugin tools for plugin-type threads", () => {
    const { allowed } = filterToolsForRestrictedProfile(hostTools);
    expect(allowed.map((t) => t.name)).toEqual([
      "attachment_read",
      "plugin_replace_document",
      "plugin_get_snapshot",
    ]);
  });

  it("denies bash, filesystem, subagents, MCP and extensions with reasons", () => {
    const { denied } = filterToolsForRestrictedProfile(hostTools);
    const deniedNames = denied.map((d) => d.name);
    for (const name of [
      "shell",
      "shell_wait",
      "write",
      "local_file_read",
      "local_file_write",
      "spawn_agent",
      "search_mcp_tools",
      "extension_call",
      "web_search",
      "office_document",
    ]) {
      expect(deniedNames).toContain(name);
    }
  });

  it("denies unknown categories by default (allow-list semantics)", () => {
    const { allowed, denied } = filterToolsForRestrictedProfile([
      { name: "mystery_tool", category: "not-a-known-category" },
    ]);
    expect(allowed).toEqual([]);
    expect(denied[0]?.reason).toContain("not in the restricted allow-list");
  });
});

describe("restricted-profile tool gate (S0 layer 2: dispatch guard)", () => {
  it("allows plugin and attachment tools through the guard", () => {
    expect(() =>
      assertToolAllowedForRestrictedProfile({
        name: "plugin_replace_document",
        category: "plugin-tool",
      }),
    ).not.toThrow();
    expect(() =>
      assertToolAllowedForRestrictedProfile({
        name: "attachment_read",
        category: "attachment",
      }),
    ).not.toThrow();
  });

  it("throws before dispatch for every denied category", () => {
    for (const tool of [
      { name: "shell", category: "bash" },
      { name: "write", category: "write" },
      { name: "spawn_agent", category: "spawn-agent" },
      { name: "search_mcp_tools", category: "mcp" },
      { name: "extension_call", category: "extension" },
      { name: "web_search", category: "web-search" },
    ]) {
      expect(() => assertToolAllowedForRestrictedProfile(tool)).toThrow(
        /denied|refused/,
      );
    }
  });

  it("refuses tools with no category mapping instead of waving them through", () => {
    expect(() =>
      assertToolAllowedForRestrictedProfile({
        name: "renamed_shell",
        category: "brand-new",
      }),
    ).toThrow(/allow-list; dispatch refused/);
  });

  it("guard denial is independent of the filtered list (stale-list regression)", () => {
    // A tool that leaked into a stale list still cannot dispatch.
    const stale = filterToolsForRestrictedProfile(hostTools).allowed;
    expect(stale.map((t) => t.name)).not.toContain("shell");
    expect(() =>
      assertToolAllowedForRestrictedProfile({
        name: "shell",
        category: "bash",
      }),
    ).toThrow(/denied/);
  });
});
