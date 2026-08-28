import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  externalLinkFaviconUrl,
  isWorkspaceFileHref,
  MarkdownContent,
} from "../src/renderer/MarkdownContent.js";
import {
  workspaceFileIconPath,
  workspaceFileLinkIcon,
} from "../src/renderer/seti-file-icon.js";

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
      'href="https://github.com/EurekaRaider/Artemis/actions/workflows/ci.yml"',
    );
    expect(html).toContain(
      'src="https://github.com/EurekaRaider/Artemis/actions/workflows/ci.yml/badge.svg"',
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
        fileLinkIcons
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
    expect(html.match(/class="workspace-file-link-icon"/gu)).toHaveLength(3);
    expect(html).toContain('class="workspace-file-link with-icon"');
    expect(html).toContain('aria-hidden="true"');
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

  it("renders assistant HTTP links with a trusted icon placeholder and URL tooltip", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        externalLinkIcons
        onExternalLink={() => undefined}
        text="[OpenAI](https://openai.com)"
      />,
    );

    expect(html).toContain('class="external-http-link with-icon"');
    expect(html).toContain('data-external-http="https://openai.com"');
    expect(html).toContain('href="https://openai.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('title="https://openai.com"');
    expect(html).toContain(
      '<span aria-hidden="true" class="external-link-icon" data-external-link-icon></span>OpenAI',
    );
    expect(html).not.toContain('target="_blank"');
    expect(html).not.toMatch(/<img\b/iu);
  });

  it("keeps ordinary delegated HTTP links free of external-link icons", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        onExternalLink={() => undefined}
        text="[OpenAI](https://openai.com)"
      />,
    );

    expect(html).toContain('data-external-http="https://openai.com"');
    expect(html).not.toContain("external-http-link");
    expect(html).not.toContain("data-external-link-icon");
  });

  it("derives favicon URLs from safe HTTP origins only", () => {
    expect(
      externalLinkFaviconUrl(
        "https://github.com/openai/codex/pull/12870?tab=files#diff",
      ),
    ).toBe("https://github.com/favicon.ico");
    expect(externalLinkFaviconUrl("//github.com/openai/codex")).toBe(
      "https://github.com/favicon.ico",
    );
    expect(externalLinkFaviconUrl("http://127.0.0.1:4173/deep/path")).toBe(
      "http://127.0.0.1:4173/favicon.ico",
    );

    expect(externalLinkFaviconUrl("https://user:secret@example.com/path")).toBe(
      undefined,
    );
    expect(externalLinkFaviconUrl("javascript:alert(1)")).toBe(undefined);
    expect(externalLinkFaviconUrl("data:text/plain,hello")).toBe(undefined);
    expect(externalLinkFaviconUrl("mailto:test@example.com")).toBe(undefined);
    expect(externalLinkFaviconUrl("not a URL")).toBe(undefined);
  });

  it("selects file-type icons from link paths without treating line locations as extensions", () => {
    expect(workspaceFileIconPath("apps/App.tsx:214")).toBe("apps/App.tsx");
    expect(workspaceFileIconPath("styles.css#L12C4")).toBe("styles.css");
    expect(workspaceFileIconPath("file:///tmp/icon.svg#L1")).toBe(
      "/tmp/icon.svg",
    );

    const icons = [
      workspaceFileLinkIcon("apps/App.tsx:214"),
      workspaceFileLinkIcon("styles.css:1"),
      workspaceFileLinkIcon("assets/icon.svg#L1"),
    ];
    expect(new Set(icons.map((icon) => icon.svg))).toHaveLength(3);
    expect(icons[0]?.svg).toBe(
      workspaceFileLinkIcon("components/Button.jsx").svg,
    );
  });

  it("uses iconified file and external links only for assistant timeline messages", () => {
    const appSource = readFileSync(
      fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)),
      "utf8",
    );
    const stylesSource = readFileSync(
      fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)),
      "utf8",
    );
    const assistantMessage = appSource.match(
      /<article className="assistant-message"[\s\S]*?<\/article>/u,
    )?.[0];

    expect(assistantMessage).toContain("fileLinkIcons");
    expect(assistantMessage).toContain("externalLinkIcons");
    expect(stylesSource).toMatch(
      /\.markdown-body a\.workspace-file-link\s*\{[\s\S]*?text-decoration:\s*none;[\s\S]*?\}/u,
    );
    expect(stylesSource).toMatch(
      /\.markdown-body a\.workspace-file-link\.with-icon\s*\{[\s\S]*?display:\s*inline;[\s\S]*?font-family:\s*inherit;[\s\S]*?white-space:\s*normal;[\s\S]*?\}/u,
    );
    expect(stylesSource).toMatch(
      /\.markdown-body a\[data-external-http\][\s\S]*?text-decoration:\s*underline;[\s\S]*?\}/u,
    );
    expect(stylesSource).toMatch(
      /\.markdown-body a\.external-http-link\.with-icon\s*\{[\s\S]*?font-weight:\s*500;[\s\S]*?text-decoration:\s*none;[\s\S]*?white-space:\s*normal;[\s\S]*?\}/u,
    );
    expect(stylesSource).toMatch(
      /\.markdown-body a\.external-http-link\.with-icon:hover\s*\{[\s\S]*?text-decoration-style:\s*dashed;[\s\S]*?\}/u,
    );
    expect(stylesSource).toMatch(
      /\.markdown-body a\.external-http-link\.with-icon:focus-visible\s*\{[\s\S]*?outline:[\s\S]*?\}/u,
    );
    expect(stylesSource).toMatch(/\.workspace-file-link-icon\s*\{[\s\S]*?\}/u);
    expect(stylesSource).toMatch(/\.external-link-icon\s*\{[\s\S]*?\}/u);
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
    expect(assistantMessage).toContain("fileLinkIcons");
    expect(assistantMessage).toContain("externalLinkIcons");
    expect(assistantMessage).toContain("onExternalLink={onExternalLink}");
    expect(assistantMessage).toContain("onFileLink={onFileLink}");
    expect(assistantMessage).toContain(
      "onFileLinkContextMenu={onFileLinkContextMenu}",
    );
    expect(assistantMessage).toContain("text={part.text}");
  });
});
