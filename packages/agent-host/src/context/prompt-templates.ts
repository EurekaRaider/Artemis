import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

export interface DesktopPromptTemplate {
  name: string;
  description: string;
  argumentHint?: string;
  content: string;
  scope: "user" | "project";
}

/** Discovery is text-only: listing templates never installs packages or runs extensions. */
export async function listPromptTemplates(
  agentDir: string,
  cwd?: string,
): Promise<DesktopPromptTemplate[]> {
  const result = new Map<string, DesktopPromptTemplate>();
  const roots: Array<[string, "user" | "project"]> = [
    [join(agentDir, "prompts"), "user"],
  ];
  if (cwd) roots.push([join(cwd, ".pi", "prompts"), "project"]);
  for (const [directory, scope] of roots) {
    const files = await readdir(directory, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
      if (
        (!file.isFile() && !file.isSymbolicLink()) ||
        !file.name.endsWith(".md")
      )
        continue;
      const name = file.name.slice(0, -3);
      if (!name || /[\s:]/u.test(name) || result.has(name)) continue;
      const path = join(directory, file.name);
      const info = await stat(path).catch(() => undefined);
      if (!info || !info.isFile() || info.size > 64 * 1024) continue;
      try {
        const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(
          await readFile(path, "utf8"),
        );
        result.set(name, {
          name,
          scope,
          content: body,
          description:
            typeof frontmatter.description === "string"
              ? frontmatter.description
              : (body.split("\n").find((line) => line.trim()) ?? ""),
          ...(typeof frontmatter["argument-hint"] === "string"
            ? { argumentHint: frontmatter["argument-hint"] }
            : {}),
        });
      } catch {
        // Match Pi discovery: one unreadable or malformed file must not hide other templates.
        continue;
      }
    }
  }
  return [...result.values()];
}

/** Pi's template helpers are not public SDK exports. Keep this text-only expansion
 * at the user-input boundary, before Artemis adds its own instructions. */
export function expandDesktopPromptTemplate(
  text: string,
  templates: readonly { name: string; content: string }[],
): string {
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text.trimStart());
  const template = match && templates.find((item) => item.name === match[1]);
  if (!template) return text;
  const input = match[2] ?? "";
  const args: string[] = [];
  let token = "",
    started = false,
    quote = "",
    quoteStart = 0;
  for (let i = 0; i < input.length; i++) {
    const character = input[i]!;
    if (quote) {
      if (character === "\\" && input[i + 1] === quote) token += input[++i];
      else if (character === quote) quote = "";
      else token += character;
    } else if (/\s/u.test(character)) {
      if (started) args.push(token);
      token = "";
      started = false;
    } else {
      if (!started && (character === '"' || character === "'")) {
        quote = character;
        quoteStart = i;
      } else token += character;
      started = true;
    }
    if (quote && i === input.length - 1) {
      quote = "";
      token = input[quoteStart]!;
      i = quoteStart;
    }
  }
  if (started) args.push(token);
  return template.content.replace(
    /\$\{(\d+|@|ARGUMENTS):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
    (
      _match,
      braced: string | undefined,
      fallback: string | undefined,
      start: string | undefined,
      length: string | undefined,
      bare: string | undefined,
    ) => {
      if (start) {
        const index = Math.max(0, Number(start) - 1);
        return args
          .slice(
            index,
            length === undefined ? undefined : index + Number(length),
          )
          .join(" ");
      }
      const key = braced ?? bare;
      const value =
        key === "@" || key === "ARGUMENTS"
          ? args.join(" ")
          : (args[Number(key) - 1] ?? "");
      return value || fallback || "";
    },
  );
}

/** Refresh only text templates; do not reload packages, extensions, or tool state. */
export async function prepareDesktopTemplateInput(
  text: string,
  agentDir: string,
  cwd: string,
): Promise<string> {
  const match = /^\/([^\s:]+)(?:\s|$)/u.exec(text.trimStart());
  if (!match) return text;
  const templates = await listPromptTemplates(agentDir, cwd);
  const expanded = expandDesktopPromptTemplate(text, templates);
  // Pi's queue API expands slash commands too. A template body is literal input,
  // even if it begins with another command or matches its invocation. Unknown
  // commands also stay literal instead of using a deleted, cached Pi template.
  return expanded.startsWith("/") ? `\n${expanded}` : expanded;
}
