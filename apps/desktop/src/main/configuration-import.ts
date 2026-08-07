import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import JSON5 from "json5";
import { parse as parseToml } from "smol-toml";

import type {
  ConfigurationImportCategory,
  ConfigurationImportCounts,
  ConfigurationImportPreview,
  ConfigurationImportRequest,
  ConfigurationImportSource,
  ConfigurationImportSummary,
  McpServerConfig,
} from "../shared/api.js";
import { GlobalInstructionsStore } from "./global-instructions-store.js";

const MAX_CONFIG_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_FILES = 500;
const MAX_SKILL_BYTES = 20 * 1024 * 1024;
const IMPORT_SOURCES: ConfigurationImportSource[] = [
  "codex",
  "opencode",
  "claude",
];

type UnknownRecord = Record<string, unknown>;

export interface ConfigurationImportPayload {
  mcpServers: McpServerConfig[];
  summary: ConfigurationImportSummary;
}

interface ImportedInstruction {
  path: string;
  content: string;
}

interface ImportedSkill {
  path: string;
  name: string;
}

interface LoadedSource {
  source: ConfigurationImportSource;
  detectedPaths: string[];
  instructions: ImportedInstruction[];
  skills: ImportedSkill[];
  mcpServers: McpServerConfig[];
  warnings: string[];
}

interface ConfigurationImportServiceOptions {
  homePath: string;
  skillsPath: string;
  mcpWorkspaceRoot: string;
  globalInstructions: GlobalInstructionsStore;
}

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function enabled(value: unknown): boolean {
  return value !== false;
}

function emptyCounts(): ConfigurationImportCounts {
  return { instructions: 0, skills: 0, mcp: 0 };
}

function safeId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[^a-z0-9]+/u, "")
    .slice(0, 64);
  return normalized || "imported";
}

function safeSkillName(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/gu, "-")
      .replace(/^[.-]+|[.-]+$/gu, "")
      .slice(0, 80) || "imported-skill"
  );
}

function resolveCwd(value: unknown, configPath: string, fallback: string) {
  const cwd = text(value);
  if (!cwd) return fallback;
  return isAbsolute(cwd) ? cwd : resolve(dirname(configPath), cwd);
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_CONFIG_BYTES) {
      throw new Error(`Configuration file is not a file under 2 MiB: ${path}`);
    }
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function existingDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function discoverSkills(roots: string[]): Promise<ImportedSkill[]> {
  const skills: ImportedSkill[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (!(await existingDirectory(root))) continue;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const path = join(root, entry.name);
      try {
        if (!(await stat(join(path, "SKILL.md"))).isFile()) continue;
      } catch {
        continue;
      }
      const comparable =
        process.platform === "win32" ? path.toLowerCase() : path;
      if (!seen.has(comparable)) {
        seen.add(comparable);
        skills.push({ path, name: safeSkillName(entry.name) });
      }
    }
  }
  return skills;
}

function parseStdioMcp(
  source: ConfigurationImportSource,
  idInput: string,
  value: UnknownRecord,
  configPath: string,
  workspaceRoot: string,
  warnings: string[],
  commandInput: unknown,
  argsInput: unknown,
): McpServerConfig | undefined {
  const command = text(commandInput);
  if (!command) return undefined;
  const id = safeId(idInput);
  if (record(value.env) || record(value.environment)) {
    warnings.push(
      `${source} MCP "${idInput}" environment values were not copied; configure secrets in Artemis.`,
    );
  }
  return {
    id,
    name: (text(value.name) ?? idInput).slice(0, 100),
    transport: "stdio",
    enabled: enabled(value.enabled),
    command,
    args: stringArray(argsInput),
    env: {},
    envVars: stringArray(value.env_vars ?? value.envVars),
    workspacePath: resolveCwd(value.cwd, configPath, join(workspaceRoot, id)),
    allowNetwork: true,
  };
}

function parseHttpMcp(
  source: ConfigurationImportSource,
  idInput: string,
  value: UnknownRecord,
  warnings: string[],
): McpServerConfig | undefined {
  const url = text(value.url);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(
      parsed.hostname,
    );
    if (
      parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && loopback)
    ) {
      warnings.push(
        `${source} MCP "${idInput}" was skipped because Artemis requires HTTPS or loopback HTTP.`,
      );
      return undefined;
    }
  } catch {
    warnings.push(
      `${source} MCP "${idInput}" was skipped because its URL is invalid.`,
    );
    return undefined;
  }
  if (
    record(value.headers) ||
    text(value.bearer_token_env_var) ||
    record(value.oauth)
  ) {
    warnings.push(
      `${source} MCP "${idInput}" authentication values were not copied; configure authentication in Artemis.`,
    );
  }
  return {
    id: safeId(idInput),
    name: (text(value.name) ?? idInput).slice(0, 100),
    transport: "streamable-http",
    enabled: enabled(value.enabled),
    url,
    auth: "none",
  };
}

async function validateSkillTree(root: string): Promise<void> {
  let files = 0;
  let bytes = 0;
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        throw new Error(`Skill contains a symbolic link: ${path}`);
      }
      if (info.isDirectory()) {
        await visit(path);
      } else if (info.isFile()) {
        files += 1;
        bytes += info.size;
        if (files > MAX_SKILL_FILES || bytes > MAX_SKILL_BYTES) {
          throw new Error("Skill exceeds the import size limit.");
        }
      }
    }
  }
  await visit(root);
}

export class ConfigurationImportService {
  constructor(private readonly options: ConfigurationImportServiceOptions) {}

  async scan(): Promise<ConfigurationImportPreview> {
    const sources = [];
    for (const source of IMPORT_SOURCES) {
      const loaded = await this.loadSource(source);
      sources.push({
        source,
        detected: loaded.detectedPaths.length > 0,
        paths: loaded.detectedPaths,
        counts: {
          instructions: loaded.instructions.length,
          skills: loaded.skills.length,
          mcp: loaded.mcpServers.length,
        },
        warnings: loaded.warnings,
      });
    }
    return { sources };
  }

  async import(
    request: ConfigurationImportRequest,
  ): Promise<ConfigurationImportPayload> {
    const requestedSources = new Set(request.sources);
    const categories = new Set<ConfigurationImportCategory>(request.categories);
    const summary: ConfigurationImportSummary = {
      imported: emptyCounts(),
      skipped: [],
      warnings: [],
    };
    const payload: ConfigurationImportPayload = {
      mcpServers: [],
      summary,
    };
    const loadedSources = [];
    for (const source of IMPORT_SOURCES) {
      if (requestedSources.has(source)) {
        loadedSources.push(await this.loadSource(source));
      }
    }

    if (categories.has("instructions")) {
      let global = await this.options.globalInstructions.snapshot();
      for (const loaded of loadedSources) {
        for (const instruction of loaded.instructions) {
          const marker = `<!-- artemis-import:${loaded.source}:${instruction.path} -->`;
          if (global.content.includes(marker)) {
            summary.skipped.push(
              `${loaded.source} global instructions were already imported.`,
            );
            continue;
          }
          const endMarker = "<!-- /artemis-import -->";
          const heading =
            loaded.source === "claude"
              ? "Claude Code"
              : loaded.source === "opencode"
                ? "OpenCode"
                : "Codex";
          const separator =
            global.content.length && !global.content.endsWith("\n") ? "\n" : "";
          global = {
            ...global,
            content: `${global.content}${separator}\n${marker}\n## Imported from ${heading}\n\n${instruction.content.trim()}\n${endMarker}\n`,
          };
          summary.imported.instructions += 1;
        }
      }
      if (summary.imported.instructions) {
        await this.options.globalInstructions.save(global.content);
      }
    }

    if (categories.has("skills")) {
      await mkdir(this.options.skillsPath, { recursive: true });
      for (const loaded of loadedSources) {
        for (const skill of loaded.skills) {
          const destination = join(this.options.skillsPath, skill.name);
          if (await existingDirectory(destination)) {
            summary.skipped.push(
              `${loaded.source} Skill "${skill.name}" already exists.`,
            );
            continue;
          }
          try {
            await validateSkillTree(skill.path);
            await cp(skill.path, destination, {
              recursive: true,
              errorOnExist: true,
              force: false,
            });
            await writeFile(
              join(destination, ".artemis-skill.json"),
              `${JSON.stringify(
                {
                  version: 1,
                  id: `imported/${loaded.source}/${skill.name}`,
                  source: loaded.source,
                  installedAt: new Date().toISOString(),
                },
                undefined,
                2,
              )}\n`,
              { encoding: "utf8", mode: 0o600 },
            );
            summary.imported.skills += 1;
          } catch (error) {
            summary.warnings.push(
              `${loaded.source} Skill "${skill.name}" was skipped: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
      }
    }

    for (const loaded of loadedSources) {
      summary.warnings.push(...loaded.warnings);
      if (categories.has("mcp")) {
        payload.mcpServers.push(...loaded.mcpServers);
        summary.imported.mcp += loaded.mcpServers.length;
        for (const server of loaded.mcpServers) {
          if (server.transport === "stdio") {
            await mkdir(server.workspacePath, { recursive: true });
          }
        }
      }
    }
    return payload;
  }

  private async loadSource(
    source: ConfigurationImportSource,
  ): Promise<LoadedSource> {
    if (source === "codex") return this.loadCodex();
    if (source === "opencode") return this.loadOpenCode();
    return this.loadClaude();
  }

  private async loadCodex(): Promise<LoadedSource> {
    const root = join(this.options.homePath, ".codex");
    const configPath = join(root, "config.toml");
    const instructionsPath = join(root, "AGENTS.md");
    const loaded = await this.baseSource("codex", instructionsPath, [
      join(this.options.homePath, ".agents", "skills"),
      join(root, "skills"),
    ]);
    const configText = await readOptional(configPath);
    if (!configText) return loaded;
    loaded.detectedPaths.push(configPath);
    try {
      const config = record(parseToml(configText)) ?? {};
      const servers = record(config.mcp_servers) ?? {};
      for (const [id, rawValue] of Object.entries(servers)) {
        const value = record(rawValue);
        if (!value) continue;
        const server = text(value.command)
          ? parseStdioMcp(
              "codex",
              id,
              value,
              configPath,
              this.options.mcpWorkspaceRoot,
              loaded.warnings,
              value.command,
              value.args,
            )
          : parseHttpMcp("codex", id, value, loaded.warnings);
        if (server) loaded.mcpServers.push(server);
      }
    } catch (error) {
      loaded.warnings.push(
        `Codex config could not be parsed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return loaded;
  }

  private async loadOpenCode(): Promise<LoadedSource> {
    const root = join(this.options.homePath, ".config", "opencode");
    const configPath = join(root, "opencode.json");
    const instructionsPath = join(root, "AGENTS.md");
    const loaded = await this.baseSource("opencode", instructionsPath, [
      join(root, "skills"),
    ]);
    const configText = await readOptional(configPath);
    if (!configText) return loaded;
    loaded.detectedPaths.push(configPath);
    try {
      const config = record(JSON5.parse(configText)) ?? {};
      const servers = record(config.mcp) ?? {};
      for (const [id, rawValue] of Object.entries(servers)) {
        const value = record(rawValue);
        if (!value) continue;
        const command = stringArray(value.command);
        const server =
          value.type === "local" || command.length
            ? parseStdioMcp(
                "opencode",
                id,
                value,
                configPath,
                this.options.mcpWorkspaceRoot,
                loaded.warnings,
                command[0],
                command.slice(1),
              )
            : parseHttpMcp("opencode", id, value, loaded.warnings);
        if (server) loaded.mcpServers.push(server);
      }
      if (
        JSON.stringify(config).match(
          /"apiKey"|"token"|"headers"|"environment"/u,
        )
      ) {
        loaded.warnings.push(
          "OpenCode secrets and environment values were not imported.",
        );
      }
    } catch (error) {
      loaded.warnings.push(
        `OpenCode config could not be parsed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return loaded;
  }

  private async loadClaude(): Promise<LoadedSource> {
    const root = join(this.options.homePath, ".claude");
    const settingsPath = join(root, "settings.json");
    const mcpPath = join(this.options.homePath, ".claude.json");
    const instructionsPath = join(root, "CLAUDE.md");
    const loaded = await this.baseSource("claude", instructionsPath, [
      join(root, "skills"),
    ]);
    const settingsText = await readOptional(settingsPath);
    if (settingsText) {
      loaded.detectedPaths.push(settingsPath);
      try {
        const settings = record(JSON.parse(settingsText)) ?? {};
        if (text(settings.apiKey)) {
          loaded.warnings.push("Claude Code API keys were not imported.");
        }
      } catch (error) {
        loaded.warnings.push(
          `Claude settings could not be parsed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const mcpText = await readOptional(mcpPath);
    if (mcpText) {
      loaded.detectedPaths.push(mcpPath);
      try {
        const config = record(JSON.parse(mcpText)) ?? {};
        const servers = record(config.mcpServers) ?? {};
        for (const [id, rawValue] of Object.entries(servers)) {
          const value = record(rawValue);
          if (!value) continue;
          const server =
            value.type === "http" || text(value.url)
              ? parseHttpMcp("claude", id, value, loaded.warnings)
              : parseStdioMcp(
                  "claude",
                  id,
                  value,
                  mcpPath,
                  this.options.mcpWorkspaceRoot,
                  loaded.warnings,
                  value.command,
                  value.args,
                );
          if (server) loaded.mcpServers.push(server);
        }
        if (record(config.projects)) {
          loaded.warnings.push(
            "Claude project-scoped MCP servers were not imported as global servers.",
          );
        }
      } catch (error) {
        loaded.warnings.push(
          `Claude MCP config could not be parsed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return loaded;
  }

  private async baseSource(
    source: ConfigurationImportSource,
    instructionsPath: string,
    skillRoots: string[],
  ): Promise<LoadedSource> {
    const instructions = [];
    const content = await readOptional(instructionsPath);
    if (content !== undefined) {
      instructions.push({ path: instructionsPath, content });
    }
    const skills = await discoverSkills(skillRoots);
    const detectedPaths = [
      ...(content === undefined ? [] : [instructionsPath]),
      ...(
        await Promise.all(
          skillRoots.map(async (path) =>
            (await existingDirectory(path)) ? path : undefined,
          ),
        )
      ).filter((path): path is string => Boolean(path)),
    ];
    return {
      source,
      detectedPaths,
      instructions,
      skills,
      mcpServers: [],
      warnings: [],
    };
  }
}
