// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type {
  ChildAgentState,
  McpToolUsageState,
  PromptAttachment,
  TaskSourceState,
} from "@artemis/protocol";

import {
  groupWebSearchSources,
  sourceLinkHost,
  SourcesPanel,
} from "../src/renderer/SourcesPanel.js";
import "./renderer-test-utils.js";

const panelSource = readFileSync(
  resolve(process.cwd(), "src/renderer/SourcesPanel.tsx"),
  "utf8",
);

const webSources = [
  {
    type: "task.source.added",
    sourceId: "search-1",
    kind: "web-search",
    query: "Artemis release",
    engine: "DuckDuckGo HTML",
    resultCount: 2,
    searchUrl: "https://html.duckduckgo.com/html/?q=Artemis",
    links: [
      { title: "Release", url: "https://example.org/release" },
      { title: "Docs", url: "https://example.org/docs" },
    ],
    timestamp: "2026-08-27T00:00:00.000Z",
  },
  {
    type: "task.source.added",
    sourceId: "search-2",
    kind: "web-search",
    query: "Artemis docs",
    engine: "DuckDuckGo HTML",
    resultCount: 1,
    searchUrl: "https://html.duckduckgo.com/html/?q=docs",
    links: [{ title: "Duplicate", url: "https://example.org/docs" }],
    timestamp: "2026-08-27T00:00:01.000Z",
  },
] satisfies TaskSourceState[];

describe("Sources workspace panel", () => {
  it("groups searches by engine and deduplicates links", () => {
    expect(groupWebSearchSources(webSources)).toEqual([
      {
        id: "DuckDuckGo HTML",
        engine: "DuckDuckGo HTML",
        resultCount: 3,
        searches: webSources,
        links: [
          { title: "Release", url: "https://example.org/release" },
          { title: "Docs", url: "https://example.org/docs" },
        ],
      },
    ]);
    expect(sourceLinkHost("https://docs.example.org/path")).toBe(
      "docs.example.org",
    );
    expect(sourceLinkHost("not a URL")).toBe("not a URL");
  });

  it("renders attachments, MCP usage, searches, and direct web sources in Chinese", () => {
    const attachments = [
      {
        type: "file",
        name: "计划.md",
        mimeType: "text/markdown",
        content: "plan",
      },
      {
        name: "image-2.png",
        mimeType: "image/png",
        data: "iVBORw==",
      },
    ] satisfies PromptAttachment[];
    const sources = [
      {
        type: "task.source.added",
        sourceId: "image-1",
        name: "参考图.png",
        mimeType: "image/png",
        kind: "image",
        timestamp: "2026-08-27T00:00:00.000Z",
      },
      ...webSources,
    ] satisfies TaskSourceState[];
    const mcpUsages = [
      {
        type: "mcp.tool.used",
        toolCallId: "call-1",
        serverId: "codegraph",
        serverName: "CodeGraph",
        toolName: "codegraph_explore",
        agentId: "ui-agent",
        timestamp: "2026-08-27T00:00:00.000Z",
      },
    ] satisfies McpToolUsageState[];
    const agents = [
      {
        type: "child-agent.status",
        agentId: "ui-agent",
        label: "UI Agent",
        status: "completed",
      },
    ] satisfies ChildAgentState[];

    const html = renderToStaticMarkup(
      <SourcesPanel
        agents={agents}
        attachments={attachments}
        locale="zh-CN"
        mcpUsages={mcpUsages}
        onOpenUrl={() => undefined}
        sources={sources}
        threadId="thread-1"
      />,
    );

    expect(html).toContain('aria-label="来源"');
    expect(html).toContain("计划.md");
    expect(html).toContain('aria-label="打开图片: image-2.png"');
    expect(html).toContain("data:image/png;base64,iVBORw==");
    expect(html).toContain("已附加到下一条消息");
    expect(html).toContain("参考图.png");
    expect(html).toContain("CodeGraph");
    expect(html).toContain("UI Agent");
    expect(html).toContain("DuckDuckGo HTML");
    expect(html).toContain("2 次搜索 · 3 个网页结果");
    expect(html).toContain("Artemis release");
    expect(html).toContain("example.org");
    expect(panelSource).toContain("onOpenUrl(search.searchUrl)");
    expect(panelSource).toContain("onOpen={onOpenUrl}");
    expect(panelSource).toContain("readTaskSourceImage");
    expect(panelSource).toContain('role="dialog"');
  });
});

describe("SourcesPanel interactions (jsdom)", () => {
  const webSource = {
    type: "task.source.added",
    sourceId: "web-1",
    kind: "web-search",
    query: "Artemis release",
    engine: "DuckDuckGo",
    searchUrl: "https://example.org/search?q=Artemis",
    resultCount: 2,
    links: [
      { title: "Release", url: "https://example.org/release" },
      { title: "Docs", url: "https://example.org/docs" },
    ],
    timestamp: "2026-08-29T00:00:00.000Z",
  } as const;

  const mcpUsage = {
    type: "mcp.tool.used",
    toolCallId: "call-1",
    serverId: "codegraph",
    serverName: "CodeGraph",
    toolName: "codegraph_search",
    agentId: "parent",
    timestamp: "2026-08-29T00:00:00.000Z",
  } as const;

  function renderInteractive(
    props: Partial<Parameters<typeof SourcesPanel>[0]> = {},
  ) {
    const onOpenUrl = vi.fn();
    render(
      <SourcesPanel
        agents={[]}
        attachments={[]}
        locale="en"
        mcpUsages={[mcpUsage]}
        onOpenUrl={onOpenUrl}
        sources={[{ ...webSource }]}
        threadId="thread-1"
        {...props}
      />,
    );
    return { onOpenUrl };
  }

  it("opens a web source exactly once with the link url", async () => {
    const { onOpenUrl } = renderInteractive();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Open source: Release" }));
    expect(onOpenUrl).toHaveBeenCalledTimes(1);
    expect(onOpenUrl).toHaveBeenCalledWith("https://example.org/release");
  });

  it("expands MCP tool details with aria-expanded and keyboard, then collapses", async () => {
    const user = userEvent.setup();
    renderInteractive();
    const toggle = screen.getByRole("button", {
      name: /show tool call details/i,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByText("codegraph_search").length).toBe(2);

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByText("codegraph_search").length).toBe(1);
  });

  it("keeps tool names visible by default and opens the search query url once", async () => {
    const user = userEvent.setup();
    const { onOpenUrl } = renderInteractive();
    expect(screen.getByText("codegraph_search")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Search query: Artemis release" }),
    );
    expect(onOpenUrl).toHaveBeenCalledTimes(1);
    expect(onOpenUrl).toHaveBeenCalledWith(
      "https://example.org/search?q=Artemis",
    );
  });

  it("keeps full names accessible via title attributes for long values", async () => {
    const longTool = "codegraph_search_very_long_tool_identifier_x12345";
    renderInteractive({
      mcpUsages: [{ ...mcpUsage, toolName: longTool }],
    });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /show tool call details/i }),
    );
    const detail = screen.getAllByTitle(longTool);
    expect(detail.length).toBeGreaterThanOrEqual(2);
  });
});
