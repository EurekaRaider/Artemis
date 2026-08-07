function stripTerminalSequences(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const replacementEscape =
      code === 0xfffd && (value[index + 1] === "[" || value[index + 1] === "]");
    if (code !== 0x1b && !replacementEscape) {
      output += value[index];
      continue;
    }

    const introducerIndex = replacementEscape ? index + 1 : index + 1;
    const introducer = value[introducerIndex];
    if (introducer === "[") {
      index = introducerIndex + 1;
      while (index < value.length) {
        const current = value.charCodeAt(index);
        if (current >= 0x40 && current <= 0x7e) break;
        index += 1;
      }
      continue;
    }
    if (introducer === "]") {
      index = introducerIndex + 1;
      while (index < value.length) {
        if (value.charCodeAt(index) === 0x07) break;
        if (value.charCodeAt(index) === 0x1b && value[index + 1] === "\\") {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    index = introducerIndex;
  }
  return output;
}

function normalizeProgressFrames(value: string): string {
  return value
    .split("\n")
    .map((line) => {
      const frames = line.split("\r");
      for (let index = frames.length - 1; index >= 0; index -= 1) {
        if (frames[index]) return frames[index];
      }
      return "";
    })
    .join("\n");
}

export type ToolPresentationLocale = "en" | "zh-CN";

export type ToolActivityKind = "read" | "write" | "search" | "bash" | "generic";

export interface ToolPresentationState {
  name: string;
  input?: unknown;
  output: string;
  status: "running" | "completed" | "failed";
}

function inputText(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object" || !(key in input)) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compactLabel(value: string, maximumLength = 68): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length <= maximumLength
    ? compact
    : `${compact.slice(0, maximumLength - 1).trimEnd()}…`;
}

function shellWords(value: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (escaped) current += "\\";
  if (current) words.push(current);
  return words;
}

function executableName(value: string): string {
  return value
    .replace(/^.*[\\/]/u, "")
    .replace(/\.(?:cmd|exe|ps1|sh)$/iu, "")
    .toLowerCase();
}

function searchCommandDetails(
  command: string,
): { pattern: string; scope?: string } | undefined {
  const words = shellWords(command);
  const searchIndex = words.findIndex((word) =>
    ["rg", "grep"].includes(executableName(word)),
  );
  if (searchIndex < 0) return undefined;

  const optionsWithValues = new Set([
    "-A",
    "-B",
    "-C",
    "-f",
    "-g",
    "-m",
    "-t",
    "--after-context",
    "--before-context",
    "--context",
    "--encoding",
    "--engine",
    "--file",
    "--glob",
    "--max-count",
    "--type",
  ]);
  let pattern: string | undefined;
  for (let index = searchIndex + 1; index < words.length; index += 1) {
    const word = words[index]!;
    if (word === "-e" || word === "--regexp") {
      pattern = words[index + 1];
      index += 1;
      continue;
    }
    if (optionsWithValues.has(word)) {
      index += 1;
      continue;
    }
    if (word.startsWith("-")) continue;
    if (!pattern) {
      pattern = word;
      continue;
    }
    return { pattern, scope: word };
  }
  return pattern ? { pattern } : undefined;
}

function searchPattern(command: string): string | undefined {
  return searchCommandDetails(command)?.pattern;
}

function readablePattern(value: string): string {
  const firstAlternative = value.split("|", 1)[0] ?? value;
  return compactLabel(
    firstAlternative
      .replace(/\\([.^$*+?()[\]{}|\\-])/gu, "$1")
      .replace(/^[.^$*+?]+|[.$*+?]+$/gu, ""),
    42,
  );
}

function bashSummary(command: string, locale: ToolPresentationLocale): string {
  const normalized = command.replace(/\s+/gu, " ").trim();
  const pattern = searchPattern(normalized);
  if (pattern) {
    const target = readablePattern(pattern) || "files";
    const searchesStyles = /\bstyles?\.(?:css|scss|sass|less)\b/iu.test(
      normalized,
    );
    if (locale === "zh-CN") {
      return searchesStyles
        ? `正在搜索 ${target} 相关样式`
        : `正在搜索 ${target} 文件夹中的文件`;
    }
    return searchesStyles
      ? `Searching styles for ${target}`
      : `Searching files for ${target}`;
  }
  if (/(?:^|[;&|]\s*|\s)git(?:\.exe)?\s+status\b/iu.test(normalized)) {
    return locale === "zh-CN"
      ? "正在检查工作区更改"
      : "Checking workspace changes";
  }
  if (
    /(?:^|[;&|]\s*|\s)(?:npm|pnpm|yarn|bun|npx)\s+(?:run\s+)?(?:test|vitest)\b/iu.test(
      normalized,
    ) ||
    /(?:^|[;&|]\s*|\s)vitest\b/iu.test(normalized)
  ) {
    return locale === "zh-CN" ? "正在运行测试" : "Running tests";
  }
  if (/\b(?:typecheck|tsc|tsgo)\b/iu.test(normalized)) {
    return locale === "zh-CN" ? "正在检查类型" : "Checking types";
  }
  if (
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b/iu.test(normalized) ||
    /(?:^|[;&|]\s*|\s)(?:ninja|cmake)\b/iu.test(normalized)
  ) {
    return locale === "zh-CN" ? "正在构建项目" : "Building the project";
  }

  const executable = shellWords(normalized)
    .map(executableName)
    .find((word) => word && !word.startsWith("$") && word !== "=");
  const label = compactLabel(executable || "command", 32);
  return locale === "zh-CN" ? `正在运行 ${label}` : `Running ${label}`;
}

function normalizedToolName(toolName: string): string {
  return toolName.trim().toLowerCase();
}

function isBashTool(toolName: string): boolean {
  return ["bash", "bash_wait", "bash_cancel"].includes(
    normalizedToolName(toolName),
  );
}

export function toolActivityKind(
  toolName: string,
  input?: unknown,
): ToolActivityKind {
  const normalized = normalizedToolName(toolName);
  if (
    normalized === "bash" &&
    searchPattern(inputText(input, "command") ?? "")
  ) {
    return "search";
  }
  if (["read", "read_file"].includes(normalized)) return "read";
  if (["write", "write_file", "edit", "apply_patch"].includes(normalized)) {
    return "write";
  }
  if (["grep", "find", "search"].includes(normalized)) return "search";
  if (isBashTool(normalized)) return "bash";
  return "generic";
}

export function toolActivityGroupKey(
  toolName: string,
  input?: unknown,
): string {
  const kind = toolActivityKind(toolName, input);
  if (kind === "read" || kind === "search") return "file-exploration";
  if (kind === "write") return "file-editing";
  if (kind === "bash") return "bash";
  return `tool:${normalizedToolName(toolName)}`;
}

function completedSummary(
  summary: string,
  locale: ToolPresentationLocale,
): string {
  if (locale === "zh-CN") {
    return summary
      .replace(/^正在搜索/u, "已搜索")
      .replace(/^正在检查/u, "已检查")
      .replace(/^正在运行/u, "已运行")
      .replace(/^正在构建/u, "已构建")
      .replace(/^正在使用/u, "已使用");
  }
  return summary
    .replace(/^Searching/u, "Searched")
    .replace(/^Checking/u, "Checked")
    .replace(/^Running/u, "Ran")
    .replace(/^Building/u, "Built")
    .replace(/^Using/u, "Used");
}

export function summarizeToolGroup(
  tools: readonly ToolPresentationState[],
  locale: ToolPresentationLocale,
): string {
  const running = [...tools]
    .reverse()
    .find((tool) => tool.status === "running");
  const representative =
    running ??
    [...tools]
      .reverse()
      .find((tool) => toolActivityKind(tool.name, tool.input) === "search") ??
    tools.at(-1);
  if (!representative) {
    return locale === "zh-CN" ? "正在使用工具" : "Using a tool";
  }

  const kind = toolActivityKind(representative.name, representative.input);
  if (kind === "read") {
    return running
      ? locale === "zh-CN"
        ? "正在读取文件"
        : "Reading files"
      : locale === "zh-CN"
        ? "已读取文件"
        : "Read files";
  }
  if (kind === "write") {
    return running
      ? locale === "zh-CN"
        ? "正在编辑文件"
        : "Editing files"
      : locale === "zh-CN"
        ? "编辑了文件"
        : "Edited files";
  }
  if (kind === "bash") {
    return running
      ? locale === "zh-CN"
        ? "正在执行bash"
        : "Running Bash"
      : locale === "zh-CN"
        ? "执行了bash"
        : "Ran Bash";
  }

  const summary = summarizeToolActivity(
    representative.name,
    representative.input,
    locale,
  );
  return running ? summary : completedSummary(summary, locale);
}

export function toolActivityPath(input: unknown): string | undefined {
  return (
    inputText(input, "path") ??
    inputText(input, "filePath") ??
    inputText(input, "file")
  );
}

export function summarizeToolDetail(
  tool: ToolPresentationState,
  locale: ToolPresentationLocale,
): string {
  const kind = toolActivityKind(tool.name, tool.input);
  const path = toolActivityPath(tool.input);
  const searchCommand =
    normalizedToolName(tool.name) === "bash"
      ? searchCommandDetails(inputText(tool.input, "command") ?? "")
      : undefined;
  const pattern =
    inputText(tool.input, "pattern") ??
    inputText(tool.input, "query") ??
    searchCommand?.pattern;
  const label = compactLabel(path ?? pattern ?? tool.name.replaceAll("_", " "));
  const active = tool.status === "running";

  if (kind === "read") {
    return locale === "zh-CN"
      ? `${active ? "正在读取" : "已读取"} ${label}`
      : `${active ? "Reading" : "Read"} ${label}`;
  }
  if (kind === "write") {
    return locale === "zh-CN"
      ? `${active ? "正在编辑" : "已编辑"} ${label}`
      : `${active ? "Editing" : "Edited"} ${label}`;
  }
  if (kind === "search") {
    if (pattern) {
      const target = readablePattern(pattern) || compactLabel(pattern, 42);
      const scope = path ?? searchCommand?.scope;
      if (locale === "zh-CN") {
        return scope
          ? `${active ? "正在" : "已"}在 ${compactLabel(scope, 42)} 中搜索“${target}”`
          : `${active ? "正在搜索" : "已搜索"}“${target}”`;
      }
      return scope
        ? `${active ? "Searching" : "Searched"} for “${target}” in ${compactLabel(scope, 42)}`
        : `${active ? "Searching for" : "Searched for"} “${target}”`;
    }
    return locale === "zh-CN"
      ? `${active ? "正在搜索" : "已搜索"} ${label}`
      : `${active ? "Searching for" : "Searched for"} ${label}`;
  }
  const summary = summarizeToolActivity(tool.name, tool.input, locale);
  return active ? summary : completedSummary(summary, locale);
}

export function summarizeToolActivity(
  toolName: string,
  input: unknown,
  locale: ToolPresentationLocale,
): string {
  if (toolName === "bash") {
    return bashSummary(inputText(input, "command") ?? "", locale);
  }

  const path =
    inputText(input, "path") ??
    inputText(input, "filePath") ??
    inputText(input, "file");
  const pattern = inputText(input, "pattern") ?? inputText(input, "query");
  const label = compactLabel(path ?? pattern ?? toolName.replaceAll("_", " "));
  const action =
    toolName === "read"
      ? locale === "zh-CN"
        ? "正在读取"
        : "Reading"
      : toolName === "write" || toolName === "edit"
        ? locale === "zh-CN"
          ? "正在更新"
          : "Updating"
        : toolName === "grep" || toolName === "find"
          ? locale === "zh-CN"
            ? "正在搜索"
            : "Searching"
          : locale === "zh-CN"
            ? "正在使用"
            : "Using";
  return `${action} ${label}`;
}

export function formatToolInput(
  toolName: string,
  input: unknown,
): string | undefined {
  if (input === undefined) return undefined;
  if (
    toolName === "bash" &&
    typeof input === "object" &&
    input !== null &&
    "command" in input &&
    typeof input.command === "string"
  ) {
    return `$ ${input.command}`;
  }
  return JSON.stringify(input, null, 2);
}

export function sanitizeToolOutput(output: string): string {
  return normalizeProgressFrames(stripTerminalSequences(output))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replace(/[ \t]+$/gmu, "")
    .trimEnd();
}

function observedBashOutput(output: string): string | undefined {
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(output);
  } catch {
    return undefined;
  }
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    !("executionId" in snapshot) ||
    !("status" in snapshot) ||
    !("outputDelta" in snapshot)
  ) {
    return undefined;
  }
  const value = snapshot as { outputDelta?: unknown; error?: unknown };
  const chunks: string[] = [];
  if (typeof value.outputDelta === "string" && value.outputDelta) {
    chunks.push(value.outputDelta);
  }
  if (typeof value.error === "string" && value.error.trim()) {
    chunks.push(value.error.trim());
  }
  return chunks.join("\n");
}

export function formatToolOutput(
  toolName: string,
  output: string,
): string | undefined {
  if (!output) return undefined;
  const visible = isBashTool(toolName)
    ? (observedBashOutput(output) ?? output)
    : output;
  const sanitized = sanitizeToolOutput(visible);
  return sanitized || undefined;
}

export function formatBashTranscript(
  tools: readonly ToolPresentationState[],
): string | undefined {
  const chunks: string[] = [];
  for (const tool of tools) {
    if (normalizedToolName(tool.name) === "bash") {
      const command = formatToolInput(tool.name, tool.input);
      if (command) chunks.push(command);
    }
    const output = formatToolOutput(tool.name, tool.output);
    if (output) chunks.push(output);
  }
  return chunks.length > 0 ? chunks.join("\n") : undefined;
}
