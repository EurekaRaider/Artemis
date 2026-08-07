import { describe, expect, it } from "vitest";

import {
  resourceIconName,
  resourceIconPalette,
  type ResourceIconName,
} from "../src/renderer/resource-icons.js";

describe("resource icons", () => {
  it.each([
    ["brainstorming", "lightbulb"],
    ["design-taste-frontend", "palette"],
    ["dispatching-parallel-agents", "agents"],
    ["documents", "document"],
    ["executing-plans", "checklist"],
    ["find-docs", "file-search"],
    ["find-skills", "skill-search"],
    ["finishing-a-development-branch", "git-branch"],
    ["gsap", "motion"],
    ["hyperframes", "video"],
    ["hyperframes-cli", "terminal"],
    ["hyperframes-registry", "package"],
    ["mgsuite-google-workspace-setup", "toolbox"],
    ["pdf", "pdf"],
    ["presentations", "presentation"],
    ["receiving-code-review", "code-review"],
    ["requesting-code-review", "code-review"],
    ["spreadsheets", "spreadsheet"],
    ["subagent-driven-development", "agents"],
    ["systematic-debugging", "bug"],
    ["test-driven-development", "test"],
    ["using-git-worktrees", "git-branch"],
    ["using-superpowers", "lightning"],
    ["verification-before-completion", "verify"],
    ["website-to-hyperframes", "web-video"],
    ["writing-plans", "checklist"],
    ["writing-skills", "skill-authoring"],
  ])("maps the installed Skill %s to %s", (name, expected) => {
    expect(resourceIconName(name, "skill")).toBe(expected);
  });

  it.each([
    ["CodeGraph MCP", "codegraph"],
    ["node-repl MCP", "terminal"],
    ["GitHub MCP Server", "github"],
    ["Figma", "figma"],
    ["Postgres database", "database"],
    ["Chrome browser control", "browser"],
    ["@modelcontextprotocol/server-filesystem", "filesystem"],
  ])("maps the MCP server %s to %s", (name, expected) => {
    expect(resourceIconName(name, "mcp")).toBe(expected);
  });

  it("uses distinct type fallbacks instead of a shared placeholder", () => {
    expect(resourceIconName("Uncatalogued capability", "skill")).toBe("skill");
    expect(resourceIconName("Uncatalogued capability", "mcp")).toBe("mcp");
    expect(resourceIconName("Uncatalogued capability", "connectors")).toBe(
      "connector",
    );
    expect(resourceIconName("Uncatalogued capability", "plugin")).toBe(
      "plugin",
    );
  });

  it("gives semantic icons distinct multi-color marketplace palettes", () => {
    const icons: ResourceIconName[] = [
      "lightbulb",
      "palette",
      "agents",
      "checklist",
      "terminal",
      "mcp",
      "skill",
    ];
    const palettes = icons.map(resourceIconPalette);

    expect(new Set(palettes.map((item) => item.background)).size).toBe(
      icons.length,
    );
    for (const item of palettes) {
      expect(Object.values(item)).toHaveLength(5);
      expect(new Set(Object.values(item)).size).toBe(5);
      expect(
        Object.values(item).every((color) => /^#[0-9a-f]{6}$/iu.test(color)),
      ).toBe(true);
    }
  });
});
