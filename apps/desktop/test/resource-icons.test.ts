import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ARTEMIS_ICON_NAMES,
  ARTEMIS_ICON_SOURCE,
  ArtemisIcon,
} from "@artemis/ui/icons";
import {
  RESOURCE_ICON_NAMES,
  resourceIconName,
} from "../src/renderer/resource-icons.js";

describe("resource icons", () => {
  it("ships the prototype resource glyphs as a typed production catalog", () => {
    expect(ARTEMIS_ICON_SOURCE).toBe(
      "ui-prototype-v17:components.html#cat-icons",
    );
    expect(RESOURCE_ICON_NAMES).toHaveLength(37);
    expect(new Set(RESOURCE_ICON_NAMES).size).toBe(RESOURCE_ICON_NAMES.length);

    for (const name of RESOURCE_ICON_NAMES) {
      expect(ARTEMIS_ICON_NAMES).toContain(name);
      const markup = renderToStaticMarkup(createElement(ArtemisIcon, { name }));
      expect(markup).toContain(`data-artemis-icon="${name}"`);
      expect(markup).toContain('viewBox="0 0 24 24"');
      expect(markup).toContain('width="1em"');
      expect(markup).toContain('height="1em"');
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toContain('stroke="currentColor"');
      expect(markup).toContain('stroke-width="1.5"');
    }

    const skill = renderToStaticMarkup(
      createElement(ArtemisIcon, { name: "skill" }),
    );
    expect(skill).toContain(
      'd="M12 3.5l2.3 6.2 6.2 2.3-6.2 2.3L12 20.5l-2.3-6.2-6.2-2.3 6.2-2.3z"',
    );
  });

  it.each([
    ["brainstorming", "lightbulb"],
    ["design-taste-frontend", "palette"],
    ["dispatching-parallel-agents", "agents"],
    ["documents", "document"],
    ["executing-plans", "checklist"],
    ["find-docs", "file-search"],
    ["find-skills", "skill-search"],
    ["finishing-a-development-branch", "git-branch"],
    ["gsap", "video"],
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
});
