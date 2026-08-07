import { createHash, randomUUID } from "node:crypto";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";

import type {
  InstalledSkill,
  McpCatalogItem,
  McpServerConfig,
  SkillCatalogItem,
} from "../shared/api.js";

const MCP_REGISTRY = "https://registry.modelcontextprotocol.io";
const SKILL_REGISTRY = "https://skills.sh";
const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";
const MAX_SKILL_FILES = 200;
const MAX_SKILL_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SKILL_BYTES = 20 * 1024 * 1024;

type Fetcher = typeof fetch;
type ProgressReporter = (percent: number) => void;

interface SkillMetadata {
  version: 1;
  id: string;
  source: string;
  hash?: string;
  installedAt: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function fixedRemote(value: unknown): string | undefined {
  const remote = record(value);
  if (
    remote?.type !== "streamable-http" ||
    (Array.isArray(remote.headers) && remote.headers.length > 0) ||
    (record(remote.variables) &&
      Object.keys(record(remote.variables) ?? {}).length > 0)
  ) {
    return undefined;
  }
  const urlText = text(remote.url);
  if (!urlText || urlText.includes("{")) return undefined;
  try {
    const url = new URL(urlText);
    const loopback =
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "::1";
    return url.protocol === "https:" || (url.protocol === "http:" && loopback)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function mcpConfigId(registryName: string): string {
  const slug =
    registryName
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/gu, "-")
      .replace(/^[^a-z0-9]+/u, "")
      .slice(0, 48) || "registry";
  const hash = createHash("sha256")
    .update(registryName)
    .digest("hex")
    .slice(0, 8);
  return `${slug}-${hash}`.slice(0, 64);
}

export function parseMcpCatalogResponse(value: unknown): McpCatalogItem[] {
  const servers = record(value)?.servers;
  if (!Array.isArray(servers)) {
    throw new Error("Official MCP Registry returned an invalid response.");
  }
  return servers.flatMap((entry) => {
    const server = record(record(entry)?.server);
    const registryName = text(server?.name);
    const description = text(server?.description);
    const version = text(server?.version);
    if (!registryName || !description || !version) return [];
    const remotes = Array.isArray(server?.remotes) ? server.remotes : [];
    const remoteUrl = remotes.map(fixedRemote).find(Boolean);
    const repository = record(server?.repository);
    const repositoryUrl = text(repository?.url);
    return [
      {
        configId: mcpConfigId(registryName),
        registryName,
        title: text(server?.title) ?? registryName,
        description,
        version,
        installable: Boolean(remoteUrl),
        installed: false,
        ...(remoteUrl ? { remoteUrl } : {}),
        ...(repositoryUrl ? { repositoryUrl } : {}),
        ...(!remoteUrl
          ? {
              reason:
                "This server needs package, header, variable, or SSE setup.",
            }
          : {}),
      },
    ];
  });
}

export function parseSkillCatalogResponse(value: unknown): SkillCatalogItem[] {
  const skills = record(value)?.skills;
  if (!Array.isArray(skills)) {
    throw new Error("Skill catalog returned an invalid response.");
  }
  return skills.flatMap((entry) => {
    const item = record(entry);
    const id = text(item?.id);
    const slug = text(item?.skillId);
    const name = text(item?.name);
    const source = text(item?.source);
    if (
      !id ||
      !slug ||
      !name ||
      !source ||
      id !== `${source}/${slug}` ||
      !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/u.test(source) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)
    ) {
      return [];
    }
    return [
      {
        id,
        slug,
        name,
        source,
        installs:
          typeof item?.installs === "number" && Number.isFinite(item.installs)
            ? Math.max(0, Math.floor(item.installs))
            : 0,
        installed: false,
        sourceUrl: `https://github.com/${source}`,
        catalogUrl: `${SKILL_REGISTRY}/${id}`,
      },
    ];
  });
}

interface GithubTreeEntry {
  path: string;
  type: "blob";
  size?: number;
  sha: string;
}

function githubTreeEntries(value: unknown): GithubTreeEntry[] {
  const payload = record(value);
  if (payload?.truncated === true || !Array.isArray(payload?.tree)) {
    throw new Error("GitHub returned an incomplete Skill file tree.");
  }
  return payload.tree.flatMap((value) => {
    const entry = record(value);
    const path = text(entry?.path);
    const sha = text(entry?.sha);
    const size =
      typeof entry?.size === "number" &&
      Number.isFinite(entry.size) &&
      entry.size >= 0
        ? Math.floor(entry.size)
        : undefined;
    if (entry?.type !== "blob" || !path || !sha) return [];
    return [{ path, type: "blob" as const, sha, ...(size ? { size } : {}) }];
  });
}

function encodedPath(segments: string[]): string {
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

function skillMarkerRank(path: string, slug: string): number {
  const preferred = [
    `skills/${slug}/SKILL.md`,
    `skills/.curated/${slug}/SKILL.md`,
    `skills/.experimental/${slug}/SKILL.md`,
    `.agents/skills/${slug}/SKILL.md`,
    `.pi/skills/${slug}/SKILL.md`,
  ];
  const preferredIndex = preferred.indexOf(path);
  if (preferredIndex >= 0) return preferredIndex;
  return 100 + path.split("/").length;
}

export function parseSkillFrontmatter(contents: string): {
  name: string;
  description: string;
} {
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---/u.exec(contents)?.[1];
  const name = /^name:\s*["']?([^"' \r\n][^"'\r\n]*)["']?\s*$/imu.exec(
    frontmatter ?? "",
  )?.[1];
  const description = /^description:\s*["']?(.+?)["']?\s*$/imu.exec(
    frontmatter ?? "",
  )?.[1];
  if (
    !name ||
    !description ||
    !/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/u.test(name.trim()) ||
    name.trim().length > 64 ||
    description.trim().length > 1_024
  ) {
    throw new Error("Skill has invalid SKILL.md frontmatter.");
  }
  return { name: name.trim(), description: description.trim() };
}

function safeSkillPath(root: string, inputPath: string): string {
  const normalized = inputPath.replaceAll("\\", "/");
  if (
    !normalized ||
    posix.isAbsolute(normalized) ||
    normalized.split("/").some((segment) => segment === ".." || !segment)
  ) {
    throw new Error(`Skill contains an unsafe path: ${inputPath}`);
  }
  const target = resolve(root, ...normalized.split("/"));
  const fromRoot = relative(resolve(root), target);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error(`Skill contains an unsafe path: ${inputPath}`);
  }
  return target;
}

async function responseJson(
  response: Response,
  source: string,
): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${source} request failed (${response.status}).`);
  }
  return response.json() as Promise<unknown>;
}

export class ResourceCatalogService {
  constructor(
    private readonly skillsRoot: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async searchMcp(
    query: string,
    installedIds: ReadonlySet<string> = new Set(),
  ): Promise<McpCatalogItem[]> {
    const url = new URL("/v0.1/servers", MCP_REGISTRY);
    url.searchParams.set("version", "latest");
    url.searchParams.set("limit", "40");
    if (query.trim()) url.searchParams.set("search", query.trim());
    const response = await this.fetcher(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    return parseMcpCatalogResponse(
      await responseJson(response, "Official MCP Registry"),
    ).map((item) => ({
      ...item,
      installed: installedIds.has(item.configId),
    }));
  }

  async resolveMcpConfig(
    registryName: string,
    version: string,
  ): Promise<McpServerConfig> {
    const path = `/v0.1/servers/${encodeURIComponent(registryName)}/versions/${encodeURIComponent(version)}`;
    const response = await this.fetcher(new URL(path, MCP_REGISTRY), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    const item = parseMcpCatalogResponse({
      servers: [await responseJson(response, "Official MCP Registry")],
    }).find(
      (candidate) =>
        candidate.registryName === registryName &&
        candidate.version === version &&
        candidate.remoteUrl,
    );
    if (!item?.remoteUrl) {
      throw new Error(
        "This MCP server needs manual package, authentication, or transport setup.",
      );
    }
    return {
      id: item.configId,
      name: item.title.slice(0, 100),
      transport: "streamable-http",
      enabled: true,
      url: item.remoteUrl,
      auth: "none",
    };
  }

  async searchSkills(query: string): Promise<SkillCatalogItem[]> {
    const normalized = query.trim();
    if (normalized.length < 2) {
      throw new Error("Enter at least two characters to search Skills.");
    }
    const url = new URL("/api/search", SKILL_REGISTRY);
    url.searchParams.set("q", normalized);
    url.searchParams.set("limit", "40");
    const response = await this.fetcher(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    const installed = new Set(
      (await this.listInstalledSkills()).map((skill) => skill.id),
    );
    return parseSkillCatalogResponse(
      await responseJson(response, "Skill catalog"),
    ).map((item) => ({ ...item, installed: installed.has(item.id) }));
  }

  async listInstalledSkills(): Promise<InstalledSkill[]> {
    await mkdir(this.skillsRoot, { recursive: true });
    const entries = await readdir(this.skillsRoot, { withFileTypes: true });
    const skills = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map(async (entry): Promise<InstalledSkill | undefined> => {
          const skillPath = join(this.skillsRoot, entry.name);
          try {
            const frontmatter = parseSkillFrontmatter(
              await readFile(join(skillPath, "SKILL.md"), "utf8"),
            );
            let metadata: SkillMetadata | undefined;
            try {
              metadata = JSON.parse(
                await readFile(join(skillPath, ".artemis-skill.json"), "utf8"),
              ) as SkillMetadata;
            } catch {
              metadata = undefined;
            }
            return {
              id: metadata?.id ?? `local/${entry.name}`,
              name: frontmatter.name,
              description: frontmatter.description,
              path: skillPath,
              enabled: true,
              ...(metadata?.source ? { source: metadata.source } : {}),
              ...(metadata?.installedAt
                ? { installedAt: metadata.installedAt }
                : {}),
            };
          } catch {
            return undefined;
          }
        }),
    );
    return skills
      .filter((skill): skill is InstalledSkill => Boolean(skill))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async installSkill(
    id: string,
    onProgress?: ProgressReporter,
  ): Promise<InstalledSkill> {
    const segments = id.split("/");
    if (
      segments.length !== 3 ||
      segments.some((segment) => !/^[a-zA-Z0-9._-]+$/u.test(segment))
    ) {
      throw new Error("Skill catalog ID is invalid.");
    }
    onProgress?.(5);
    const [owner, repository, slug] = segments as [string, string, string];
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
      throw new Error("Skill catalog ID is invalid.");
    }
    const source = `${owner}/${repository}`;
    const githubHeaders = {
      Accept: "application/vnd.github+json",
      "User-Agent": "Artemis/0.1",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const repositoryResponse = await this.fetcher(
      new URL(`/repos/${encodedPath([owner, repository])}`, GITHUB_API),
      {
        headers: githubHeaders,
        signal: AbortSignal.timeout(12_000),
      },
    );
    const repositoryInfo = record(
      await responseJson(repositoryResponse, "GitHub"),
    );
    const defaultBranch = text(repositoryInfo?.default_branch);
    if (!defaultBranch) {
      throw new Error("GitHub repository has no default branch.");
    }
    onProgress?.(15);
    const treeResponse = await this.fetcher(
      new URL(
        `/repos/${encodedPath([
          owner,
          repository,
        ])}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`,
        GITHUB_API,
      ),
      {
        headers: githubHeaders,
        signal: AbortSignal.timeout(15_000),
      },
    );
    const tree = githubTreeEntries(await responseJson(treeResponse, "GitHub"));
    onProgress?.(30);
    const namedMarkers = tree
      .filter(
        (entry) =>
          posix.basename(entry.path) === "SKILL.md" &&
          posix.basename(posix.dirname(entry.path)) === slug,
      )
      .sort(
        (left, right) =>
          skillMarkerRank(left.path, slug) - skillMarkerRank(right.path, slug),
      );
    const rootMarker = tree.find((entry) => entry.path === "SKILL.md");
    const markers =
      namedMarkers.length > 0 ? namedMarkers : rootMarker ? [rootMarker] : [];
    const marker = markers[0];
    if (!marker) {
      throw new Error("The selected Skill was not found in its repository.");
    }
    const skillDirectory = posix.dirname(marker.path);
    const rootDirectories = new Set([
      "assets",
      "examples",
      "references",
      "scripts",
      "templates",
    ]);
    const files = tree.filter((entry) => {
      if (skillDirectory !== ".") {
        return entry.path.startsWith(`${skillDirectory}/`);
      }
      const [firstSegment] = entry.path.split("/");
      return (
        entry.path === "SKILL.md" ||
        (firstSegment !== undefined && rootDirectories.has(firstSegment))
      );
    });
    if (files.length < 1 || files.length > MAX_SKILL_FILES) {
      throw new Error("Skill package contains too many files.");
    }
    const declaredBytes = files.reduce(
      (total, file) => total + (file.size ?? 0),
      0,
    );
    if (
      files.some((file) => (file.size ?? 0) > MAX_SKILL_FILE_BYTES) ||
      declaredBytes > MAX_SKILL_BYTES
    ) {
      throw new Error("Skill package exceeds the installation size limit.");
    }

    await mkdir(this.skillsRoot, { recursive: true });
    const destination = join(this.skillsRoot, slug);
    try {
      await access(destination);
      throw new Error(`Skill is already installed: ${slug}`);
    } catch (error) {
      if (
        error instanceof Error &&
        !("code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")
      ) {
        throw error;
      }
    }

    const temporaryPath = join(
      this.skillsRoot,
      `.install-${slug}-${randomUUID()}`,
    );
    let totalBytes = 0;
    try {
      await mkdir(temporaryPath);
      for (const [index, file] of files.entries()) {
        const filePath =
          skillDirectory === "."
            ? file.path
            : file.path.slice(skillDirectory.length + 1);
        const target = safeSkillPath(temporaryPath, filePath);
        const rawUrl = new URL(
          `/${encodedPath([
            owner,
            repository,
            defaultBranch,
            ...file.path.split("/"),
          ])}`,
          GITHUB_RAW,
        );
        const response = await this.fetcher(rawUrl, {
          headers: { Accept: "text/plain" },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          throw new Error(
            `GitHub Skill file request failed (${response.status}).`,
          );
        }
        const contents = await response.text();
        const bytes = Buffer.byteLength(contents, "utf8");
        totalBytes += bytes;
        if (bytes > MAX_SKILL_FILE_BYTES || totalBytes > MAX_SKILL_BYTES) {
          throw new Error("Skill package exceeds the installation size limit.");
        }
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, contents, { encoding: "utf8", mode: 0o600 });
        onProgress?.(30 + Math.round(((index + 1) / files.length) * 60));
      }
      const frontmatter = parseSkillFrontmatter(
        await readFile(join(temporaryPath, "SKILL.md"), "utf8"),
      );
      const metadata: SkillMetadata = {
        version: 1,
        id,
        source,
        hash: marker.sha,
        installedAt: new Date().toISOString(),
      };
      await writeFile(
        join(temporaryPath, ".artemis-skill.json"),
        `${JSON.stringify(metadata, undefined, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      onProgress?.(95);
      await rename(temporaryPath, destination);
      onProgress?.(100);
      return {
        id,
        name: frontmatter.name,
        description: frontmatter.description,
        path: destination,
        enabled: true,
        source,
        installedAt: metadata.installedAt,
      };
    } catch (error) {
      await rm(temporaryPath, { recursive: true, force: true });
      throw error;
    }
  }

  async installLocalSkill(
    sourcePath: string,
    onProgress?: ProgressReporter,
  ): Promise<InstalledSkill> {
    const source = resolve(sourcePath);
    const sourceInfo = await lstat(source);
    if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
      throw new Error("The selected Skill must be a local directory.");
    }
    onProgress?.(5);

    const frontmatter = parseSkillFrontmatter(
      await readFile(join(source, "SKILL.md"), "utf8"),
    );
    const files: Array<{ source: string; relativePath: string; size: number }> =
      [];
    let totalBytes = 0;

    const collect = async (directory: string, prefix = ""): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const relativePath = prefix ? join(prefix, entry.name) : entry.name;
        const path = join(directory, entry.name);
        const info = await lstat(path);
        if (info.isSymbolicLink()) {
          throw new Error("Local Skill packages cannot contain links.");
        }
        if (info.isDirectory()) {
          await collect(path, relativePath);
          continue;
        }
        if (!info.isFile()) {
          throw new Error("Local Skill packages can contain only files.");
        }
        if (relativePath === ".artemis-skill.json") {
          throw new Error(
            "Local Skill packages cannot provide installer metadata.",
          );
        }
        totalBytes += info.size;
        files.push({ source: path, relativePath, size: info.size });
        if (
          files.length > MAX_SKILL_FILES ||
          info.size > MAX_SKILL_FILE_BYTES ||
          totalBytes > MAX_SKILL_BYTES
        ) {
          throw new Error("Skill package exceeds the installation limits.");
        }
      }
    };
    await collect(source);
    onProgress?.(25);

    await mkdir(this.skillsRoot, { recursive: true });
    const destination = join(this.skillsRoot, frontmatter.name);
    try {
      await access(destination);
      throw new Error(`Skill is already installed: ${frontmatter.name}`);
    } catch (error) {
      if (
        error instanceof Error &&
        !("code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")
      ) {
        throw error;
      }
    }

    const temporaryPath = join(
      this.skillsRoot,
      `.install-${frontmatter.name}-${randomUUID()}`,
    );
    const installedAt = new Date().toISOString();
    try {
      await mkdir(temporaryPath);
      for (const [index, file] of files.entries()) {
        const target = safeSkillPath(temporaryPath, file.relativePath);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(file.source, target);
        onProgress?.(25 + Math.round(((index + 1) / files.length) * 65));
      }
      const metadata: SkillMetadata = {
        version: 1,
        id: `local/${frontmatter.name}`,
        source: "local",
        installedAt,
      };
      await writeFile(
        join(temporaryPath, ".artemis-skill.json"),
        `${JSON.stringify(metadata, undefined, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      onProgress?.(95);
      await rename(temporaryPath, destination);
      onProgress?.(100);
      return {
        id: metadata.id,
        name: frontmatter.name,
        description: frontmatter.description,
        path: destination,
        enabled: true,
        source: metadata.source,
        installedAt,
      };
    } catch (error) {
      await rm(temporaryPath, { recursive: true, force: true });
      throw error;
    }
  }

  async removeSkill(id: string): Promise<void> {
    const skill = (await this.listInstalledSkills()).find(
      (candidate) => candidate.id === id,
    );
    if (!skill) {
      throw new Error("Installed Skill was not found.");
    }
    const relation = relative(resolve(this.skillsRoot), resolve(skill.path));
    if (!relation || relation.startsWith("..") || isAbsolute(relation)) {
      throw new Error("Installed Skill path is unsafe.");
    }
    const info = await lstat(skill.path);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("Installed Skill path is unsafe.");
    }
    await rm(skill.path, { recursive: true });
  }
}
