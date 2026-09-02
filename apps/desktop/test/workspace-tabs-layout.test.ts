import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import {
  WorkspaceFileEditor,
  workspaceHighlightTokensByLine,
} from "../src/renderer/WorkspaceFileEditor.js";
import {
  setiFileIcon,
  WorkspaceFileIcon,
} from "../src/renderer/WorkspaceFilesPanel.js";
import {
  filePresentation,
  tokenizeSourceLine,
} from "../src/renderer/workspace-file-presentation.js";

interface ObservedSyntaxToken {
  kind: string;
  text: string;
}

interface WorkspaceTokenizerModule {
  tokenizeWorkspaceFile(
    content: string,
    language: string,
  ): ObservedSyntaxToken[];
}

function source(relativePath: string): string {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

async function loadWorkspaceTokenizer(): Promise<
  WorkspaceTokenizerModule["tokenizeWorkspaceFile"]
> {
  const module =
    (await import("../src/renderer/workspace-file-presentation.js")) as unknown as Partial<WorkspaceTokenizerModule>;

  expect(module.tokenizeWorkspaceFile).toBeTypeOf("function");
  return module.tokenizeWorkspaceFile!;
}

function expectLosslessTokens(
  tokens: ObservedSyntaxToken[],
  content: string,
): void {
  expect(tokens.map((token) => token.text).join("")).toBe(content);
  expect(tokens.every((token) => token.text.length > 0)).toBe(true);
}

function expectToken(
  tokens: ObservedSyntaxToken[],
  kind: string,
  text: string,
): void {
  expect(tokens).toContainEqual({ kind, text });
}

const appSource = source("../src/renderer/App.tsx");
const stylesSource = source("../src/renderer/styles.css");
const publicUiStylesSource = source("../../../packages/ui/src/styles.css");
const publicWorkspaceSource = source("../../../packages/ui/src/workspace.tsx");
const workspaceFilesSource = source("../src/renderer/WorkspaceFilesPanel.tsx");
const workspaceEditorSource = source("../src/renderer/WorkspaceFileEditor.tsx");
const workspaceMarkdownEditorSource = source(
  "../src/renderer/WorkspaceMarkdownEditor.tsx",
);
const workspaceTabContentSource = source(
  "../src/renderer/WorkspaceTabContent.tsx",
);
const workspacePresentationSource = source(
  "../src/renderer/workspace-file-presentation.ts",
);
const setiFileIconSource = source("../src/renderer/seti-file-icon.ts");
const workspacePreviewSource = source(
  "../src/renderer/WorkspacePreviewPanel.tsx",
);
const workspaceTextFileSource = source("../src/main/workspace-text-file.ts");
const apiSource = source("../src/shared/api.ts");
const preloadSource = source("../src/preload/preload.ts");
const mainSource = source("../src/main/main.ts");
const fileEditorSources = [
  workspaceFilesSource,
  workspaceEditorSource,
  workspaceMarkdownEditorSource,
  workspacePresentationSource,
  setiFileIconSource,
].join("\n");
const tabContentSources = [appSource, workspaceTabContentSource].join("\n");

function optionalCssRuleIn(
  cssSource: string,
  selector: string,
): string | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return cssSource.match(
    new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "u"),
  )?.[1];
}

function optionalCssRule(selector: string): string | undefined {
  return optionalCssRuleIn(stylesSource, selector);
}

function cssRule(selector: string): string {
  const declarations = optionalCssRule(selector);
  expect(declarations, `Missing CSS rule for ${selector}`).toBeDefined();
  return declarations ?? "";
}

function publicUiCssRule(selector: string): string {
  const declarations = optionalCssRuleIn(publicUiStylesSource, selector);
  expect(
    declarations,
    `Missing public UI CSS rule for ${selector}`,
  ).toBeDefined();
  return declarations ?? "";
}

function cssPropertyValue(
  declarations: string,
  property: string,
): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return declarations
    .match(new RegExp(`(?:^|;)\\s*${escaped}:\\s*(?<value>[^;]+)`, "u"))
    ?.groups?.value.replace(/\s+/gu, " ")
    .trim();
}

describe("Codex-like workspace tab layout contract", () => {
  it("skips tokenization entirely above the large-file highlight limit", () => {
    let calls = 0;
    const result = workspaceHighlightTokensByLine(
      "x".repeat(250_001),
      "typescript",
      () => {
        calls += 1;
        return [];
      },
    );

    expect(result).toBeUndefined();
    expect(calls).toBe(0);
  });

  it("renders Review, Terminal, file, Markdown, and Sources as closable top workspace tabs", () => {
    const tabBarIndex = appSource.indexOf("<WorkspaceTabBar");
    const tabContentIndex = appSource.indexOf(
      'className="workspace-tab-content"',
    );

    expect(appSource).toContain('from "./workspace-tabs.js"');
    expect(tabBarIndex).toBeGreaterThan(-1);
    expect(tabContentIndex).toBeGreaterThan(tabBarIndex);
    expect(appSource).toContain("<WorkspaceTabSurface");
    expect(appSource).toMatch(/\w+\.tabs\.map\(\(tab\)\s*=>/u);
    expect(appSource).toContain(
      "active={workspaceTabs.activeTabId === tab.id}",
    );
    expect(appSource).toContain("closeLabel={`${t.closeTab}: ${tab.title}`}");
    expect(appSource).toContain(
      "panelId={`${workspaceTabDomId(tab.id)}-pane`}",
    );
    expect(publicWorkspaceSource).toContain('role="tablist"');
    expect(publicWorkspaceSource).toContain('role="tab"');
    expect(publicWorkspaceSource).toContain("aria-selected={active}");
    expect(publicWorkspaceSource).toContain('data-part="close"');
    expect(tabContentSources).toContain('tab.kind === "review"');
    expect(tabContentSources).toContain('tab.kind === "terminal"');
    expect(tabContentSources).toContain('tab.kind === "file"');
    expect(tabContentSources).toContain('tab.kind === "markdown"');
    expect(tabContentSources).toContain('tab.kind === "sources"');
    expect(stylesSource).toContain(".sources-panel");
    expect(appSource).not.toContain("type RightSidebarView");
    expect(
      publicUiCssRule('[data-artemis-component="workspace-tab-bar"]'),
    ).toMatch(/\bdisplay:\s*flex/u);
  });

  it("adds overflow arrows plus touchpad and mouse-wheel tab scrolling", () => {
    const tabBarStart = appSource.indexOf("<WorkspaceTabBar");
    const tabBarEnd = appSource.indexOf(
      'className="workspace-tab-content"',
      tabBarStart,
    );
    const tabBarSource = appSource.slice(tabBarStart, tabBarEnd);
    const scrollRule = publicUiCssRule(
      '[data-artemis-component="workspace-tab-bar"] [data-part="scroll"]',
    );
    const scrollTrackRule = publicUiCssRule(
      '[data-artemis-component="workspace-tab-bar"] [data-part="track"]',
    );
    const scrollButtonRule = publicUiCssRule(
      '[data-artemis-component="workspace-tab-bar"]\n    :is([data-part="scroll-start"], [data-part="scroll-end"])',
    );

    expect(tabBarSource).toContain("<WorkspaceTabBar");
    expect(tabBarSource).toContain("workspaceTabScrollState.hasOverflow");
    expect(tabBarSource).toContain("scrollWorkspaceTabs(-1)");
    expect(tabBarSource).toContain("scrollWorkspaceTabs(1)");
    expect(tabBarSource).toContain("onWheel: handleWorkspaceTabWheel");
    expect(tabBarSource).toContain(
      "disabled={!workspaceTabScrollState.canScrollLeft}",
    );
    expect(tabBarSource).toContain(
      "disabled={!workspaceTabScrollState.canScrollRight}",
    );
    expect(appSource).toContain(
      "new ResizeObserver(syncWorkspaceTabScrollState)",
    );
    expect(appSource).toContain("activeWorkspaceTabElement");
    expect(scrollRule).toMatch(/\boverflow-x:\s*auto/u);
    expect(scrollTrackRule).toMatch(/\binline-size:\s*max-content/u);
    expect(scrollButtonRule).toMatch(/\bposition:\s*absolute/u);
    expect(
      publicUiCssRule(
        '[data-artemis-component="workspace-tab-bar"]\n    [data-part="scroll-shell"][data-overflow="true"]\n    [data-part="scroll"]',
      ),
    ).toMatch(
      /\bpadding-inline:\s*calc\(\s*var\(--artemis-size-control-compact\)\s*\+\s*var\(--artemis-space-1\)\s*\)/u,
    );
  });

  it("collapses only when the user closes the last workspace tab", () => {
    const handlerStart = appSource.indexOf(
      "const closeWorkspaceTab = useCallback(",
    );
    const handlerEnd = appSource.indexOf(
      "\n  const openWorkspaceTabForThread",
      handlerStart,
    );
    const handlerSource = appSource.slice(handlerStart, handlerEnd);
    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(handlerSource).toContain(
      "closesLastWorkspaceTab(workspaceTabs, tabId)",
    );
    expect(handlerSource).toContain('type: "close"');
    expect(handlerSource).toContain("setWorkspaceDockOpen(false)");
    expect(appSource).toContain(
      "onClose={() =>\n                            closeWorkspaceTab(tab.id, { moveFocus: true })",
    );
    expect(appSource).toContain("workspaceTabs.tabs.length === 0");
  });

  it("wires the plus control to an additional-tab menu without replacing existing instances", () => {
    const addClassIndex = appSource.indexOf('className="workspace-tab-add"');
    const addButtonStart = appSource.lastIndexOf("<button", addClassIndex);
    const addButtonEnd = appSource.indexOf("</button>", addClassIndex);
    const addButtonSource = appSource.slice(addButtonStart, addButtonEnd);

    expect(addClassIndex).toBeGreaterThan(-1);
    expect(addButtonStart).toBeGreaterThan(-1);
    expect(addButtonEnd).toBeGreaterThan(addButtonStart);
    expect(addButtonSource).toContain("onClick=");
    expect(addButtonSource).toMatch(/(?:<PlusIcon\s*\/>|>\s*\+\s*$)/u);
    expect(appSource).toContain("workspaceTabMenuOpen");
    expect(appSource).toContain('className="workspace-tab-menu"');
    const menuStart = appSource.indexOf('className="workspace-tab-menu"');
    const menuEnd = appSource.indexOf(".map(([kind, label, icon])", menuStart);
    const menuSource = appSource.slice(menuStart, menuEnd);
    expect(menuSource).not.toContain(
      '["markdown", t.markdownReader, <MarkdownIcon />]',
    );
    expect(menuSource).not.toContain('["sources", t.sources');
    expect(menuSource).toContain('["file", t.files, <FilesIcon />]');
    expect(appSource).toMatch(/type:\s*"open"/u);
    expect(cssRule(".workspace-tab-add")).toMatch(/\bflex:\s*0\s+0\s+auto/u);
  });

  it("dismisses the additional-tab menu on an outside press or Escape", () => {
    const effectStart = appSource.indexOf("if (!workspaceTabMenuOpen) return;");
    const effectEnd = appSource.indexOf(
      "const skillCommandMenuOpen",
      effectStart,
    );
    const effectSource = appSource.slice(effectStart, effectEnd);

    expect(appSource).toContain(
      "const workspaceTabMenuRoot = useRef<HTMLDivElement>(null);",
    );
    expect(appSource).toContain("ref={workspaceTabMenuRoot}");
    expect(effectStart).toBeGreaterThan(-1);
    expect(effectEnd).toBeGreaterThan(effectStart);
    expect(effectSource).toContain(
      "workspaceTabMenuRoot.current?.contains(event.target as Node)",
    );
    expect(effectSource).toContain(
      'document.addEventListener("pointerdown", closeOutside)',
    );
    expect(effectSource).toContain(
      'window.addEventListener("keydown", closeOnEscape)',
    );
    expect(effectSource).toContain('event.key === "Escape"');
    expect(effectSource).toContain("setWorkspaceTabMenuOpen(false)");
    expect(mainSource).toContain("view.startsWith('workspace-tab-menu')");
    expect(mainSource).toContain("workspace-tab-menu-outside-click");
    expect(mainSource).toContain("workspace-tab-menu-escape");
    expect(mainSource).toContain("Workspace tab menu did not open.");
    expect(mainSource).toContain(
      "Workspace tab menu remained open after dismissal.",
    );
  });

  it("renders file types with the Seti icon set instead of hand-built glyphs", () => {
    const directoryTreeStart = workspaceFilesSource.indexOf(
      "function DirectoryTree(",
    );
    const directoryTreeEnd = workspaceFilesSource.indexOf(
      "function isHtmlPath(",
      directoryTreeStart,
    );
    const directoryTreeSource = workspaceFilesSource.slice(
      directoryTreeStart,
      directoryTreeEnd,
    );

    expect(fileEditorSources).toContain("filePresentation(entry.path)");
    expect(directoryTreeSource).toContain("<WorkspaceFileIcon");
    expect(fileEditorSources).toContain("function WorkspaceFileIcon");
    expect(fileEditorSources).toContain('from "seti-file-icons"');
    expect(fileEditorSources).toContain('data-icon-source="seti"');
    expect(fileEditorSources).toContain("dangerouslySetInnerHTML");
    expect(fileEditorSources).toContain('aria-hidden="true"');
    expect(fileEditorSources).toContain("data-file-type={presentation.type}");
    expect(fileEditorSources).not.toContain("file-icon-badge-text");
    expect(fileEditorSources).not.toContain("file-icon-symbol");
    expect(directoryTreeSource).not.toContain('"◇"');
    expect(directoryTreeSource).not.toContain('"·"');
    expect(directoryTreeSource).not.toContain("presentation.icon");

    const representativePaths = [
      ".gitignore",
      ".prettierignore",
      "AGENTS.md",
      "package.json",
      "CMakeLists.txt",
      "LICENSE",
      "src/audio/bark_filterbank.cpp",
    ];
    const icons = representativePaths.map((path) =>
      setiFileIcon(path, filePresentation(path)),
    );

    expect(new Set(icons.map((icon) => icon.svg))).toHaveLength(
      representativePaths.length,
    );
    for (const path of representativePaths) {
      const markup = renderToStaticMarkup(
        createElement(WorkspaceFileIcon, {
          path,
          presentation: filePresentation(path),
          symlink: false,
        }),
      );
      expect(markup).toContain('data-icon-source="seti"');
      expect(markup).toContain("<svg");
      expect(markup).not.toContain("<text");
    }

    expect(setiFileIcon("README.md", filePresentation("README.md")).svg).toBe(
      setiFileIcon("AGENTS.md", filePresentation("AGENTS.md")).svg,
    );
    expect(
      setiFileIcon("tsconfig.base.json", filePresentation("tsconfig.base.json"))
        .svg,
    ).toBe(setiFileIcon("package.json", filePresentation("package.json")).svg);
  });

  it.each([
    [".gitignore", "git"],
    [".prettierignore", "prettier"],
    ["CMakeLists.txt", "cmake"],
    ["LICENSE", "license"],
    ["requirements.txt", "text"],
  ])("gives special file %s its own non-plain logo type", (path, type) => {
    const presentation = filePresentation(path);

    expect(presentation.type).toBe(type);
    expect(presentation.type).not.toBe("plain");
  });

  it("keeps file-type colors while using Seti icons in path-backed file tabs", () => {
    const fileIconStart = workspaceFilesSource.indexOf(
      "function WorkspaceFileIcon(",
    );
    const fileIconEnd = workspaceFilesSource.indexOf(
      "function DirectoryTree(",
      fileIconStart,
    );
    const fileIconSource = workspaceFilesSource.slice(
      fileIconStart,
      fileIconEnd,
    );
    const tabIconStart = appSource.indexOf("function WorkspaceTabIcon(");
    const tabIconEnd = appSource.indexOf(
      "function ComputerIcon()",
      tabIconStart,
    );
    const tabIconSource = appSource.slice(tabIconStart, tabIconEnd);
    const types = ["git", "prettier", "cmake", "license", "text"];

    expect(workspaceFilesSource).toContain("export function WorkspaceFileIcon");
    for (const type of types) {
      expect(stylesSource).toContain(`--file-${type}:`);
      expect(stylesSource).toContain(`[data-file-type="${type}"]`);
    }
    expect(appSource).toContain("filePresentation(path)");
    expect(appSource).toContain("<WorkspaceFileIcon");
    expect(tabIconSource).toContain("path={path}");
    expect(appSource).toMatch(
      /<WorkspaceTabIcon[\s\S]{0,240}?kind=\{tab\.kind\}[\s\S]{0,160}?path=\{tab\.path\}/u,
    );
    expect(tabIconSource).toMatch(
      /kind === "file"[\s\S]*?path\s*\?[\s\S]*?<WorkspaceFileIcon[\s\S]*?:\s*\(?\s*<FilesIcon/u,
    );
  });

  it("assigns file-type colors in the tree and syntax colors only to code editors", () => {
    expect(fileEditorSources).toContain('".ts"');
    expect(fileEditorSources).toContain('".md"');
    expect(fileEditorSources).toContain('".json"');
    expect(stylesSource).toContain('[data-file-type="typescript"]');
    expect(stylesSource).toContain('[data-file-type="markdown"]');
    expect(stylesSource).toContain('[data-file-type="json"]');
    expect(fileEditorSources).toContain("<WorkspaceSourceEditor");
    expect(publicWorkspaceSource).toContain("data-language={language}");
    expect(fileEditorSources).toContain("syntax-token");
    for (const token of ["keyword", "string", "comment", "number"]) {
      expect(stylesSource).toContain(`.syntax-token.${token}`);
    }
  });

  it.each([
    ["notes.txt", "plain", "const answer = 42; // this is prose"],
    ["LICENSE", "license", 'return "allowed" when 123 users agree'],
    ["logs/session.log", "plain", "# retry while false"],
  ])("keeps plain text in %s as one uncolored token", (path, type, content) => {
    const presentation = filePresentation(path);

    expect(presentation.type).toBe(type);
    expect(presentation.language).toBe("text");
    expect(tokenizeSourceLine(content, presentation.language)).toEqual([
      { kind: "plain", text: content },
    ]);
  });

  it.each([
    {
      path: "src/user.ts",
      language: "typescript",
      content:
        "interface User { name: string }\n" +
        "export function greet(user: User): string {\n" +
        "  const count = 2;\n" +
        "  return `Hello ${user.name}`; // friendly\n" +
        "}",
      expected: [
        ["keyword", "interface"],
        ["type", "User"],
        ["type", "string"],
        ["keyword", "export"],
        ["keyword", "function"],
        ["function", "greet"],
        ["number", "2"],
        ["string", "`Hello ${user.name}`"],
        ["comment", "// friendly"],
        ["operator", "="],
        ["punctuation", "{"],
      ],
    },
    {
      path: "src/Badge.tsx",
      language: "typescript",
      content:
        "export function Badge({ label }: Props) {\n" +
        '  return <button aria-label="run">{label}</button>; // clickable\n' +
        "}",
      expected: [
        ["keyword", "export"],
        ["keyword", "function"],
        ["function", "Badge"],
        ["type", "Props"],
        ["keyword", "return"],
        ["string", '"run"'],
        ["comment", "// clickable"],
        ["operator", "="],
        ["punctuation", "<"],
      ],
    },
    {
      path: "src/sum.c",
      language: "c",
      content:
        "#include <stdio.h>\n" +
        "int sum(int left, int right) {\n" +
        "  return left + right + 7; // total\n" +
        "}",
      expected: [
        ["type", "int"],
        ["function", "sum"],
        ["keyword", "return"],
        ["number", "7"],
        ["comment", "// total"],
        ["operator", "+"],
        ["punctuation", "("],
      ],
    },
    {
      path: "src/greet.cpp",
      language: "cpp",
      content:
        "#include <string>\n" +
        "std::string greet(const std::string& name) {\n" +
        '  return "Hi " + name; // greeting\n' +
        "}",
      expected: [
        ["type", "string"],
        ["function", "greet"],
        ["keyword", "const"],
        ["keyword", "return"],
        ["string", '"Hi "'],
        ["comment", "// greeting"],
        ["operator", "::"],
        ["operator", "+"],
        ["punctuation", "("],
      ],
    },
    {
      path: "scripts/greet.ps1",
      language: "powershell",
      content:
        "param([string]$Name)\n" +
        "function Invoke-Greeting {\n" +
        '  Write-Output "Hello $Name"\n' +
        "  if ($Name.Length -gt 3) { return 7 } # done\n" +
        "}",
      expected: [
        ["type", "string"],
        ["variable", "$Name"],
        ["keyword", "function"],
        ["function", "Invoke-Greeting"],
        ["string", '"Hello $Name"'],
        ["keyword", "if"],
        ["operator", "-gt"],
        ["number", "3"],
        ["keyword", "return"],
        ["number", "7"],
        ["comment", "# done"],
        ["punctuation", "("],
      ],
    },
  ])(
    "tokenizes $path with lossless, language-aware workspace highlighting",
    async ({ path, language, content, expected }) => {
      const tokenizeWorkspaceFile = await loadWorkspaceTokenizer();
      const presentation = filePresentation(path);

      expect(presentation.language).toBe(language);
      const tokens = tokenizeWorkspaceFile(content, presentation.language);
      expectLosslessTokens(tokens, content);
      for (const [kind, text] of expected) {
        expectToken(tokens, kind!, text!);
      }
    },
  );

  it("keeps the editable textarea over a separate syntax-token layer", () => {
    const markup = renderToStaticMarkup(
      createElement(WorkspaceFileEditor, {
        ariaLabel: "Edit src/user.ts",
        content: "const answer = 42;",
        dirty: false,
        path: "src/user.ts",
        saveError: undefined,
        saveLabel: "Save",
        savedLabel: "Saved",
        saveState: "idle",
        savingLabel: "Saving",
        unsavedLabel: "Unsaved",
        onChange: () => undefined,
        onSave: () => undefined,
      }),
    );
    const tokenLayerIndex = markup.indexOf('data-part="highlight"');
    const textareaIndex = markup.indexOf('data-part="source"');

    expect(tokenLayerIndex).toBeGreaterThan(-1);
    expect(textareaIndex).toBeGreaterThan(tokenLayerIndex);
    expect(markup).toContain('<pre aria-hidden="true"');
    expect(markup).toContain("<code>");
    expect(markup).toContain("<textarea");
    expect(
      publicUiCssRule(
        '[data-artemis-component="workspace-source-editor"] [data-part="highlight"]',
      ),
    ).toMatch(/\bposition:\s*absolute/u);
    expect(
      publicUiCssRule(
        '[data-artemis-component="workspace-source-editor"] [data-part="source"]',
      ),
    ).toMatch(/\bposition:\s*absolute/u);
    expect(
      publicUiCssRule(
        '[data-artemis-component="workspace-source-editor"] [data-part="source"]',
      ),
    ).toMatch(/\bbackground:\s*transparent/u);
  });

  it("uses the verified Codex font stacks and compact workspace typography", () => {
    const root = cssRule(":root");
    const filesPanel = publicUiCssRule(
      '[data-artemis-component="workspace-file-layout"]',
    );
    const treeRow = publicUiCssRule(
      '[data-artemis-component="workspace-file-tree-row"]',
    );
    const tabLabel = publicUiCssRule(
      '[data-artemis-component="workspace-tab"] [data-part="label"]',
    );
    const editor = publicUiCssRule(
      '[data-artemis-component="workspace-source-editor"]',
    );
    const editorText = publicUiCssRule(
      '[data-artemis-component="workspace-source-editor"]\n    :is([data-part="highlight"], [data-part="source"])',
    );
    const highlightCode = publicUiCssRule(
      '[data-artemis-component="workspace-source-editor"]\n    [data-part="highlight"]\n    code',
    );
    const comment = cssRule(".syntax-token.comment");
    const uiFont = cssPropertyValue(root, "--ui-font") ?? "";
    const monoFont = cssPropertyValue(root, "--mono-font") ?? "";

    expect
      .soft(uiFont, "UI font stack should match Codex order without extras")
      .toBe('-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
    expect
      .soft(monoFont, "Code font stack should match Codex order without extras")
      .toBe(
        'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      );
    expect(filesPanel).toMatch(
      /\bfont-family:\s*var\(--artemis-typography-body-family\)/u,
    );
    expect(treeRow).toMatch(/\bfont:\s*inherit/u);
    expect(editor).toMatch(
      /\bfont-family:\s*var\(--artemis-typography-code-family\)/u,
    );
    expect
      .soft(
        highlightCode,
        "The highlight code element must inherit the Codex mono stack",
      )
      .toMatch(/(?:^|;)\s*(?:font|font-family):\s*inherit\s*(?:;|$)/u);
    expect
      .soft(comment, "Code comments should remain upright")
      .not.toMatch(/\bfont-style:\s*italic/u);

    expect(editorText).toMatch(
      /\bfont-size:\s*calc\(var\(--artemis-typography-body-size\) \+ 1px\)/u,
    );
    expect(editorText).toMatch(/\bline-height:\s*1\.5/u);
    expect(treeRow).toMatch(
      /\bfont-size:\s*var\(--artemis-typography-body-size\)/u,
    );
    expect(treeRow).toMatch(/\bline-height:\s*1\.4/u);
    expect(tabLabel).toMatch(
      /\bfont-size:\s*var\(--artemis-typography-label-size\)/u,
    );
    expect(tabLabel).toMatch(/\bfont-weight:\s*600/u);
  });

  it("opens Markdown inside Files with rich and editable modes while keeping the tree mounted", () => {
    const openFileStart = workspaceFilesSource.indexOf(
      "const openFile = (entry:",
    );
    const openFileEnd = workspaceFilesSource.indexOf(
      "const saveFile =",
      openFileStart,
    );
    const openFileSource = workspaceFilesSource.slice(
      openFileStart,
      openFileEnd,
    );

    expect(openFileStart).toBeGreaterThan(-1);
    expect(openFileEnd).toBeGreaterThan(openFileStart);
    expect(openFileSource).toContain("readWorkspaceFile(threadId, entry.path)");
    expect(openFileSource).not.toContain("onOpenMarkdown");
    expect(workspaceFilesSource).not.toContain(
      "onOpenMarkdown(path: string): void",
    );
    expect(appSource).not.toMatch(
      /<WorkspaceFilesPanel[\s\S]{0,800}?onOpenMarkdown=/u,
    );
    expect(fileEditorSources).toContain("<MarkdownContent");
    expect(fileEditorSources).toContain('useState<"rich" | "source">');
    expect(fileEditorSources).toContain('setView("rich")');
    expect(fileEditorSources).toContain('setView("source")');
    expect(workspaceFilesSource).toContain("threadId={threadId}");
    expect(workspaceMarkdownEditorSource).toMatch(
      /window\.artemis\.readWorkspaceImage\(\s*threadId,\s*path,\s*href,?\s*\)/u,
    );
    expect(workspaceMarkdownEditorSource).toContain(
      "resolveImage={resolveImage}",
    );
    expect(fileEditorSources).toMatch(
      /<WorkspaceSourceEditor[\s\S]{0,500}?variant="markdown"/u,
    );
    const fileLayoutStart = workspaceFilesSource.indexOf(
      "<WorkspaceFileLayout",
    );
    const fileLayoutSource = workspaceFilesSource.slice(fileLayoutStart);
    expect(fileLayoutStart).toBeGreaterThan(-1);
    expect(fileLayoutSource.indexOf("viewer={")).toBeGreaterThan(-1);
    expect(fileLayoutSource.indexOf("tree={")).toBeGreaterThan(
      fileLayoutSource.indexOf("viewer={"),
    );
  });

  it("restores the selected file from the tab path after the Files panel remounts", () => {
    const filesPanelStart = appSource.indexOf("<WorkspaceFilesPanel");
    const filesPanelEnd = appSource.indexOf("/>", filesPanelStart);
    const filesPanelSource = appSource.slice(filesPanelStart, filesPanelEnd);

    expect(workspaceFilesSource).toContain("selectedPath: string | undefined;");
    expect(workspaceFilesSource).toMatch(
      /useEffect\(\(\)\s*=>\s*\{[\s\S]{0,900}?readWorkspaceFile\(\s*threadId,\s*selectedPath\s*\)/u,
    );
    expect(filesPanelStart).toBeGreaterThan(-1);
    expect(filesPanelEnd).toBeGreaterThan(filesPanelStart);
    expect(filesPanelSource).toContain("selectedPath={tab.path}");
  });

  it("does not render a duplicate preview title bar inside the Files tab", () => {
    expect(workspaceFilesSource).not.toContain(
      'className="preview-panel-header"',
    );
    expect(workspaceFilesSource).not.toMatch(/<strong>\{title\}<\/strong>/u);
  });

  it("edits normal workspace files and saves through the isolated IPC bridge", () => {
    expect(fileEditorSources).toContain("<WorkspaceSourceEditor");
    expect(fileEditorSources).toContain("onChange=");
    expect(fileEditorSources).toMatch(/value=\{[^}]*(?:draft|content)[^}]*\}/u);
    expect(fileEditorSources).toMatch(
      /window\.artemis\s*\.writeWorkspaceFile/u,
    );
    expect(apiSource).toContain("writeWorkspaceFile(");
    expect(apiSource).toContain(
      'workspaceFileWrite: "artemis:workspace-file-write"',
    );
    expect(preloadSource).toMatch(
      /writeWorkspaceFile:[\s\S]{0,200}?IPC\.workspaceFileWrite/u,
    );
    expect(mainSource).toContain("IPC.workspaceFileWrite");
    expect(workspaceTextFileSource).toContain(
      "export async function writeWorkspaceFile",
    );
  });

  it("toggles Markdown preview and editable raw text and saves the raw draft", () => {
    expect(workspacePreviewSource).toContain("<MarkdownContent");
    expect(workspacePreviewSource).toContain("<WorkspaceEditorToolbar");
    expect(workspacePreviewSource).toContain("modeToggle={{");
    expect(workspacePreviewSource).toContain("onChange: setView");
    expect(workspacePreviewSource).toContain("richLabel: props.richLabel");
    expect(workspacePreviewSource).toContain("sourceLabel: props.sourceLabel");
    expect(workspacePreviewSource).toContain("value: view");
    expect(workspacePreviewSource).toMatch(
      /<WorkspaceSourceEditor[\s\S]{0,500}?variant="markdown"/u,
    );
    expect(workspacePreviewSource).toContain("onChange=");
    expect(workspacePreviewSource).toMatch(
      /value=\{[^}]*(?:draft|content)[^}]*\}/u,
    );
    expect(workspacePreviewSource).toMatch(
      /window\.artemis\s*\.writeWorkspaceFile/u,
    );
    expect(workspacePreviewSource).toContain("onSave={saveMarkdown}");
    expect(publicWorkspaceSource).toContain('data-part="save"');
    expect(publicWorkspaceSource).toContain("onClick={onSave}");
  });
});
