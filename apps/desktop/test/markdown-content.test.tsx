import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  isWorkspaceFileHref,
  MarkdownContent,
} from "../src/renderer/MarkdownContent.js";

describe("MarkdownContent", () => {
  it("renders headings, lists, inline code, and fenced code blocks", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        text={[
          "# Build report",
          "",
          "- first check",
          "- second check",
          "",
          "Use `npm test`.",
          "",
          "```ts",
          "const answer = 42;",
          "```",
        ].join("\n")}
      />,
    );

    expect(html).toContain('<h1 id="build-report">Build report</h1>');
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>first check</li>");
    expect(html).toContain("<li>second check</li>");
    expect(html).toContain("<code>npm test</code>");
    expect(html).toMatch(
      /<pre><code(?: class="language-ts")?>const answer = 42;\n?<\/code><\/pre>/u,
    );
  });

  it("omits raw HTML, scripts, and event-handler attributes", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        text={[
          "Safe text.",
          "",
          '<script>alert("unsafe")</script>',
          '<img src="x" onerror="steal()">',
          '<button onclick="steal()">unsafe button</button>',
        ].join("\n")}
      />,
    );

    expect(html).toContain("Safe text.");
    expect(html).not.toMatch(/<script\b/iu);
    expect(html).not.toMatch(/<img\b/iu);
    expect(html).not.toMatch(/<button\b/iu);
    expect(html).not.toMatch(/\bonerror\b/iu);
    expect(html).not.toMatch(/\bonclick\b/iu);
  });

  it("renders safe remote and workspace images only when a reader resolves them", () => {
    const resolveImage = async () => undefined;
    const html = renderToStaticMarkup(
      <MarkdownContent
        resolveImage={resolveImage}
        text={[
          '<div align="center">',
          "",
          "[![tests](https://img.shields.io/badge/tests-passing-green)](https://example.com/tests)",
          "",
          "![diagram](<./docs/system diagram.png>)",
          "",
          '<img src="javascript:alert(1)" onerror="steal()">',
          "",
          '<p><a href="javascript:alert(1)"><img src="https://example.com/safe.png" onerror="steal()"></a></p>',
          "",
          "</div>",
        ].join("\n")}
      />,
    );

    expect(html).toContain('class="markdown-align-center"');
    expect(html).toContain(
      'src="https://img.shields.io/badge/tests-passing-green"',
    );
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain('data-workspace-image="./docs/system diagram.png"');
    expect(html).toMatch(
      /<img[^>]*loading="eager"[^>]*data-workspace-image="\.\/docs\/system diagram\.png"/u,
    );
    expect(html).toContain('src="https://example.com/safe.png"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("onerror");
  });

  it("renders the repository README icon, badges, and Markdown screenshot", () => {
    const readme = readFileSync(
      fileURLToPath(new URL("../../../README.md", import.meta.url)),
      "utf8",
    );
    const html = renderToStaticMarkup(
      <MarkdownContent resolveImage={async () => undefined} text={readme} />,
    );

    expect(html).toContain(
      'data-workspace-image="./apps/desktop/build/icon.png"',
    );
    expect(html).toContain('width="92"');
    expect(html).toContain(
      'src="https://img.shields.io/badge/Build-cross--platform-2088FF?logo=githubactions&amp;logoColor=white"',
    );
    expect(html).toContain(
      'src="https://img.shields.io/badge/React-19-149ECA?logo=react&amp;logoColor=white"',
    );
    expect(html).toContain(
      'data-workspace-image="docs/images/artemis-workspace-dark.png"',
    );
    expect(html).toContain(
      'data-workspace-image="docs/images/artemis-workspace-en-125.png"',
    );
    expect(html).toContain(
      'data-workspace-image="docs/images/artemis-workspace-zh-CN-150.png"',
    );
    expect(html).toContain(
      'data-workspace-image="docs/images/plugin-marketplace.jpg"',
    );
    expect(html).toContain(
      'data-workspace-image="docs/images/plugin-marketplace-add-plugin.jpg"',
    );
    expect(html).toContain(
      'data-workspace-image="docs/images/plugin-marketplace-add-mcp.jpg"',
    );
    expect(html).toContain('<h2 id="product-preview">Product preview</h2>');
    expect(html).toContain('href="#product-preview"');
  });

  it("keeps images disabled in ordinary conversation Markdown", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent text="![tracking pixel](https://example.com/pixel.png)" />,
    );

    expect(html).not.toMatch(/<img\b/iu);
  });

  it("renders relative and absolute workspace paths as delegated file links", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        text={[
          "[report](reports/report.md)",
          "[source](apps/main.ts:12:4)",
          "[absolute](/tmp/workspace/output.html)",
          "[web](https://example.com)",
          "[unsafe](javascript:alert(1))",
        ].join("\n")}
      />,
    );

    expect(html).toContain('data-workspace-file="reports/report.md"');
    expect(html).toContain('data-workspace-file="apps/main.ts:12:4"');
    expect(html).toContain('data-workspace-file="/tmp/workspace/output.html"');
    expect(html).toMatch(
      /<a(?=[^>]*\bhref="https:\/\/example\.com")(?=[^>]*\btarget="_blank")(?=[^>]*\brel="noopener noreferrer")[^>]*>web<\/a>/u,
    );
    expect(html).not.toContain('data-workspace-file="https://example.com"');
    expect(html).not.toContain("javascript:alert(1)");

    expect(isWorkspaceFileHref("README.md:12")).toBe(true);
    expect(isWorkspaceFileHref("C:\\repo\\main.ts:9")).toBe(true);
    expect(isWorkspaceFileHref("https://example.com/file.ts")).toBe(false);
    expect(isWorkspaceFileHref("javascript:alert(1)")).toBe(false);
  });

  it("is used for assistant message content in the timeline", () => {
    const appSource = readFileSync(
      fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)),
      "utf8",
    );
    const assistantMessage = appSource.match(
      /<article className="assistant-message"[\s\S]*?<\/article>/u,
    )?.[0];

    expect(assistantMessage).toBeDefined();
    expect(assistantMessage).toContain("<MarkdownContent");
    expect(assistantMessage).toContain("onFileLink={onFileLink}");
    expect(assistantMessage).toContain(
      "onFileLinkContextMenu={onFileLinkContextMenu}",
    );
    expect(assistantMessage).toContain("text={part.text}");
  });
});
