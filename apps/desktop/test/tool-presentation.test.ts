import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

type FormatToolInput = (toolName: string, input: unknown) => string | undefined;
type FormatToolOutput = (
  toolName: string,
  output: string,
) => string | undefined;
type FormatBashTranscript = (
  tools: Array<{
    name: string;
    input?: unknown;
    output: string;
    status: "running" | "completed" | "failed";
  }>,
) => string | undefined;
type SanitizeToolOutput = (output: string) => string;
type ToolActivityKind = (
  toolName: string,
  input?: unknown,
) => "read" | "write" | "search" | "bash" | "generic";
type SummarizeToolActivity = (
  toolName: string,
  input: unknown,
  locale: "en" | "zh-CN",
) => string;
type SummarizeToolGroup = (
  tools: Array<{
    name: string;
    input?: unknown;
    output: string;
    status: "running" | "completed" | "failed";
  }>,
  locale: "en" | "zh-CN",
) => string;
type SummarizeToolDetail = (
  tool: {
    name: string;
    input?: unknown;
    output: string;
    status: "running" | "completed" | "failed";
  },
  locale: "en" | "zh-CN",
) => string;

const modulePath: string = "../src/renderer/tool-presentation.js";
const toolPresentation = (await import(modulePath).catch(() => ({}))) as {
  formatToolInput?: FormatToolInput;
  formatToolOutput?: FormatToolOutput;
  formatBashTranscript?: FormatBashTranscript;
  sanitizeToolOutput?: SanitizeToolOutput;
  toolActivityKind?: ToolActivityKind;
  summarizeToolActivity?: SummarizeToolActivity;
  summarizeToolDetail?: SummarizeToolDetail;
  summarizeToolGroup?: SummarizeToolGroup;
};
const appSource = readFileSync(
  new URL("../src/renderer/App.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);

describe("tool presentation", () => {
  it("summarizes Bash searches and workspace checks without exposing raw commands", () => {
    expect(toolPresentation.summarizeToolActivity).toBeTypeOf("function");
    if (!toolPresentation.summarizeToolActivity) return;

    const search = {
      command:
        "rg -n -C 12 'automation-primary|automation-header|automation-page' apps/desktop/src/renderer/styles.css",
    };
    expect(toolPresentation.summarizeToolActivity("bash", search, "en")).toBe(
      "Searching styles for automation-primary",
    );
    expect(
      toolPresentation.summarizeToolActivity("bash", search, "zh-CN"),
    ).toBe("正在搜索 automation-primary 相关样式");
    expect(
      toolPresentation.summarizeToolActivity(
        "bash",
        { command: "git status --short" },
        "en",
      ),
    ).toBe("Checking workspace changes");
    expect(
      toolPresentation.summarizeToolActivity(
        "bash",
        { command: "git status --short" },
        "zh-CN",
      ),
    ).toBe("正在检查工作区更改");
  });

  it("keeps generic Bash summaries bounded and single-line", () => {
    expect(toolPresentation.summarizeToolActivity).toBeTypeOf("function");
    if (!toolPresentation.summarizeToolActivity) return;

    const summary = toolPresentation.summarizeToolActivity(
      "bash",
      {
        command:
          'pwsh -NoProfile -Command "Invoke-Something-With-A-Very-Long-Name\\nWrite-Output secret-detail"',
      },
      "en",
    );

    expect(summary).toBe("Running pwsh");
    expect(summary.length).toBeLessThanOrEqual(68);
    expect(summary).not.toContain("\n");
    expect(summary).not.toContain("Invoke-Something");
  });

  it("uses one stable Bash-group label instead of exposing individual commands", () => {
    expect(toolPresentation.summarizeToolGroup).toBeTypeOf("function");
    if (!toolPresentation.summarizeToolGroup) return;

    expect(
      toolPresentation.summarizeToolGroup(
        [
          {
            name: "bash",
            input: { command: "npm test" },
            output: "",
            status: "running",
          },
        ],
        "zh-CN",
      ),
    ).toBe("正在执行 Shell");
  });

  it("describes expanded file searches with query and scope", () => {
    expect(toolPresentation.summarizeToolDetail).toBeTypeOf("function");
    if (!toolPresentation.summarizeToolDetail) return;

    expect(
      toolPresentation.summarizeToolDetail(
        {
          name: "bash",
          input: {
            command:
              'rg -n "thinking-card|tool-card" apps/desktop/src/renderer',
          },
          output: "",
          status: "completed",
        },
        "zh-CN",
      ),
    ).toBe("已在 apps/desktop/src/renderer 中搜索“thinking-card”");
  });

  it("does not describe a search pattern as a folder name", () => {
    expect(toolPresentation.summarizeToolActivity).toBeTypeOf("function");
    if (!toolPresentation.summarizeToolActivity) return;

    const search = {
      command: 'rg -n "ContextUsageIndicator" apps/desktop/src/renderer',
    };
    expect(
      toolPresentation.summarizeToolActivity("bash", search, "zh-CN"),
    ).toBe("正在 apps/desktop/src/renderer 中搜索“ContextUsageIndicator”");
    expect(toolPresentation.summarizeToolActivity("bash", search, "en")).toBe(
      "Searching for “ContextUsageIndicator” in apps/desktop/src/renderer",
    );
  });

  it("renders Bash input as a shell command instead of a JSON object", () => {
    expect(toolPresentation.formatToolInput).toBeTypeOf("function");
    if (!toolPresentation.formatToolInput) return;

    const rendered = toolPresentation.formatToolInput("bash", {
      command: 'cd "D:\\Git\\PEAQ_PRB" && codegraph index',
      timeout: 120,
    });

    expect(rendered).toBe('$ cd "D:\\Git\\PEAQ_PRB" && codegraph index');
    expect(rendered).not.toContain("{");
    expect(rendered).not.toContain('"command"');
    expect(rendered).not.toContain('"timeout"');
  });

  it("removes ANSI CSI and OSC control sequences from tool output", () => {
    expect(toolPresentation.sanitizeToolOutput).toBeTypeOf("function");
    if (!toolPresentation.sanitizeToolOutput) return;

    expect(
      toolPresentation.sanitizeToolOutput(
        "\u001b[38;2;175;115;14mResolving refs\u001b[0m " +
          "\u001b]8;;https://example.test\u0007details\u001b]8;;\u0007",
      ),
    ).toBe("Resolving refs details");
  });

  it("keeps only the last carriage-return progress frame", () => {
    expect(toolPresentation.sanitizeToolOutput).toBeTypeOf("function");
    if (!toolPresentation.sanitizeToolOutput) return;

    expect(
      toolPresentation.sanitizeToolOutput(
        "0% Resolving refs\r55% Resolving refs\r100% Resolving refs\nDone",
      ),
    ).toBe("100% Resolving refs\nDone");
  });

  it("removes replacement-prefixed CSI fragments already decoded by Windows", () => {
    expect(toolPresentation.sanitizeToolOutput).toBeTypeOf("function");
    if (!toolPresentation.sanitizeToolOutput) return;

    expect(
      toolPresentation.sanitizeToolOutput(
        "96%\uFFFD[K\uFFFD[2m Parsing code \uFFFD[0m",
      ),
    ).toBe("96% Parsing code");
  });

  it("extracts only terminal output from historical observed-Bash metadata", () => {
    expect(toolPresentation.formatToolOutput).toBeTypeOf("function");
    if (!toolPresentation.formatToolOutput) return;

    const rendered = toolPresentation.formatToolOutput(
      "bash",
      JSON.stringify({
        executionId: "execution-1",
        command: "ls",
        status: "completed",
        health: "healthy",
        outputDelta: "README.md\npackage.json\n",
      }),
    );
    expect(rendered).toBe("README.md\npackage.json");
    expect(rendered).not.toContain("executionId");
    expect(rendered).not.toContain("health");
  });

  it("renders one live-style Bash transcript from command and output chunks", () => {
    expect(toolPresentation.formatBashTranscript).toBeTypeOf("function");
    if (!toolPresentation.formatBashTranscript) return;

    expect(
      toolPresentation.formatBashTranscript([
        {
          name: "bash",
          input: { command: "npm test", deadline_seconds: 30 },
          output: "first chunk\n",
          status: "running",
        },
        {
          name: "bash_wait",
          input: { execution_id: "execution-1" },
          output: "final chunk\n",
          status: "completed",
        },
      ]),
    ).toBe("$ npm test\nfirst chunk\nfinal chunk");
  });

  it("wires grouped file activities and Bash transcripts into tool cards", () => {
    const toolCard = appSource.slice(
      appSource.indexOf("function ToolActivityGroupCard"),
      appSource.indexOf("function Timeline"),
    );

    expect(toolCard).toContain("formatToolInput(tool.name, tool.input)");
    expect(toolCard).toContain("formatToolOutput(tool.name, tool.output)");
    expect(toolCard).toContain("formatBashTranscript(tools)");
    expect(toolCard).toContain('className="tool-activity-list"');
    expect(toolCard).toContain('className="bash-transcript"');
    expect(toolCard).not.toContain("JSON.stringify(tool.input, null, 2)");
  });

  it("renders every operation kind with adjacent disclosure and running shimmer", () => {
    expect(toolPresentation.toolActivityKind).toBeTypeOf("function");
    if (!toolPresentation.toolActivityKind) return;

    expect(
      [
        "read",
        "local_file_read",
        "write",
        "local_file_write",
        "grep",
        "shell",
        "mcp_lookup",
      ].map((toolName) => toolPresentation.toolActivityKind?.(toolName)),
    ).toEqual(["read", "read", "write", "write", "search", "bash", "generic"]);

    const toolCard = appSource.slice(
      appSource.indexOf("function ToolActivityGroupCard"),
      appSource.indexOf("function Timeline"),
    );

    expect(toolCard).toContain(
      '<section className={`tool-card ${visualStatus}${open ? " open" : ""}`}>',
    );
    expect(toolCard).toContain(
      'const visualStatus = active && status === "completed" ? "running" : status;',
    );
    expect(toolCard).toContain('className="tool-summary-row"');
    expect(toolCard).toContain("summarizeToolGroup(tools, locale)");
    expect(toolCard).toContain('className="tool-activity-icon"');
    expect(toolCard).toContain('className="tool-summary-label"');
    expect(toolCard).toContain('className="tool-disclosure"');
    expect(toolCard).toContain("onClick={() => setOpen((value) => !value)}");
    expect(toolCard).toContain("{open && fileActivity && (");
    expect(toolCard).toContain(
      '{open && kind === "bash" && bashTranscript && (',
    );
    expect(toolCard).toContain('className="tool-details"');
    expect(toolCard.indexOf('className="tool-summary-label"')).toBeLessThan(
      toolCard.indexOf('className="tool-disclosure"'),
    );
    expect(toolCard).not.toContain("<strong>{tool.name}</strong>");
    expect(toolCard).not.toContain("<span>{tool.status}</span>");
    expect(toolCard).not.toContain("defaultOpen");
    expect(stylesSource).toMatch(
      /\.tool-summary-row\s*\{[\s\S]*?display: flex;[\s\S]*?gap: 9px;/u,
    );
    expect(stylesSource).toMatch(
      /\.tool-disclosure\s*\{[\s\S]*?flex: 0 0 24px;/u,
    );
    expect(stylesSource).not.toContain(
      "grid-template-columns: 20px minmax(0, 1fr) 24px",
    );
    expect(stylesSource).toMatch(
      /\.tool-card\.running \.tool-summary-label\s*\{[\s\S]*?animation: tool-summary-shimmer/u,
    );
    expect(stylesSource).toContain("@keyframes tool-summary-shimmer");
    expect(stylesSource).toMatch(
      /@keyframes tool-summary-shimmer\s*\{[\s\S]*?background-position: 100% 50%[\s\S]*?background-position: 0% 50%/u,
    );
    expect(stylesSource).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none/u,
    );
  });

  it("keeps the latest tool group shimmering while the turn is still running", () => {
    expect(appSource).toContain(
      'state.status === "running" && state.queue.steering.length === 0',
    );
    expect(appSource).toContain(
      "latestVisibleToolGroupKey(timelineEntries, state.messageParts)",
    );
    expect(appSource).toContain(
      "active={timelineEntry.key === activeToolGroupKey}",
    );
  });
});
