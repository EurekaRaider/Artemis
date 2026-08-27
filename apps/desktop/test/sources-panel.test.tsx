import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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

const panelSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/SourcesPanel.tsx", import.meta.url)),
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
      />,
    );

    expect(html).toContain('aria-label="来源"');
    expect(html).toContain("计划.md");
    expect(html).toContain("已附加到下一条消息");
    expect(html).toContain("参考图.png");
    expect(html).toContain("CodeGraph");
    expect(html).toContain("UI Agent");
    expect(html).toContain("DuckDuckGo HTML");
    expect(html).toContain("2 次搜索 · 3 个网页结果");
    expect(html).toContain("Artemis release");
    expect(html).toContain("example.org");
    expect(panelSource).toContain("onOpenUrl(search.searchUrl)");
    expect(panelSource).toContain("onOpenUrl(link.url)");
  });
});
