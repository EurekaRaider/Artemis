import {
  createHash,
  createPublicKey,
  randomUUID,
  verify as verifySignature,
} from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { x as extractTar } from "tar";

import type {
  CodexPluginMarketplace,
  CodexPluginMarketplaceSource,
  CodexPluginMarketplaceState,
  CodexPluginMarketplaceTrustPreview,
  CodexPluginMcpPreview,
  CodexPluginPreview,
  CodexPluginSource,
  InstalledCodexPlugin,
  McpServerConfig,
  GoogleMcpHostAuth,
} from "../shared/api.js";
import { McpConfigStore, validateMcpServerConfig } from "./mcp-config-store.js";
import { parseSkillFrontmatter } from "./resource-catalog.js";
import {
  SKILL_METADATA_FILE,
  isSkillInstallerMetadata,
} from "./skill-metadata.js";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_MARKETPLACE_BYTES = 5 * 1024 * 1024;
const MAX_MARKETPLACE_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_MARKETPLACE_ARCHIVE_ENTRIES = 20_000;
const MAX_MARKETPLACE_ARCHIVE_UNPACKED_BYTES = 500 * 1024 * 1024;
const MAX_ICON_BYTES = 128 * 1024;
const MAX_ICON_DIMENSION = 2_048;
const MAX_ICON_PIXELS = 4_194_304;
const MAX_MARKETPLACE_PLUGINS = 1_000;
const MAX_USER_MARKETPLACES = 20;
const MAX_PLUGIN_FILES = 2_500;
const MAX_PLUGIN_FILE_BYTES = 50 * 1024 * 1024;
const MAX_PLUGIN_BYTES = 200 * 1024 * 1024;
const MAX_SKILL_FILES = 200;
const MAX_SKILL_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SKILL_BYTES = 20 * 1024 * 1024;
const BUNDLED_ARTIFACT_PLUGIN_NAMES = new Set([
  "documents",
  "pdf",
  "spreadsheets",
  "presentations",
]);
const BUNDLED_ARTIFACT_MARKETPLACE_NAME = "artemis-bundled-artifacts";
const BUNDLED_MARKETPLACE_ID = "bundled";
const BUNDLED_MARKETPLACE_URL = "artemis-bundled://lite-v1";
const LOCAL_MARKETPLACE_ID = "local";
const OPENAI_MARKETPLACE_URL = "https://github.com/openai/plugins.git";
const GITHUB_API = "https://api.github.com";

type ProgressReporter = (percent: number) => void;
type CloneRepository = (url: string, destination: string) => Promise<void>;
type MarketplaceFetcher = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

interface CollectedFile {
  absolutePath: string;
  relativePath: string;
  size: number;
  mode: number;
  hash: string;
}

interface ParsedSkill {
  name: string;
  description: string;
  root: string;
  hash?: string;
  files?: CollectedFile[];
}

interface ParsedMcpServer {
  name: string;
  transport: "stdio" | "streamable-http" | "unsupported";
  endpoint: string;
  importable: boolean;
  requiresSetup: boolean;
  command?: string;
  args?: string[];
  envVars?: string[];
  url?: string;
  auth?: "none" | "bearer" | "oauth";
  hostAuth?: GoogleMcpHostAuth;
}

interface ParsedPlugin {
  root: string;
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  shortDescription?: string;
  category?: string;
  brandColor?: string;
  iconDataUrl?: string;
  source: CodexPluginSource;
  skills: ParsedSkill[];
  mcpServers: ParsedMcpServer[];
  apps: CodexPluginPreview["apps"];
  unsupported: string[];
  warnings: string[];
  contentHash?: string;
  files?: CollectedFile[];
}

interface StoredSkill {
  name: string;
  hash: string;
}

interface StoredMcpServer {
  id: string;
  structuralHash: string;
}

interface StoredPlugin {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  shortDescription?: string;
  category?: string;
  brandColor?: string;
  iconDataUrl?: string;
  source: CodexPluginSource;
  contentHash: string;
  installedAt: string;
  updatedAt: string;
  skills: StoredSkill[];
  mcpServers: StoredMcpServer[];
  skillPreviews: CodexPluginPreview["skills"];
  mcpPreviews: CodexPluginPreview["mcpServers"];
  appPreviews: CodexPluginPreview["apps"];
  unsupported: string[];
  warnings: string[];
}

interface PluginStore {
  version: 1;
  plugins: StoredPlugin[];
}

interface StoredMarketplaceSource {
  id: string;
  url: string;
  marketplaceName: string;
  displayName: string;
  addedAt: string;
  mode?: "git" | "offline";
  cachePath?: string;
  signingKeyFingerprint?: string;
}

interface VerifiedMarketplaceIntegrity {
  signingKeyFingerprint: string;
  pluginHashes: Map<string, string>;
  packageFiles: Set<string>;
  sourceUrl?: string;
}

interface OfflineMarketplaceCandidate {
  marketplace: CodexPluginMarketplace;
  integrity: VerifiedMarketplaceIntegrity & { sourceUrl: string };
}

interface MarketplaceStore {
  version: 1;
  selectedView: string;
  sources: StoredMarketplaceSource[];
}

interface PreparedPlugin {
  parsed: ParsedPlugin;
  pluginDirectory: string;
  skills: Array<ParsedSkill & { hash: string; files: CollectedFile[] }>;
  mcpConfigs: McpServerConfig[];
}

interface DirectoryMove {
  destination: string;
  backup: string;
  stage?: string;
}

export interface CodexPluginServiceOptions {
  skillsRoot: string;
  pluginsRoot: string;
  marketplacesRoot: string;
  marketplaceStatePath: string;
  statePath: string;
  mcpWorkspaceRoot: string;
  mcpStore: McpConfigStore;
  bundledArtifactRoot?: string;
  cloneRepository?: CloneRepository;
  fetcher?: MarketplaceFetcher;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => (typeof entry === "string" ? [entry] : []));
}

function pathIsInside(root: string, candidate: string): boolean {
  const relation = relative(resolve(root), resolve(candidate));
  return (
    relation === "" || (!relation.startsWith("..") && !isAbsolute(relation))
  );
}

function portableRelative(path: string): string {
  return path.split(sep).join("/");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  const object = record(value);
  if (!object) return value;
  return Object.fromEntries(
    Object.entries(object)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function safeSlug(value: string, fallback = "plugin"): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/gu, "-")
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, "") || fallback
  );
}

function pluginSourceIdentity(source: CodexPluginSource): string {
  if (source.kind === "local") return `local\0${source.path}`;
  if (source.kind === "bundled" || source.kind === "runtime") {
    // Preserve the legacy runtime identity so Lite updates do not duplicate an
    // already installed artifact plugin.
    return `runtime\0${source.pluginName}`;
  }
  return `git\0${source.marketplaceUrl}\0${source.marketplaceName}\0${source.pluginName}`;
}

function pluginId(name: string, source: CodexPluginSource): string {
  const digest = createHash("sha256")
    .update(pluginSourceIdentity(source))
    .update("\0")
    .update(name)
    .digest("hex")
    .slice(0, 10);
  return `${safeSlug(name).slice(0, 50)}-${digest}`;
}

function mcpConfigId(pluginIdentifier: string, name: string): string {
  const digest = createHash("sha256")
    .update(pluginIdentifier)
    .update("\0")
    .update(name)
    .digest("hex")
    .slice(0, 8);
  const prefix = `plugin-${safeSlug(name, "mcp")}`.slice(0, 54);
  return `${prefix}-${digest}`;
}

function mcpStructuralHash(config: McpServerConfig): string {
  if (config.transport === "stdio") {
    return stableHash({
      id: config.id,
      name: config.name,
      transport: config.transport,
      command: config.command,
      args: config.args,
      workspacePath: config.workspacePath,
      hostAuth: config.hostAuth,
      ...(config.hostAuth ? { env: config.env, envVars: config.envVars } : {}),
      resourceKind: config.resourceKind,
      connectorId: config.connectorId,
    });
  }
  return stableHash({
    id: config.id,
    name: config.name,
    transport: config.transport,
    url: config.url,
    resourceKind: config.resourceKind,
    connectorId: config.connectorId,
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readJson(path: string, maximumBytes: number): Promise<unknown> {
  const information = await lstat(path);
  if (
    !information.isFile() ||
    information.isSymbolicLink() ||
    information.size > maximumBytes
  ) {
    throw new Error(`JSON file is invalid or too large: ${basename(path)}`);
  }
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    throw new Error(`JSON file could not be parsed: ${basename(path)}`);
  }
}

async function readPluginText(
  path: string,
  maximumBytes: number,
): Promise<string> {
  const information = await lstat(path);
  if (
    !information.isFile() ||
    information.isSymbolicLink() ||
    information.size > maximumBytes
  ) {
    throw new Error(`Plugin file is invalid or too large: ${basename(path)}`);
  }
  return readFile(path, "utf8");
}

async function readPluginIcon(
  root: string,
  input: unknown,
): Promise<string | undefined> {
  const declaration = text(input);
  if (!declaration) return undefined;
  try {
    const path = declaredPath(root, declaration, "Plugin icon");
    const information = await lstat(path);
    if (
      !information.isFile() ||
      information.isSymbolicLink() ||
      information.size > MAX_ICON_BYTES
    ) {
      return undefined;
    }
    const canonical = await realpath(path);
    if (!pathIsInside(await realpath(root), canonical)) return undefined;
    const contents = await readFile(canonical);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (
      contents.length < 24 ||
      !contents.subarray(0, pngSignature.length).equals(pngSignature)
    ) {
      return undefined;
    }
    const width = contents.readUInt32BE(16);
    const height = contents.readUInt32BE(20);
    if (
      width < 1 ||
      height < 1 ||
      width > MAX_ICON_DIMENSION ||
      height > MAX_ICON_DIMENSION ||
      width * height > MAX_ICON_PIXELS
    ) {
      return undefined;
    }
    return `data:image/png;base64,${contents.toString("base64")}`;
  } catch {
    return undefined;
  }
}

function connectorEndpoint(input: unknown): string | undefined {
  const value = text(input);
  if (!value) return undefined;
  if (value.length > 2_000) {
    throw new Error("Connector URL is too long.");
  }
  const url = new URL(value);
  const loopback =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Connector URL must use HTTPS or loopback HTTP.");
  }
  return url.href;
}

async function parsePluginConnectors(
  root: string,
  declaration: unknown,
): Promise<CodexPluginPreview["apps"]> {
  const inputs: unknown[] = [];
  const declarations = manifestPaths(declaration);
  if (declarations.length) {
    for (const pathInput of declarations) {
      inputs.push(
        await readJson(
          declaredPath(root, pathInput, "Connector"),
          MAX_MANIFEST_BYTES,
        ),
      );
    }
  } else if (record(declaration)) {
    inputs.push(declaration);
  } else if (await exists(join(root, ".connector.json"))) {
    inputs.push(
      await readJson(join(root, ".connector.json"), MAX_MANIFEST_BYTES),
    );
  } else if (await exists(join(root, ".app.json"))) {
    inputs.push(await readJson(join(root, ".app.json"), MAX_MANIFEST_BYTES));
  }
  const connectors = new Map<
    string,
    {
      name: string;
      connectorId?: string;
      required?: boolean;
      url?: string;
      auth?: "none" | "bearer" | "oauth";
    }
  >();
  for (const input of inputs) {
    const inputRecord = record(input);
    const definitions =
      record(inputRecord?.connectors) ??
      record(inputRecord?.apps) ??
      inputRecord;
    if (!definitions) continue;
    for (const [rawName, rawDefinition] of Object.entries(definitions)) {
      const name = rawName.trim();
      if (
        !name ||
        name.length > 120 ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(name)
      ) {
        continue;
      }
      const definition = record(rawDefinition);
      const connectorId = text(definition?.id);
      const required = definition?.required === true;
      const url = connectorEndpoint(definition?.url ?? definition?.endpoint);
      const authInput = text(definition?.auth);
      if (
        authInput !== undefined &&
        authInput !== "none" &&
        authInput !== "bearer" &&
        authInput !== "oauth"
      ) {
        throw new Error(`Connector authentication mode is invalid: ${name}.`);
      }
      const auth = url
        ? ((authInput ?? "oauth") as "none" | "bearer" | "oauth")
        : undefined;
      connectors.set(name, {
        name,
        ...(connectorId && connectorId.length <= 200 ? { connectorId } : {}),
        ...(required ? { required: true } : {}),
        ...(url ? { url } : {}),
        ...(auth ? { auth } : {}),
      });
      if (connectors.size > 100) {
        throw new Error("Plugin declares too many Connectors.");
      }
    }
  }
  return [...connectors.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function unavailableConnectorNames(
  apps: ReadonlyArray<{ name: string; required?: boolean; url?: string }>,
  mcpServers: ReadonlyArray<{ name: string; importable: boolean }>,
): string[] {
  const importableMcpNames = new Set(
    mcpServers
      .filter((server) => server.importable)
      .map((server) => server.name.toLowerCase()),
  );
  return apps
    .filter(
      (app) =>
        !app.url &&
        (app.required || !importableMcpNames.has(app.name.toLowerCase())),
    )
    .map((app) => app.name);
}

function blockingUnavailableConnectorNames(
  source: CodexPluginSource,
  apps: ReadonlyArray<{ name: string; required?: boolean; url?: string }>,
  mcpServers: ReadonlyArray<{ name: string; importable: boolean }>,
): string[] {
  const unavailable = unavailableConnectorNames(apps, mcpServers);
  if (source.kind !== "bundled" && source.kind !== "runtime") {
    return unavailable;
  }
  const requiredNames = new Set(
    apps.filter((app) => app.required).map((app) => app.name),
  );
  return unavailable.filter((name) => requiredNames.has(name));
}

async function canonicalDirectory(
  inputPath: string,
  allowedRoot?: string,
): Promise<string> {
  const information = await lstat(inputPath);
  if (!information.isDirectory() || information.isSymbolicLink()) {
    throw new Error("Plugin source must be a real directory.");
  }
  const canonical = await realpath(inputPath);
  if (allowedRoot && !pathIsInside(await realpath(allowedRoot), canonical)) {
    throw new Error("Marketplace plugin path escapes its repository.");
  }
  return canonical;
}

function declaredPath(root: string, input: string, label: string): string {
  const normalized = input.replaceAll("\\", "/");
  if (!normalized || normalized.includes("\0") || isAbsolute(normalized)) {
    throw new Error(`${label} path must be relative to the plugin root.`);
  }
  const destination = resolve(root, ...normalized.split("/"));
  if (!pathIsInside(root, destination)) {
    throw new Error(`${label} path escapes the plugin root.`);
  }
  return destination;
}

async function collectFiles(
  root: string,
  options: {
    maximumFiles: number;
    maximumFileBytes: number;
    maximumBytes: number;
    rejectInstallerMetadata?: boolean;
    includeGit?: boolean;
  },
): Promise<CollectedFile[]> {
  const source = await canonicalDirectory(root);
  const files: CollectedFile[] = [];
  let totalBytes = 0;
  let directoryCount = 0;
  const visit = async (directory: string): Promise<void> => {
    directoryCount += 1;
    if (directoryCount > options.maximumFiles * 4) {
      throw new Error("Plugin package contains too many directories.");
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git" && !options.includeGit) continue;
      const path = join(directory, entry.name);
      const information = await lstat(path);
      if (information.isSymbolicLink()) {
        throw new Error(`Plugin packages cannot contain links: ${entry.name}`);
      }
      if (information.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!information.isFile()) {
        throw new Error(
          "Plugin packages can contain only files and directories.",
        );
      }
      const relativePath = portableRelative(relative(source, path));
      if (
        options.rejectInstallerMetadata &&
        isSkillInstallerMetadata(relativePath)
      ) {
        throw new Error("Plugin Skills cannot provide installer metadata.");
      }
      totalBytes += information.size;
      if (
        files.length + 1 > options.maximumFiles ||
        information.size > options.maximumFileBytes ||
        totalBytes > options.maximumBytes
      ) {
        throw new Error("Plugin package exceeds the installation limits.");
      }
      const contents = await readFile(path);
      files.push({
        absolutePath: path,
        relativePath,
        size: information.size,
        mode: information.mode,
        hash: createHash("sha256").update(contents).digest("hex"),
      });
    }
  };
  await visit(source);
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

function collectedHash(files: CollectedFile[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath).update("\0").update(file.hash).update("\0");
  }
  return hash.digest("hex");
}

async function verifyMarketplaceIntegrity(
  root: string,
  marketplaceFilePath: string,
): Promise<VerifiedMarketplaceIntegrity | undefined> {
  const integrityPath = join(root, ".artemis", "integrity.json");
  if (!(await exists(integrityPath))) return undefined;
  const marketplaceBytes = await readFile(marketplaceFilePath);
  const marketplace = record(JSON.parse(marketplaceBytes.toString("utf8")));
  const integrity = record(
    await readJson(integrityPath, MAX_MARKETPLACE_BYTES),
  );
  const signature = text(integrity?.signature);
  const publicKeyText = text(integrity?.publicKey);
  const fingerprint = text(integrity?.signingKeyFingerprint);
  if (
    integrity?.schemaVersion !== 1 ||
    integrity.signatureAlgorithm !== "Ed25519" ||
    !signature ||
    !publicKeyText ||
    !fingerprint ||
    !/^[a-f0-9]{64}$/u.test(fingerprint) ||
    integrity.marketplaceName !== marketplace?.name ||
    integrity.marketplaceHash !==
      createHash("sha256").update(marketplaceBytes).digest("hex")
  ) {
    throw new Error("Marketplace integrity declaration is invalid.");
  }
  const publicDer = Buffer.from(publicKeyText, "base64");
  if (createHash("sha256").update(publicDer).digest("hex") !== fingerprint) {
    throw new Error("Marketplace signing key fingerprint is invalid.");
  }
  const unsigned = { ...integrity };
  delete unsigned.signature;
  let validSignature = false;
  try {
    validSignature = verifySignature(
      null,
      Buffer.from(JSON.stringify(stableValue(unsigned))),
      createPublicKey({ key: publicDer, format: "der", type: "spki" }),
      Buffer.from(signature, "base64"),
    );
  } catch {
    validSignature = false;
  }
  if (!validSignature) throw new Error("Marketplace signature is invalid.");

  let sourceUrl: string | undefined;
  const declaredSourceUrl = text(integrity.sourceUrl);
  if (declaredSourceUrl) {
    try {
      sourceUrl = normalizeGithubMarketplaceUrl(declaredSourceUrl);
    } catch {
      throw new Error("Marketplace offline source URL is invalid.");
    }
  }

  const entries = Array.isArray(marketplace?.plugins)
    ? marketplace.plugins.map(record).filter(Boolean)
    : [];
  const signedPlugins = Array.isArray(integrity.plugins)
    ? integrity.plugins.map(record).filter(Boolean)
    : [];
  if (entries.length === 0 || signedPlugins.length !== entries.length) {
    throw new Error(
      "Marketplace signed plugin list does not match its catalog.",
    );
  }
  const byName = new Map(
    signedPlugins.map((plugin) => [text(plugin?.name), plugin] as const),
  );
  const pluginHashes = new Map<string, string>();
  const packageFiles = new Set([
    ".agents/plugins/marketplace.json",
    ".artemis/integrity.json",
  ]);
  const canonicalRoot = await realpath(root);
  for (const entry of entries) {
    const name = text(entry?.name);
    const sourceValue = entry?.source;
    const source = record(sourceValue);
    const sourcePath =
      typeof sourceValue === "string"
        ? text(sourceValue)
        : source?.source === "local"
          ? text(source.path)
          : undefined;
    const signed = name ? byName.get(name) : undefined;
    if (!name || !sourcePath || !signed) {
      throw new Error("Marketplace signed plugin entry is invalid.");
    }
    const pluginRoot = await canonicalDirectory(
      declaredPath(root, sourcePath, "Marketplace plugin"),
      root,
    );
    const pluginRelativeRoot = portableRelative(
      relative(canonicalRoot, pluginRoot),
    );
    const files = await collectFiles(pluginRoot, {
      maximumFiles: MAX_PLUGIN_FILES,
      maximumFileBytes: MAX_PLUGIN_FILE_BYTES,
      maximumBytes: MAX_PLUGIN_BYTES,
    });
    const manifest = record(
      await readJson(
        join(pluginRoot, ".codex-plugin", "plugin.json"),
        MAX_MANIFEST_BYTES,
      ),
    );
    const signedFiles = Array.isArray(signed.files)
      ? signed.files.map(record).filter(Boolean)
      : [];
    const exactFiles =
      signedFiles.length === files.length &&
      files.every((file, index) => {
        const expected = signedFiles[index];
        return (
          expected?.path === file.relativePath &&
          expected.size === file.size &&
          expected.sha256 === file.hash
        );
      });
    const hash = collectedHash(files);
    if (
      signed.version !== manifest?.version ||
      signed.contentHash !== hash ||
      signed.size !== files.reduce((sum, file) => sum + file.size, 0) ||
      !exactFiles
    ) {
      throw new Error(`Marketplace content signature failed for ${name}.`);
    }
    pluginHashes.set(name, hash);
    for (const file of files) {
      packageFiles.add(`${pluginRelativeRoot}/${file.relativePath}`);
    }
  }
  return {
    signingKeyFingerprint: fingerprint,
    pluginHashes,
    packageFiles,
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

async function validateOfflineMarketplacePackage(
  root: string,
  integrity: VerifiedMarketplaceIntegrity,
): Promise<void> {
  const files = await collectFiles(root, {
    maximumFiles: MAX_MARKETPLACE_ARCHIVE_ENTRIES,
    maximumFileBytes: MAX_PLUGIN_FILE_BYTES,
    maximumBytes: MAX_MARKETPLACE_ARCHIVE_UNPACKED_BYTES,
    includeGit: true,
  });
  const unexpected = files.find(
    (file) => !integrity.packageFiles.has(file.relativePath),
  );
  if (unexpected) {
    throw new Error(
      `Offline marketplace package contains an unsigned file: ${unexpected.relativePath}`,
    );
  }
  if (files.length !== integrity.packageFiles.size) {
    throw new Error("Offline marketplace package is incomplete.");
  }
}

async function installedSkillMatchesHash(
  root: string,
  expectedHash: string,
): Promise<boolean> {
  try {
    const files = await collectFiles(root, {
      maximumFiles: MAX_SKILL_FILES + 1,
      maximumFileBytes: MAX_SKILL_FILE_BYTES,
      maximumBytes: MAX_SKILL_BYTES,
    });
    return (
      collectedHash(
        files.filter((file) => !isSkillInstallerMetadata(file.relativePath)),
      ) === expectedHash
    );
  } catch {
    return false;
  }
}

async function copyCollectedFiles(
  destination: string,
  files: CollectedFile[],
): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const file of files) {
    const target = resolve(destination, ...file.relativePath.split("/"));
    if (!pathIsInside(destination, target)) {
      throw new Error(`Plugin contains an unsafe path: ${file.relativePath}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await copyFile(file.absolutePath, target);
    await chmod(target, file.mode & 0o777);
  }
}

async function discoverSkillRoots(root: string): Promise<string[]> {
  const roots: string[] = [];
  let visited = 0;
  const visit = async (directory: string): Promise<void> => {
    visited += 1;
    if (visited > MAX_SKILL_FILES * 4) {
      throw new Error("Plugin Skill directory contains too many entries.");
    }
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
      roots.push(directory);
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(directory, entry.name);
      const information = await lstat(path);
      if (information.isSymbolicLink()) {
        throw new Error("Plugin Skill directories cannot contain links.");
      }
      await visit(path);
    }
  };
  await visit(root);
  return roots;
}

function manifestPaths(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return strings(value);
}

function pluginRootSubstitution(value: string, pluginRoot: string): string {
  const rootReference =
    /\$(?:\{(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\}|(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\b)/u;
  if (rootReference.test(value)) {
    if (
      /\$(?:\{(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\}|(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\b)(?![\\/]|$)/u.test(
        value,
      ) ||
      value.replaceAll("\\", "/").split("/").includes("..")
    ) {
      throw new Error("MCP path escapes the installed plugin.");
    }
  }
  const substituted = value.replace(
    /\$(?:\{(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\}|(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\b)/gu,
    pluginRoot,
  );
  if (substituted.startsWith("./") || substituted.startsWith(".\\")) {
    const resolved = resolve(pluginRoot, substituted);
    if (!pathIsInside(pluginRoot, resolved)) {
      throw new Error("MCP command path escapes the installed plugin.");
    }
    return resolved;
  }
  return substituted;
}

function hasUnresolvedVariable(value: string): boolean {
  return /\$(?:\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}|[A-Za-z_][A-Za-z0-9_]*)/u.test(
    value,
  );
}

function hasCredentialArgument(args: string[]): boolean {
  return args.some(
    (argument) =>
      /^--?(?:authorization|api[-_]?key|access[-_]?token|auth[-_]?token|token|password|secret)(?:=|$)/iu.test(
        argument,
      ) || /^authorization:/iu.test(argument),
  );
}

function parseGoogleHostAuth(
  server: Record<string, unknown>,
  name: string,
  warnings: string[],
): GoogleMcpHostAuth | undefined {
  const declaration = record(record(server["x-artemis"])?.auth);
  if (!declaration) return undefined;
  const provider = text(declaration.provider);
  const grant = text(declaration.grant);
  const scopes = [...new Set(strings(declaration.scopes))];
  if (
    provider !== "google" ||
    (grant !== "google-workspace" && grant !== "gmail") ||
    scopes.length === 0 ||
    scopes.length > 20 ||
    scopes.some(
      (scope) =>
        !["openid", "email", "profile"].includes(scope) &&
        !scope.startsWith("https://www.googleapis.com/auth/"),
    )
  ) {
    warnings.push(
      `MCP server "${name}" has an invalid Artemis host authentication declaration.`,
    );
    return undefined;
  }
  return { provider: "google", grant, scopes };
}

function parseMcpServer(
  name: string,
  input: unknown,
  warnings: string[],
): ParsedMcpServer {
  const server = record(input);
  if (!server) {
    return {
      name,
      transport: "unsupported",
      endpoint: "Invalid MCP definition",
      importable: false,
      requiresSetup: true,
    };
  }
  const command = text(server.command);
  const type = text(server.type)?.toLowerCase();
  if (command || type === "stdio" || type === "local") {
    if (!command) {
      return {
        name,
        transport: "unsupported",
        endpoint: "Missing stdio command",
        importable: false,
        requiresSetup: true,
      };
    }
    const args = strings(server.args);
    const commandUsesArtemisNode = command === "${ARTEMIS_NODE}";
    const removePluginRoot = (value: string) =>
      value.replace(
        /\$(?:\{(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\}|(?:PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\b)/gu,
        "",
      );
    const unresolved =
      (!commandUsesArtemisNode &&
        hasUnresolvedVariable(removePluginRoot(command))) ||
      args.some((value) => hasUnresolvedVariable(removePluginRoot(value)));
    const environment = record(server.env) ?? {};
    const credentialArgument = hasCredentialArgument(args);
    const hostAuth = parseGoogleHostAuth(server, name, warnings);
    const envVars = new Set(strings(server.env_vars ?? server.envVars));
    const omittedKeys: string[] = [];
    for (const [key, value] of Object.entries(environment)) {
      const reference =
        typeof value === "string"
          ? /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/u.exec(
              value,
            )
          : undefined;
      const referencedName = reference?.[1] ?? reference?.[2];
      if (referencedName === key) envVars.add(key);
      else omittedKeys.push(key);
    }
    if (omittedKeys.length) {
      warnings.push(
        `MCP server "${name}" requires manual environment values for: ${omittedKeys.join(", ")}. No values were imported.`,
      );
    }
    if (server.cwd !== undefined) {
      warnings.push(
        `MCP server "${name}" declares a custom cwd; Artemis uses a private managed workspace instead.`,
      );
    }
    if (unresolved) {
      warnings.push(
        `MCP server "${name}" contains unresolved command variables and was not imported.`,
      );
    }
    if (credentialArgument) {
      warnings.push(
        `MCP server "${name}" contains a credential argument and was not imported.`,
      );
    }
    return {
      name,
      transport: "stdio",
      endpoint: command,
      importable: !unresolved && !credentialArgument,
      requiresSetup: omittedKeys.length > 0 || unresolved || credentialArgument,
      command,
      args,
      envVars: [...envVars],
      ...(hostAuth ? { hostAuth, requiresSetup: true } : {}),
    };
  }

  const urlText = text(server.url);
  if (urlText && [undefined, "http", "streamable-http"].includes(type)) {
    let url: URL;
    try {
      url = new URL(urlText);
    } catch {
      return {
        name,
        transport: "unsupported",
        endpoint: "Invalid URL",
        importable: false,
        requiresSetup: true,
      };
    }
    const safeEndpoint = `${url.origin}${url.pathname}`;
    if (url.username || url.password || url.search || url.hash) {
      warnings.push(
        `MCP server "${name}" has an endpoint containing credentials or URL parameters and was not imported.`,
      );
      return {
        name,
        transport: "unsupported",
        endpoint: safeEndpoint,
        importable: false,
        requiresSetup: true,
      };
    }
    const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
      url.hostname,
    );
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      warnings.push(
        `MCP server "${name}" uses an insecure non-loopback URL and was not imported.`,
      );
      return {
        name,
        transport: "unsupported",
        endpoint: safeEndpoint,
        importable: false,
        requiresSetup: true,
      };
    }
    const headers = record(server.headers) ?? record(server.http_headers) ?? {};
    const headerNames = Object.keys(headers);
    const unsupportedHeaders = headerNames.filter(
      (header) => header.toLowerCase() !== "authorization",
    );
    const auth: "none" | "bearer" | "oauth" =
      server.oauth_resource !== undefined || text(server.auth) === "oauth"
        ? "oauth"
        : headerNames.some(
              (header) => header.toLowerCase() === "authorization",
            ) || server.bearer_token_env_var !== undefined
          ? "bearer"
          : "none";
    if (auth === "bearer") {
      warnings.push(
        `MCP server "${name}" requires a bearer token. No credential was imported.`,
      );
    }
    if (unsupportedHeaders.length) {
      warnings.push(
        `MCP server "${name}" needs unsupported HTTP headers (${unsupportedHeaders.join(", ")}) and was not imported.`,
      );
    }
    return {
      name,
      transport: "streamable-http",
      endpoint: url.href,
      importable: unsupportedHeaders.length === 0,
      requiresSetup: auth === "bearer" || unsupportedHeaders.length > 0,
      url: url.href,
      auth,
    };
  }

  return {
    name,
    transport: "unsupported",
    endpoint: type ?? "Unsupported MCP transport",
    importable: false,
    requiresSetup: true,
  };
}

function mcpServerMap(value: unknown): Record<string, unknown> {
  const object = record(value) ?? {};
  return record(object.mcpServers) ?? record(object.mcp_servers) ?? object;
}

function previewMcp(server: ParsedMcpServer): CodexPluginMcpPreview {
  return {
    name: server.name,
    transport: server.transport,
    endpoint: server.endpoint,
    importable: server.importable,
    requiresSetup: server.requiresSetup,
  };
}

const MAX_GITHUB_RATE_LIMIT_RETRY_MILLISECONDS = 15_000;

interface GitHubRateLimit {
  resetAt?: Date;
  retryAfterMilliseconds?: number;
}

function githubRetryAfterMilliseconds(
  value: string | null,
): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? Math.max(0, timestamp - Date.now())
    : undefined;
}

function githubRateLimit(response: Response): GitHubRateLimit | undefined {
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (
    response.status !== 429 &&
    !(response.status === 403 && remaining === "0")
  ) {
    return undefined;
  }
  const explicitRetryAfterMilliseconds = githubRetryAfterMilliseconds(
    response.headers.get("retry-after"),
  );
  const resetSeconds = Number(response.headers.get("x-ratelimit-reset"));
  const now = Date.now();
  const resetAt =
    Number.isFinite(resetSeconds) && resetSeconds > 0
      ? new Date(resetSeconds * 1_000)
      : explicitRetryAfterMilliseconds === undefined
        ? undefined
        : new Date(now + explicitRetryAfterMilliseconds);
  const retryAfterMilliseconds =
    explicitRetryAfterMilliseconds ??
    (resetAt ? Math.max(0, resetAt.getTime() - now) : undefined);
  return {
    ...(retryAfterMilliseconds === undefined ? {} : { retryAfterMilliseconds }),
    ...(resetAt ? { resetAt } : {}),
  };
}

function githubRateLimitError(limit: GitHubRateLimit): Error {
  const retry = limit.resetAt
    ? ` Try again after ${limit.resetAt.toLocaleString()}.`
    : " Try again after the GitHub rate-limit window resets.";
  return new Error(
    `GitHub marketplace download was rate limited because unauthenticated requests share a 60 requests/hour per-IP quota.${retry}`,
  );
}

async function downloadResponse(
  response: Response,
  destination: string,
): Promise<void> {
  if (!response.ok) {
    const limit = githubRateLimit(response);
    if (limit) throw githubRateLimitError(limit);
    throw new Error(
      `GitHub marketplace download failed (HTTP ${response.status}).`,
    );
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_MARKETPLACE_ARCHIVE_BYTES
  ) {
    throw new Error("GitHub marketplace archive is too large.");
  }
  if (!response.body) {
    throw new Error("GitHub marketplace download returned no content.");
  }
  const reader = response.body.getReader();
  const file = await open(destination, "wx", 0o600);
  let complete = false;
  let downloaded = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      downloaded += chunk.value.byteLength;
      if (downloaded > MAX_MARKETPLACE_ARCHIVE_BYTES) {
        throw new Error("GitHub marketplace archive is too large.");
      }
      await file.write(chunk.value);
    }
    if (downloaded === 0) {
      throw new Error("GitHub marketplace download returned no content.");
    }
    complete = true;
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    await file.close();
  }
}

async function extractMarketplaceArchive(
  archivePath: string,
  destination: string,
  label: string,
): Promise<void> {
  const archive = await lstat(archivePath);
  if (
    archive.isSymbolicLink() ||
    !archive.isFile() ||
    archive.size === 0 ||
    archive.size > MAX_MARKETPLACE_ARCHIVE_BYTES
  ) {
    throw new Error(`${label} archive is invalid or too large.`);
  }
  await mkdir(destination, { recursive: true });
  let archiveRoot: string | undefined;
  let entryCount = 0;
  let fileCount = 0;
  let unpackedBytes = 0;
  await extractTar({
    cwd: destination,
    file: archivePath,
    noMtime: true,
    preserveOwner: false,
    strict: true,
    strip: 1,
    unlink: true,
    filter: (entryPath, entry) => {
      if (!("type" in entry)) {
        throw new Error(`${label} archive entry is invalid.`);
      }
      if (
        !entryPath ||
        entryPath.length > 4_096 ||
        entryPath.includes("\0") ||
        entryPath.includes("\\") ||
        entryPath.startsWith("/") ||
        /^[A-Za-z]:/u.test(entryPath)
      ) {
        throw new Error(`${label} archive contains an unsafe path.`);
      }
      const segments = entryPath.split("/").filter(Boolean);
      if (
        segments.length === 0 ||
        segments.some(
          (segment) =>
            segment === "." || segment === ".." || segment === ".git",
        )
      ) {
        throw new Error(`${label} archive contains an unsafe path.`);
      }
      archiveRoot ??= segments[0];
      if (segments[0] !== archiveRoot) {
        throw new Error(`${label} archive has multiple roots.`);
      }
      if (entry.type !== "Directory" && entry.type !== "File") {
        throw new Error(`${label} archive contains links.`);
      }
      entryCount += 1;
      if (entryCount > MAX_MARKETPLACE_ARCHIVE_ENTRIES) {
        throw new Error(`${label} archive contains too many files.`);
      }
      if (entry.type === "File") {
        fileCount += 1;
        unpackedBytes += entry.size;
        if (
          entry.size > MAX_PLUGIN_FILE_BYTES ||
          unpackedBytes > MAX_MARKETPLACE_ARCHIVE_UNPACKED_BYTES
        ) {
          throw new Error(`${label} archive is too large.`);
        }
      }
      entry.mode =
        (entry.mode ?? (entry.type === "Directory" ? 0o755 : 0o644)) & 0o777;
      return true;
    },
  });
  if (!archiveRoot || fileCount === 0) {
    throw new Error(`${label} archive is empty.`);
  }
}

async function defaultDownloadRepository(
  url: string,
  destination: string,
  fetcher: MarketplaceFetcher,
): Promise<void> {
  const repository = githubMarketplaceRepository(url);
  const archiveUrl = new URL(`/repos/${repository}/tarball`, GITHUB_API).href;
  const archivePath = `${destination}.tar.gz`;
  const requestArchive = () =>
    fetcher(archiveUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Artemis/0.1",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(120_000),
    });
  let response = await requestArchive();
  const limit = githubRateLimit(response);
  if (
    limit?.retryAfterMilliseconds !== undefined &&
    limit.retryAfterMilliseconds <= MAX_GITHUB_RATE_LIMIT_RETRY_MILLISECONDS
  ) {
    await response.body?.cancel().catch(() => undefined);
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, limit.retryAfterMilliseconds),
    );
    response = await requestArchive();
  }
  await downloadResponse(response, archivePath);
  try {
    await extractMarketplaceArchive(
      archivePath,
      destination,
      "GitHub marketplace",
    );
  } finally {
    await rm(archivePath, { force: true }).catch(() => undefined);
  }
}

async function stageOfflineMarketplaceInput(
  inputPath: string,
  destination: string,
): Promise<void> {
  if (!isAbsolute(inputPath) || !inputPath.trim()) {
    throw new Error("Offline marketplace path is invalid.");
  }
  const information = await lstat(inputPath);
  if (information.isSymbolicLink()) {
    throw new Error("Offline marketplace source cannot be a symbolic link.");
  }
  if (information.isDirectory()) {
    const files = await collectFiles(inputPath, {
      maximumFiles: MAX_MARKETPLACE_ARCHIVE_ENTRIES,
      maximumFileBytes: MAX_PLUGIN_FILE_BYTES,
      maximumBytes: MAX_MARKETPLACE_ARCHIVE_UNPACKED_BYTES,
      includeGit: true,
    });
    if (files.length === 0) {
      throw new Error("Offline marketplace directory is empty.");
    }
    await copyCollectedFiles(destination, files);
    return;
  }
  const archiveName = basename(inputPath).toLowerCase();
  if (
    !information.isFile() ||
    (!archiveName.endsWith(".tar.gz") && !archiveName.endsWith(".tgz"))
  ) {
    throw new Error(
      "Offline marketplace must be an extracted directory, .tar.gz, or .tgz package.",
    );
  }
  await extractMarketplaceArchive(
    inputPath,
    destination,
    "Offline marketplace",
  );
}

function normalizeMarketplaceUrl(input: string): string {
  const trimmed = input.trim();
  const shorthand = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u.exec(trimmed);
  const value = shorthand
    ? `https://github.com/${shorthand[1]}/${shorthand[2]}.git`
    : trimmed;
  if (!value || value.length > 2_048) {
    throw new Error("Git marketplace URL is invalid.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "Git marketplace must be an HTTPS URL or owner/repository.",
    );
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(
      "Git marketplace must use HTTPS without embedded credentials.",
    );
  }
  if (url.search || url.hash) {
    throw new Error("Git marketplace URL cannot contain a query or fragment.");
  }
  if (url.hostname.toLowerCase() === "github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      parts.length === 2 &&
      parts.every((part) => /^[A-Za-z0-9_.-]+$/u.test(part))
    ) {
      url.pathname = `/${parts[0]}/${parts[1]!.replace(/\.git$/u, "")}.git`;
    }
  }
  return url.href;
}

function githubMarketplaceRepository(urlInput: string): string {
  const url = new URL(urlInput);
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.port ||
    parts.length !== 2 ||
    !parts.every((part) => /^[A-Za-z0-9_.-]+$/u.test(part))
  ) {
    throw new Error(
      "Plugin marketplaces must be public GitHub.com repositories.",
    );
  }
  return `${parts[0]}/${parts[1]!.replace(/\.git$/u, "")}`;
}

function normalizeGithubMarketplaceUrl(input: string): string {
  const url = normalizeMarketplaceUrl(input);
  const repository = githubMarketplaceRepository(url).toLowerCase();
  return `https://github.com/${repository}.git`;
}

function marketplaceSourceId(url: string): string {
  return `marketplace-${createHash("sha256")
    .update(url)
    .digest("hex")
    .slice(0, 20)}`;
}

function marketplaceDownloadFailure(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /authentication failed|repository not found|could not read username|terminal prompts disabled|access denied/iu.test(
      message,
    )
  ) {
    return new Error(
      "GitHub marketplace could not be downloaded. Verify that the repository exists and is public.",
    );
  }
  return error instanceof Error ? error : new Error(message);
}

function validateSource(source: CodexPluginSource): CodexPluginSource {
  if (source.kind === "local") {
    if (!isAbsolute(source.path) || !source.path.trim()) {
      throw new Error("Local plugin source path is invalid.");
    }
    return { kind: "local", path: source.path };
  }
  if (source.kind === "bundled" || source.kind === "runtime") {
    if (!BUNDLED_ARTIFACT_PLUGIN_NAMES.has(source.pluginName)) {
      throw new Error("Bundled artifact plugin source is invalid.");
    }
    return { kind: source.kind, pluginName: source.pluginName };
  }
  if (
    !source.marketplaceName.trim() ||
    !source.pluginName.trim() ||
    source.marketplaceName.length > 120 ||
    source.pluginName.length > 120
  ) {
    throw new Error("Git plugin source is invalid.");
  }
  return {
    kind: "git",
    marketplaceUrl: normalizeMarketplaceUrl(source.marketplaceUrl),
    marketplaceName: source.marketplaceName.trim(),
    pluginName: source.pluginName.trim(),
  };
}

function validateStoredMarketplaceSource(
  value: unknown,
): StoredMarketplaceSource {
  const input = record(value);
  const id = text(input?.id);
  const marketplaceName = text(input?.marketplaceName);
  const displayName = text(input?.displayName);
  const addedAt = text(input?.addedAt);
  const cachePath = text(input?.cachePath);
  const signingKeyFingerprint = text(input?.signingKeyFingerprint);
  const modeInput = text(input?.mode);
  const mode: "git" | "offline" =
    modeInput === undefined || modeInput === "git" ? "git" : "offline";
  const url = normalizeGithubMarketplaceUrl(text(input?.url) ?? "");
  if (
    (modeInput !== undefined &&
      modeInput !== "git" &&
      modeInput !== "offline") ||
    !id ||
    id !== marketplaceSourceId(url) ||
    !marketplaceName ||
    !/^[a-z0-9][a-z0-9._-]{0,119}$/u.test(marketplaceName) ||
    !displayName ||
    displayName.length > 120 ||
    !addedAt
  ) {
    throw new Error("Plugin marketplace source is invalid.");
  }
  if (signingKeyFingerprint && !/^[a-f0-9]{64}$/u.test(signingKeyFingerprint)) {
    throw new Error("Plugin marketplace signing key fingerprint is invalid.");
  }
  return {
    id,
    url,
    marketplaceName,
    displayName,
    addedAt,
    mode,
    ...(cachePath ? { cachePath } : {}),
    ...(signingKeyFingerprint ? { signingKeyFingerprint } : {}),
  };
}

function validateStoredPlugin(value: unknown): StoredPlugin {
  const input = record(value);
  if (!input) throw new Error("Installed plugin record is invalid.");
  const id = text(input.id);
  const name = text(input.name);
  const displayName = text(input.displayName);
  const version = text(input.version);
  const description =
    typeof input.description === "string" ? input.description : "";
  const shortDescription = text(input.shortDescription);
  const category = text(input.category);
  const brandColor = text(input.brandColor);
  const iconDataUrl = text(input.iconDataUrl);
  const contentHash = text(input.contentHash);
  const installedAt = text(input.installedAt);
  const updatedAt = text(input.updatedAt);
  if (
    !id ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(id) ||
    !name ||
    !displayName ||
    !version ||
    !contentHash ||
    !/^[a-f0-9]{64}$/u.test(contentHash) ||
    !installedAt ||
    !updatedAt ||
    (shortDescription !== undefined && shortDescription.length > 300) ||
    (category !== undefined && category.length > 80) ||
    (brandColor !== undefined && !/^#[a-f0-9]{6}$/iu.test(brandColor)) ||
    (iconDataUrl !== undefined &&
      (!/^data:image\/png;base64,[a-z0-9+/]+=*$/iu.test(iconDataUrl) ||
        iconDataUrl.length > Math.ceil((MAX_ICON_BYTES * 4) / 3) + 64))
  ) {
    throw new Error("Installed plugin record is invalid.");
  }
  const source = validateSource(input.source as CodexPluginSource);
  const skills = Array.isArray(input.skills)
    ? input.skills.map((entry): StoredSkill => {
        const skill = record(entry);
        const skillName = text(skill?.name);
        const hash = text(skill?.hash);
        if (!skillName || !hash || !/^[a-f0-9]{64}$/u.test(hash)) {
          throw new Error("Installed plugin Skill record is invalid.");
        }
        return { name: skillName, hash };
      })
    : [];
  const mcpServers = Array.isArray(input.mcpServers)
    ? input.mcpServers.map((entry): StoredMcpServer => {
        const server = record(entry);
        const serverId = text(server?.id);
        const structuralHash = text(server?.structuralHash);
        if (
          !serverId ||
          !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(serverId) ||
          !structuralHash ||
          !/^[a-f0-9]{64}$/u.test(structuralHash)
        ) {
          throw new Error("Installed plugin MCP record is invalid.");
        }
        return { id: serverId, structuralHash };
      })
    : [];
  const appPreviews = Array.isArray(input.appPreviews)
    ? input.appPreviews.flatMap((entry) => {
        const app = record(entry);
        const appName = text(app?.name);
        const connectorId = text(app?.connectorId);
        const required = app?.required === true;
        const url = connectorEndpoint(app?.url);
        const authInput = text(app?.auth);
        const auth: "none" | "bearer" | "oauth" | undefined =
          url &&
          (authInput === "none" ||
            authInput === "bearer" ||
            authInput === "oauth")
            ? authInput
            : undefined;
        if (!appName || appName.length > 120) return [];
        return [
          {
            name: appName,
            ...(connectorId && connectorId.length <= 200
              ? { connectorId }
              : {}),
            ...(required ? { required: true } : {}),
            ...(url ? { url } : {}),
            ...(auth ? { auth } : {}),
          },
        ];
      })
    : [];
  return {
    id,
    name,
    displayName,
    version,
    description,
    ...(shortDescription ? { shortDescription } : {}),
    ...(category ? { category } : {}),
    ...(brandColor ? { brandColor } : {}),
    ...(iconDataUrl ? { iconDataUrl } : {}),
    source,
    contentHash,
    installedAt,
    updatedAt,
    skills,
    mcpServers,
    skillPreviews: Array.isArray(input.skillPreviews)
      ? (input.skillPreviews as CodexPluginPreview["skills"])
      : [],
    mcpPreviews: Array.isArray(input.mcpPreviews)
      ? (input.mcpPreviews as CodexPluginPreview["mcpServers"])
      : [],
    appPreviews,
    unsupported: strings(input.unsupported),
    warnings: strings(input.warnings),
  };
}

export class CodexPluginService {
  private readonly cloneRepository: CloneRepository;
  private readonly marketplaceRefreshErrors = new Map<string, string>();
  private state: PluginStore | undefined;
  private marketplaceState: MarketplaceStore | undefined;
  private operation: Promise<void> = Promise.resolve();

  constructor(private readonly options: CodexPluginServiceOptions) {
    const fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.cloneRepository =
      options.cloneRepository ??
      ((url, destination) =>
        defaultDownloadRepository(url, destination, fetcher));
  }

  async listInstalled(): Promise<InstalledCodexPlugin[]> {
    const plugins = (await this.loadStore()).plugins.map((plugin) =>
      this.installedPlugin(plugin),
    );
    const bundledMarketplace = plugins.some(
      (plugin) =>
        plugin.source.kind === "bundled" || plugin.source.kind === "runtime",
    )
      ? await this.loadBundledArtifactMarketplace()
      : undefined;
    const currentBundledPlugins = new Map(
      (bundledMarketplace?.plugins ?? []).map((plugin) => [plugin.id, plugin]),
    );
    return plugins
      .map((plugin) => {
        const bundled = currentBundledPlugins.get(plugin.id);
        if (!bundled) return plugin;
        return {
          ...plugin,
          ...(bundled.brandColor ? { brandColor: bundled.brandColor } : {}),
          ...(bundled.iconDataUrl ? { iconDataUrl: bundled.iconDataUrl } : {}),
        };
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  async inspectLocal(sourcePath: string): Promise<CodexPluginPreview> {
    await this.loadStore();
    const root = await canonicalDirectory(sourcePath);
    const source: CodexPluginSource = { kind: "local", path: root };
    return this.preview(await this.parsePlugin(root, source, false));
  }

  async loadGitMarketplace(
    inputUrl: string,
    onProgress?: ProgressReporter,
    refresh = false,
  ): Promise<CodexPluginMarketplace> {
    const url = normalizeGithubMarketplaceUrl(inputUrl);
    return this.exclusive(() =>
      this.loadGitMarketplaceCore(url, onProgress, refresh),
    );
  }

  async listMarketplaces(
    sourceId?: string,
  ): Promise<CodexPluginMarketplaceState> {
    return this.exclusive(() => this.marketplaceSnapshot(sourceId));
  }

  async addMarketplace(
    inputUrl: string,
    onProgress?: ProgressReporter,
    expectedSigningKeyFingerprint?: string,
  ): Promise<CodexPluginMarketplaceState> {
    return this.exclusive(async () => {
      const url = normalizeGithubMarketplaceUrl(inputUrl);
      const store = await this.loadMarketplaceStore();
      const existing = store.sources.find((source) => source.url === url);
      if (existing) {
        store.selectedView = existing.id;
        await this.saveMarketplaceStore(store);
        onProgress?.(100);
        return this.marketplaceSnapshot();
      }
      if (store.sources.length >= MAX_USER_MARKETPLACES) {
        throw new Error(
          `No more than ${MAX_USER_MARKETPLACES} user plugin marketplaces can be added.`,
        );
      }
      const marketplace = await this.loadGitMarketplaceCore(
        url,
        onProgress,
        true,
        undefined,
        this.isStrictGithubMarketplace(url),
        expectedSigningKeyFingerprint,
      );
      const cachePath = this.marketplaceCache(url);
      const integrity = await verifyMarketplaceIntegrity(
        cachePath,
        await this.marketplaceFile(cachePath),
      );
      if (
        integrity?.signingKeyFingerprint !== expectedSigningKeyFingerprint ||
        (!integrity && expectedSigningKeyFingerprint)
      ) {
        await rm(cachePath, { recursive: true, force: true });
        throw new Error(
          "Marketplace signing key was not confirmed. Inspect and confirm its trust details before adding it.",
        );
      }
      const now = new Date().toISOString();
      const source: StoredMarketplaceSource = {
        id: marketplaceSourceId(url),
        url,
        marketplaceName: marketplace.marketplaceName,
        displayName: marketplace.name,
        addedAt: now,
        mode: "git",
        cachePath,
        ...(integrity
          ? { signingKeyFingerprint: integrity.signingKeyFingerprint }
          : {}),
      };
      store.sources.push(source);
      store.selectedView = source.id;
      await this.saveMarketplaceStore(store);
      return this.marketplaceSnapshot();
    });
  }

  async inspectMarketplaceTrust(
    inputUrl: string,
  ): Promise<CodexPluginMarketplaceTrustPreview> {
    return this.exclusive(async () => {
      const url = normalizeGithubMarketplaceUrl(inputUrl);
      const stage = join(
        this.options.marketplacesRoot,
        `.inspect-${randomUUID()}`,
      );
      await mkdir(this.options.marketplacesRoot, { recursive: true });
      try {
        await this.cloneRepository(url, stage);
        const marketplace = await this.readMarketplace(stage, url, {
          strict: this.isStrictGithubMarketplace(url),
          validatePluginFiles: this.isStrictGithubMarketplace(url),
        });
        const integrity = await verifyMarketplaceIntegrity(
          stage,
          await this.marketplaceFile(stage),
        );
        return {
          url,
          repository: githubMarketplaceRepository(url),
          marketplaceName: marketplace.marketplaceName,
          displayName: marketplace.name,
          signed: Boolean(integrity),
          ...(integrity
            ? { signingKeyFingerprint: integrity.signingKeyFingerprint }
            : {}),
        };
      } finally {
        await rm(stage, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
    });
  }

  async inspectOfflineMarketplace(
    inputPath: string,
  ): Promise<CodexPluginMarketplaceTrustPreview> {
    return this.exclusive(async () => {
      const stage = join(
        this.options.marketplacesRoot,
        `.inspect-offline-${randomUUID()}`,
      );
      await mkdir(this.options.marketplacesRoot, { recursive: true });
      try {
        await stageOfflineMarketplaceInput(inputPath, stage);
        const { marketplace, integrity } =
          await this.readOfflineMarketplaceCandidate(stage);
        return {
          url: integrity.sourceUrl,
          repository: githubMarketplaceRepository(integrity.sourceUrl),
          marketplaceName: marketplace.marketplaceName,
          displayName: marketplace.name,
          signed: true,
          signingKeyFingerprint: integrity.signingKeyFingerprint,
        };
      } finally {
        await rm(stage, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
    });
  }

  async addOfflineMarketplace(
    inputPath: string,
    expectedSigningKeyFingerprint: string,
    onProgress?: ProgressReporter,
  ): Promise<CodexPluginMarketplaceState> {
    return this.exclusive(async () => {
      const stage = join(
        this.options.marketplacesRoot,
        `.import-offline-${randomUUID()}`,
      );
      await mkdir(this.options.marketplacesRoot, { recursive: true });
      onProgress?.(5);
      let cacheInstalled = false;
      let oldCacheMoved = false;
      let cache = "";
      let backup = "";
      let previousStore: MarketplaceStore | undefined;
      let storeSaved = false;
      try {
        await stageOfflineMarketplaceInput(inputPath, stage);
        onProgress?.(40);
        const { marketplace, integrity } =
          await this.readOfflineMarketplaceCandidate(stage);
        if (
          !expectedSigningKeyFingerprint ||
          integrity.signingKeyFingerprint !== expectedSigningKeyFingerprint
        ) {
          throw new Error(
            "Offline marketplace signing key was not confirmed. Inspect and confirm the package again.",
          );
        }
        const store = await this.loadMarketplaceStore();
        previousStore = structuredClone(store);
        const id = marketplaceSourceId(integrity.sourceUrl);
        const existing = store.sources.find((source) => source.id === id);
        if (!existing && store.sources.length >= MAX_USER_MARKETPLACES) {
          throw new Error(
            `No more than ${MAX_USER_MARKETPLACES} user plugin marketplaces can be added.`,
          );
        }
        cache = this.marketplaceCache(integrity.sourceUrl);
        backup = `${cache}.backup-${randomUUID()}`;
        if (await exists(cache)) {
          await rename(cache, backup);
          oldCacheMoved = true;
        }
        await rename(stage, cache);
        cacheInstalled = true;
        onProgress?.(75);
        const now = new Date().toISOString();
        const source: StoredMarketplaceSource = {
          id,
          url: integrity.sourceUrl,
          marketplaceName: marketplace.marketplaceName,
          displayName: marketplace.name,
          addedAt: existing?.addedAt ?? now,
          mode: "offline",
          cachePath: cache,
          signingKeyFingerprint: integrity.signingKeyFingerprint,
        };
        const nextStore: MarketplaceStore = {
          version: 1,
          selectedView: id,
          sources: existing
            ? store.sources.map((candidate) =>
                candidate.id === id ? source : candidate,
              )
            : [...store.sources, source],
        };
        await this.saveMarketplaceStore(nextStore);
        storeSaved = true;
        const result = await this.marketplaceSnapshot();
        if (oldCacheMoved) {
          await rm(backup, { recursive: true, force: true }).catch(
            () => undefined,
          );
        }
        onProgress?.(100);
        return result;
      } catch (error) {
        if (cacheInstalled && cache) {
          await rm(cache, { recursive: true, force: true }).catch(
            () => undefined,
          );
        }
        if (oldCacheMoved && cache && backup && (await exists(backup))) {
          await rename(backup, cache).catch(() => undefined);
        }
        if (storeSaved && previousStore) {
          await this.saveMarketplaceStore(previousStore).catch(() => undefined);
        }
        throw error;
      } finally {
        await rm(stage, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
    });
  }

  async selectMarketplace(
    sourceId: string,
  ): Promise<CodexPluginMarketplaceState> {
    return this.exclusive(async () => {
      const store = await this.loadMarketplaceStore();
      if (
        sourceId !== BUNDLED_MARKETPLACE_ID &&
        sourceId !== LOCAL_MARKETPLACE_ID &&
        !store.sources.some((source) => source.id === sourceId)
      ) {
        throw new Error("Plugin marketplace was not found.");
      }
      store.selectedView = sourceId;
      await this.saveMarketplaceStore(store);
      return this.marketplaceSnapshot();
    });
  }

  async refreshMarketplaceSource(
    sourceId: string,
    onProgress?: ProgressReporter,
  ): Promise<CodexPluginMarketplaceState> {
    return this.exclusive(async () => {
      if (
        sourceId === BUNDLED_MARKETPLACE_ID ||
        sourceId === LOCAL_MARKETPLACE_ID
      ) {
        throw new Error("This plugin source does not have a Git marketplace.");
      }
      const store = await this.loadMarketplaceStore();
      const stored = store.sources.find((source) => source.id === sourceId);
      const url = stored?.url;
      if (!url) throw new Error("Plugin marketplace was not found.");
      if (stored?.mode === "offline") {
        throw new Error(
          "Offline marketplaces cannot be refreshed from the network. Import a newer offline package instead.",
        );
      }
      let expectedMarketplaceName = stored?.marketplaceName;
      if (!expectedMarketplaceName) {
        const cache = this.marketplaceCache(url);
        if (await exists(cache)) {
          expectedMarketplaceName = (await this.readMarketplace(cache, url))
            .marketplaceName;
        }
      }
      let marketplace: CodexPluginMarketplace;
      try {
        marketplace = await this.loadGitMarketplaceCore(
          url,
          onProgress,
          true,
          expectedMarketplaceName,
          this.isStrictGithubMarketplace(url),
          stored?.signingKeyFingerprint,
        );
        this.marketplaceRefreshErrors.delete(sourceId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.marketplaceRefreshErrors.set(
          sourceId,
          `Refresh failed. The last cached marketplace was preserved and may be stale. Retry refresh. ${message}`,
        );
        throw error;
      }
      if (stored && stored.displayName !== marketplace.name) {
        stored.displayName = marketplace.name;
        await this.saveMarketplaceStore(store);
      }
      return this.marketplaceSnapshot();
    });
  }

  async removeMarketplace(
    sourceId: string,
  ): Promise<CodexPluginMarketplaceState> {
    return this.exclusive(async () => {
      if (sourceId === BUNDLED_MARKETPLACE_ID) {
        throw new Error("Bundled plugins cannot be removed.");
      }
      const store = await this.loadMarketplaceStore();
      const source = store.sources.find(
        (candidate) => candidate.id === sourceId,
      );
      if (!source) throw new Error("Plugin marketplace was not found.");
      store.sources = store.sources.filter(
        (candidate) => candidate.id !== sourceId,
      );
      if (store.selectedView === sourceId) {
        store.selectedView = BUNDLED_MARKETPLACE_ID;
      }
      this.marketplaceRefreshErrors.delete(sourceId);
      await this.saveMarketplaceStore(store);
      await rm(this.marketplaceCache(source.url), {
        recursive: true,
        force: true,
      }).catch(() => undefined);
      return this.marketplaceSnapshot();
    });
  }

  async reorderMarketplaces(
    sourceIds: string[],
  ): Promise<CodexPluginMarketplaceState> {
    return this.exclusive(async () => {
      const store = await this.loadMarketplaceStore();
      const unique = new Set(sourceIds);
      if (
        sourceIds.length !== store.sources.length ||
        unique.size !== sourceIds.length ||
        store.sources.some((source) => !unique.has(source.id))
      ) {
        throw new Error("Plugin marketplace order is invalid.");
      }
      const byId = new Map(store.sources.map((source) => [source.id, source]));
      store.sources = sourceIds.map((sourceId) => byId.get(sourceId)!);
      await this.saveMarketplaceStore(store);
      return this.marketplaceSnapshot();
    });
  }

  async loadBundledArtifactMarketplace(): Promise<
    CodexPluginMarketplace | undefined
  > {
    return this.exclusive(async () => {
      try {
        const marketplaceRoot = await this.bundledArtifactMarketplaceLocation();
        if (!marketplaceRoot) return undefined;
        const marketplace = await this.readMarketplace(
          marketplaceRoot,
          "artemis-bundled://lite-v1",
          {
            allowedPlugins: BUNDLED_ARTIFACT_PLUGIN_NAMES,
            displayName: "Bundled plugins",
            bundledSources: true,
            validatePluginFiles: true,
          },
        );
        const discoveredNames = new Set(
          marketplace.plugins
            .filter((plugin) => plugin.installable)
            .map((plugin) => plugin.name),
        );
        const missingNames = [...BUNDLED_ARTIFACT_PLUGIN_NAMES].filter(
          (name) => !discoveredNames.has(name),
        );
        if (missingNames.length) {
          marketplace.warnings.push(
            `Bundled plugins are unavailable: ${missingNames.join(", ")}.`,
          );
        }
        return marketplace.plugins.length ? marketplace : undefined;
      } catch {
        return undefined;
      }
    });
  }

  async install(
    sourceInput: CodexPluginSource,
    onProgress?: ProgressReporter,
  ): Promise<{ plugin: InstalledCodexPlugin; warnings: string[] }> {
    return this.exclusive(async () => {
      const parsed = await this.resolveSource(
        validateSource(sourceInput),
        false,
      );
      this.assertSupportedAppConnectors(parsed);
      const store = await this.loadStore();
      if (store.plugins.some((plugin) => plugin.id === parsed.id)) {
        throw new Error("Plugin is already installed. Use Update instead.");
      }
      return this.commitInstall(parsed, undefined, onProgress);
    });
  }

  async update(
    pluginIdentifier: string,
    onProgress?: ProgressReporter,
  ): Promise<{ plugin: InstalledCodexPlugin; warnings: string[] }> {
    return this.exclusive(async () => {
      const store = await this.loadStore();
      const existing = store.plugins.find(
        (plugin) => plugin.id === pluginIdentifier,
      );
      if (!existing) throw new Error("Installed plugin was not found.");
      if (existing.source.kind === "git") {
        const gitSource = existing.source;
        const trustedSource = (await this.loadMarketplaceStore()).sources.find(
          (source) =>
            source.url === normalizeMarketplaceUrl(gitSource.marketplaceUrl),
        );
        if (trustedSource?.mode !== "offline") {
          await this.refreshMarketplace(
            gitSource.marketplaceUrl,
            onProgress,
            gitSource.marketplaceName,
            this.isStrictGithubMarketplace(gitSource.marketplaceUrl),
            trustedSource?.signingKeyFingerprint,
          );
        }
      }
      const parsed = await this.resolveSource(existing.source, true);
      this.assertSupportedAppConnectors(parsed);
      if (parsed.id !== existing.id) {
        throw new Error(
          "Plugin source identity changed and cannot be updated in place.",
        );
      }
      return this.commitInstall(parsed, existing, onProgress);
    });
  }

  async remove(pluginIdentifier: string): Promise<{ warnings: string[] }> {
    return this.exclusive(async () => {
      const store = await this.loadStore();
      const existing = store.plugins.find(
        (plugin) => plugin.id === pluginIdentifier,
      );
      if (!existing) throw new Error("Installed plugin was not found.");
      const currentMcp = await this.options.mcpStore.list();
      await this.verifyInstalledResources(existing, currentMcp);
      const moves = this.resourceDestinations(existing).map((destination) => ({
        destination,
        backup: `${destination}.remove-${randomUUID()}`,
      }));
      const nextMcp = currentMcp.filter(
        (config) =>
          !existing.mcpServers.some((server) => server.id === config.id),
      );
      const nextStore: PluginStore = {
        version: 1,
        plugins: store.plugins.filter((plugin) => plugin.id !== existing.id),
      };
      await this.commitMoves(moves, currentMcp, nextMcp, nextStore);
      return { warnings: [] };
    });
  }

  async installedById(
    pluginIdentifier: string,
  ): Promise<InstalledCodexPlugin | undefined> {
    const plugin = (await this.loadStore()).plugins.find(
      (candidate) => candidate.id === pluginIdentifier,
    );
    return plugin ? this.installedPlugin(plugin) : undefined;
  }

  async assertHostAuthTrusted(config: McpServerConfig): Promise<void> {
    if (!config.hostAuth) return;
    const store = await this.loadStore();
    const owner = store.plugins.find((plugin) =>
      plugin.mcpServers.some((server) => server.id === config.id),
    );
    const storedServer = owner?.mcpServers.find(
      (server) => server.id === config.id,
    );
    if (
      !owner ||
      !storedServer ||
      storedServer.structuralHash !== mcpStructuralHash(config) ||
      owner.source.kind !== "git"
    ) {
      throw new Error(
        "This MCP server is not owned by a trusted signed plugin.",
      );
    }
    const installedFiles = await collectFiles(
      join(this.options.pluginsRoot, owner.id),
      {
        maximumFiles: MAX_PLUGIN_FILES,
        maximumFileBytes: MAX_PLUGIN_FILE_BYTES,
        maximumBytes: MAX_PLUGIN_BYTES,
      },
    );
    if (collectedHash(installedFiles) !== owner.contentHash) {
      throw new Error(
        "Installed plugin contents changed. Reinstall it before authorizing Google.",
      );
    }
    const url = normalizeMarketplaceUrl(owner.source.marketplaceUrl);
    const source = (await this.loadMarketplaceStore()).sources.find(
      (candidate) => candidate.url === url,
    );
    if (!source?.signingKeyFingerprint) {
      throw new Error(
        "The plugin marketplace is not trusted for host credentials.",
      );
    }
    const cache = this.marketplaceCache(url);
    const integrity = await verifyMarketplaceIntegrity(
      cache,
      await this.marketplaceFile(cache),
    );
    if (
      integrity?.signingKeyFingerprint !== source.signingKeyFingerprint ||
      integrity.pluginHashes.get(owner.source.pluginName) !== owner.contentHash
    ) {
      throw new Error(
        "The plugin signature or content digest no longer matches.",
      );
    }
  }

  private async exclusive<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.operation;
    let release!: () => void;
    this.operation = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }

  private async loadGitMarketplaceCore(
    inputUrl: string,
    onProgress?: ProgressReporter,
    refresh = false,
    expectedMarketplaceName?: string,
    strict = false,
    expectedSigningKeyFingerprint?: string,
  ): Promise<CodexPluginMarketplace> {
    const url = normalizeMarketplaceUrl(inputUrl);
    await mkdir(this.options.marketplacesRoot, { recursive: true });
    const cache = this.marketplaceCache(url);
    if (!refresh && (await exists(cache))) {
      onProgress?.(100);
      return this.readMarketplace(cache, url, {
        ...(expectedSigningKeyFingerprint
          ? { expectedSigningKeyFingerprint }
          : {}),
      });
    }
    const marketplace = await this.refreshMarketplace(
      url,
      onProgress,
      expectedMarketplaceName,
      strict,
      expectedSigningKeyFingerprint,
    );
    onProgress?.(100);
    return marketplace;
  }

  private async marketplaceSnapshot(
    sourceId?: string,
  ): Promise<CodexPluginMarketplaceState> {
    const store = await this.loadMarketplaceStore();
    const sources = this.marketplaceSources(store);
    if (
      sourceId &&
      sourceId !== LOCAL_MARKETPLACE_ID &&
      !sources.some((source) => source.id === sourceId)
    ) {
      throw new Error("Plugin marketplace was not found.");
    }
    const sourcesToLoad = sourceId
      ? sources.filter((source) => source.id === sourceId)
      : sources;
    const marketplaces: CodexPluginMarketplaceState["marketplaces"] = [];
    const errors: CodexPluginMarketplaceState["errors"] = [];
    for (const source of sourcesToLoad) {
      if (source.builtIn) continue;
      let errorMessage = this.marketplaceRefreshErrors.get(source.id);
      const cache = this.marketplaceCache(source.url);
      if (!(await exists(cache))) {
        errors.push({
          sourceId: source.id,
          message:
            errorMessage ??
            "Marketplace cache unavailable. Refresh it manually to load plugins.",
        });
        continue;
      }
      try {
        const marketplace = await this.readMarketplace(cache, source.url, {
          strict: source.offline || this.isStrictGithubMarketplace(source.url),
          ...(source.signingKeyFingerprint
            ? {
                expectedSigningKeyFingerprint: source.signingKeyFingerprint,
              }
            : {}),
        });
        if (
          !source.builtIn &&
          marketplace.marketplaceName !== source.marketplaceName
        ) {
          throw new Error(
            "Plugin marketplace identity changed. Remove and add it again.",
          );
        }
        marketplaces.push({ sourceId: source.id, marketplace });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        errorMessage = `Marketplace cache unavailable. Refresh it manually. ${detail}`;
      }
      if (errorMessage) {
        errors.push({ sourceId: source.id, message: errorMessage });
      }
    }
    return {
      selectedView: store.selectedView,
      sources,
      marketplaces,
      errors,
    };
  }

  private marketplaceSources(
    store: MarketplaceStore,
  ): CodexPluginMarketplaceSource[] {
    return [
      {
        id: BUNDLED_MARKETPLACE_ID,
        url: BUNDLED_MARKETPLACE_URL,
        marketplaceName: BUNDLED_ARTIFACT_MARKETPLACE_NAME,
        displayName: "Bundled plugins",
        repository: "Artemis",
        builtIn: true,
        removable: false,
        offline: false,
        refreshable: false,
        order: 0,
      },
      ...store.sources.map((source, index) => ({
        ...source,
        repository: githubMarketplaceRepository(source.url),
        builtIn: false,
        removable: true,
        offline: source.mode === "offline",
        refreshable: source.mode !== "offline",
        order: index + 1,
      })),
    ];
  }

  private async loadMarketplaceStore(): Promise<MarketplaceStore> {
    if (this.marketplaceState) return this.marketplaceState;
    try {
      const input = record(
        await readJson(this.options.marketplaceStatePath, 1024 * 1024),
      );
      if (
        input?.version !== 1 ||
        !Array.isArray(input.sources) ||
        input.sources.length > MAX_USER_MARKETPLACES
      ) {
        throw new Error("Plugin marketplace store is invalid.");
      }
      const sources = input.sources.map(validateStoredMarketplaceSource);
      if (new Set(sources.map((source) => source.id)).size !== sources.length) {
        throw new Error("Plugin marketplace store contains duplicates.");
      }
      const selectedInput = text(input.selectedView);
      const selectedView =
        selectedInput === BUNDLED_MARKETPLACE_ID ||
        selectedInput === LOCAL_MARKETPLACE_ID ||
        sources.some((source) => source.id === selectedInput)
          ? selectedInput!
          : BUNDLED_MARKETPLACE_ID;
      this.marketplaceState = { version: 1, selectedView, sources };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const sources: StoredMarketplaceSource[] = [];
      const seen = new Set<string>();
      for (const plugin of (await this.loadStore()).plugins) {
        if (
          plugin.source.kind !== "git" ||
          sources.length >= MAX_USER_MARKETPLACES
        ) {
          continue;
        }
        try {
          const legacyUrl = normalizeMarketplaceUrl(
            plugin.source.marketplaceUrl,
          );
          const url = normalizeGithubMarketplaceUrl(
            plugin.source.marketplaceUrl,
          );
          if (url === OPENAI_MARKETPLACE_URL || seen.has(url)) continue;
          seen.add(url);
          let displayName = plugin.source.marketplaceName;
          const cache = this.marketplaceCache(url);
          const legacyCache = this.legacyMarketplaceCache(legacyUrl);
          if (
            legacyCache !== cache &&
            (await exists(legacyCache)) &&
            !(await exists(cache))
          ) {
            await rename(legacyCache, cache);
          }
          if (await exists(cache)) {
            try {
              const cached = await this.readMarketplace(cache, url);
              if (cached.marketplaceName === plugin.source.marketplaceName) {
                displayName = cached.name;
              }
            } catch {
              // Keep the persisted marketplace identity when its cache is stale.
            }
          }
          sources.push({
            id: marketplaceSourceId(url),
            url,
            marketplaceName: plugin.source.marketplaceName,
            displayName,
            addedAt: plugin.installedAt,
            mode: "git",
            cachePath: cache,
          });
        } catch {
          // Legacy non-GitHub sources remain installed but are not subscribed.
        }
      }
      this.marketplaceState = {
        version: 1,
        selectedView: BUNDLED_MARKETPLACE_ID,
        sources,
      };
      await this.saveMarketplaceStore(this.marketplaceState);
    }
    return this.marketplaceState;
  }

  private async saveMarketplaceStore(value: MarketplaceStore): Promise<void> {
    await mkdir(dirname(this.options.marketplaceStatePath), {
      recursive: true,
    });
    const temporaryPath = `${this.options.marketplaceStatePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, undefined, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.options.marketplaceStatePath);
    this.marketplaceState = value;
  }

  private marketplaceCache(url: string): string {
    let identity = url;
    try {
      identity = normalizeGithubMarketplaceUrl(url);
    } catch {
      // Existing non-GitHub installation records retain their legacy cache key.
    }
    return this.legacyMarketplaceCache(identity);
  }

  private legacyMarketplaceCache(url: string): string {
    const digest = createHash("sha256").update(url).digest("hex").slice(0, 20);
    return join(this.options.marketplacesRoot, digest);
  }

  private isStrictGithubMarketplace(url: string): boolean {
    try {
      return normalizeGithubMarketplaceUrl(url) !== OPENAI_MARKETPLACE_URL;
    } catch {
      return false;
    }
  }

  private async bundledArtifactMarketplaceLocation(): Promise<
    string | undefined
  > {
    const configuredRoot = this.options.bundledArtifactRoot;
    if (!configuredRoot || !(await exists(configuredRoot))) return undefined;
    const marketplaceRoot = await canonicalDirectory(configuredRoot);
    const marketplace = record(
      await readJson(
        await this.marketplaceFile(marketplaceRoot),
        MAX_MARKETPLACE_BYTES,
      ),
    );
    if (text(marketplace?.name) !== BUNDLED_ARTIFACT_MARKETPLACE_NAME) {
      return undefined;
    }
    return marketplaceRoot;
  }

  private async refreshMarketplace(
    url: string,
    onProgress?: ProgressReporter,
    expectedMarketplaceName?: string,
    strict = false,
    expectedSigningKeyFingerprint?: string,
  ): Promise<CodexPluginMarketplace> {
    const normalized = normalizeMarketplaceUrl(url);
    await mkdir(this.options.marketplacesRoot, { recursive: true });
    const cache = this.marketplaceCache(normalized);
    const stage = join(this.options.marketplacesRoot, `.clone-${randomUUID()}`);
    const backup = `${cache}.backup-${randomUUID()}`;
    let movedOld = false;
    onProgress?.(5);
    try {
      await this.cloneRepository(normalized, stage);
      onProgress?.(45);
      const candidate = await this.readMarketplace(stage, normalized, {
        strict,
        validatePluginFiles: strict,
        ...(expectedSigningKeyFingerprint
          ? { expectedSigningKeyFingerprint }
          : {}),
      });
      if (
        expectedMarketplaceName &&
        candidate.marketplaceName !== expectedMarketplaceName
      ) {
        throw new Error(
          "Plugin marketplace identity changed. Remove and add it again.",
        );
      }
      if (await exists(cache)) {
        await rename(cache, backup);
        movedOld = true;
      }
      await rename(stage, cache);
      if (movedOld) {
        await rm(backup, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
      return candidate;
    } catch (error) {
      await rm(stage, { recursive: true, force: true });
      if (movedOld && !(await exists(cache)) && (await exists(backup))) {
        await rename(backup, cache);
      }
      throw marketplaceDownloadFailure(error);
    }
  }

  private async marketplaceFile(root: string): Promise<string> {
    for (const path of [
      join(root, ".agents", "plugins", "marketplace.json"),
      join(root, ".claude-plugin", "marketplace.json"),
      join(root, "marketplace.json"),
    ]) {
      if (await exists(path)) return path;
    }
    throw new Error(
      "Git repository does not contain .agents/plugins/marketplace.json.",
    );
  }

  private async readOfflineMarketplaceCandidate(
    root: string,
  ): Promise<OfflineMarketplaceCandidate> {
    const filePath = await this.marketplaceFile(root);
    const integrity = await verifyMarketplaceIntegrity(root, filePath);
    if (!integrity?.sourceUrl) {
      throw new Error(
        "Offline marketplace package must be signed and declare its GitHub source URL.",
      );
    }
    await validateOfflineMarketplacePackage(root, integrity);
    const marketplace = await this.readMarketplace(root, integrity.sourceUrl, {
      strict: true,
      validatePluginFiles: true,
      expectedSigningKeyFingerprint: integrity.signingKeyFingerprint,
    });
    return {
      marketplace,
      integrity: { ...integrity, sourceUrl: integrity.sourceUrl },
    };
  }

  private async readMarketplace(
    root: string,
    url: string,
    options?: {
      allowedPlugins?: ReadonlySet<string>;
      displayName?: string;
      bundledSources?: boolean;
      strict?: boolean;
      validatePluginFiles?: boolean;
      expectedSigningKeyFingerprint?: string;
    },
  ): Promise<CodexPluginMarketplace> {
    await this.loadStore();
    const filePath = await this.marketplaceFile(root);
    const integrity = await verifyMarketplaceIntegrity(root, filePath);
    if (
      options?.expectedSigningKeyFingerprint &&
      integrity?.signingKeyFingerprint !== options.expectedSigningKeyFingerprint
    ) {
      throw new Error(
        "Marketplace signing key changed or the signature was removed. Remove the source and explicitly trust it again.",
      );
    }
    const input = record(await readJson(filePath, MAX_MARKETPLACE_BYTES));
    const marketplaceName = text(input?.name);
    if (
      !marketplaceName ||
      marketplaceName.length > 120 ||
      !/^[a-z0-9][a-z0-9._-]{0,119}$/u.test(marketplaceName)
    ) {
      throw new Error("Git marketplace name is missing or invalid.");
    }
    const displayName =
      text(record(input?.interface)?.displayName) ?? marketplaceName;
    if (displayName.length > 120) {
      throw new Error("Git marketplace display name is too large.");
    }
    const entries = input?.plugins;
    if (!Array.isArray(entries) || entries.length > MAX_MARKETPLACE_PLUGINS) {
      throw new Error("Git marketplace plugin list is invalid or too large.");
    }
    const warnings: string[] = [];
    const plugins: CodexPluginPreview[] = [];
    const entryNames = new Set<string>();
    for (const entryValue of entries) {
      const entry = record(entryValue);
      const entryName = text(entry?.name);
      if (
        !entryName ||
        entryName.length > 120 ||
        !/^[a-z0-9][a-z0-9._-]{0,119}$/u.test(entryName)
      ) {
        if (options?.strict) {
          throw new Error("Marketplace contains an invalid plugin name.");
        }
        warnings.push("A marketplace entry with an invalid name was skipped.");
        continue;
      }
      if (entryNames.has(entryName)) {
        if (options?.strict) {
          throw new Error(
            `Marketplace contains duplicate plugin: ${entryName}`,
          );
        }
        warnings.push(`${entryName} is duplicated and was skipped.`);
        continue;
      }
      entryNames.add(entryName);
      if (options?.allowedPlugins && !options.allowedPlugins.has(entryName)) {
        continue;
      }
      const policy = record(entry?.policy);
      if (text(policy?.installation) === "NOT_AVAILABLE") {
        continue;
      }
      const products = strings(policy?.products);
      if (products.length && !products.includes("CODEX")) {
        continue;
      }
      const sourceValue = entry?.source;
      const source = record(sourceValue);
      const sourcePath =
        typeof sourceValue === "string"
          ? text(sourceValue)
          : source?.source === "local"
            ? text(source.path)
            : undefined;
      if (!sourcePath) {
        if (entryName) {
          if (options?.strict) {
            throw new Error(
              `${entryName} must use a plugin directory inside the marketplace repository.`,
            );
          }
          warnings.push(
            `${entryName} uses a non-local marketplace source and was skipped.`,
          );
        }
        continue;
      }
      try {
        const pluginPath = declaredPath(root, sourcePath, "Marketplace plugin");
        const canonical = await canonicalDirectory(pluginPath, root);
        const pluginSource: CodexPluginSource = options?.bundledSources
          ? { kind: "bundled", pluginName: entryName }
          : {
              kind: "git",
              marketplaceUrl: url,
              marketplaceName,
              pluginName: entryName,
            };
        const preview = this.preview(
          await this.parsePlugin(
            canonical,
            pluginSource,
            options?.validatePluginFiles ?? false,
          ),
        );
        if (!preview.installable) {
          if (options?.strict) {
            throw new Error(
              `${entryName} must contain an installable Skill, MCP server, or Connector URL.`,
            );
          }
          continue;
        }
        const entryCategory = text(entry?.category);
        plugins.push({
          ...preview,
          ...(entryCategory && entryCategory.length <= 80
            ? { category: entryCategory }
            : {}),
        });
      } catch (error) {
        if (options?.strict) throw error;
        warnings.push(
          `${entryName} was skipped: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (options?.strict && plugins.length === 0) {
      throw new Error("Marketplace contains no installable plugins.");
    }
    return {
      name: options?.displayName ?? displayName,
      marketplaceName,
      url,
      plugins: plugins.sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      ),
      warnings,
    };
  }

  private async resolveSource(
    source: CodexPluginSource,
    requireFreshLocal: boolean,
  ): Promise<ParsedPlugin> {
    if (source.kind === "local") {
      if (requireFreshLocal && !(await exists(source.path))) {
        throw new Error(
          "The original local plugin source is no longer available.",
        );
      }
      const root = await canonicalDirectory(source.path);
      return this.parsePlugin(root, { kind: "local", path: root }, true);
    }
    if (source.kind === "bundled" || source.kind === "runtime") {
      const marketplaceRoot = await this.bundledArtifactMarketplaceLocation();
      if (!marketplaceRoot) {
        throw new Error(
          "The bundled Lite artifact plugins are no longer available.",
        );
      }
      const root = await this.marketplacePluginRoot(
        marketplaceRoot,
        BUNDLED_ARTIFACT_MARKETPLACE_NAME,
        source.pluginName,
      );
      return this.parsePlugin(
        root,
        { kind: "bundled", pluginName: source.pluginName },
        true,
      );
    }
    const cache = this.marketplaceCache(source.marketplaceUrl);
    if (!(await exists(cache))) {
      throw new Error(
        "Marketplace cache unavailable. Refresh the Git marketplace or re-import the offline package before installing.",
      );
    }
    const root = await this.marketplacePluginRoot(
      cache,
      source.marketplaceName,
      source.pluginName,
    );
    return this.parsePlugin(root, source, true);
  }

  private async marketplacePluginRoot(
    marketplaceRoot: string,
    expectedMarketplaceName: string,
    pluginName: string,
  ): Promise<string> {
    const filePath = await this.marketplaceFile(marketplaceRoot);
    const marketplace = record(await readJson(filePath, MAX_MARKETPLACE_BYTES));
    if (text(marketplace?.name) !== expectedMarketplaceName) {
      throw new Error("Plugin marketplace identity changed.");
    }
    const entry = Array.isArray(marketplace?.plugins)
      ? marketplace.plugins
          .map(record)
          .find((candidate) => text(candidate?.name) === pluginName)
      : undefined;
    const policy = record(entry?.policy);
    const products = strings(policy?.products);
    if (
      !entry ||
      text(policy?.installation) === "NOT_AVAILABLE" ||
      (products.length > 0 && !products.includes("CODEX"))
    ) {
      throw new Error("Marketplace plugin is no longer available.");
    }
    const entrySourceValue = entry.source;
    const entrySource = record(entrySourceValue);
    const sourcePath =
      typeof entrySourceValue === "string"
        ? text(entrySourceValue)
        : entrySource?.source === "local"
          ? text(entrySource.path)
          : undefined;
    if (!sourcePath) {
      throw new Error("Marketplace plugin is unavailable or unsupported.");
    }
    return canonicalDirectory(
      declaredPath(marketplaceRoot, sourcePath, "Marketplace plugin"),
      marketplaceRoot,
    );
  }

  private async parsePlugin(
    root: string,
    source: CodexPluginSource,
    prepare: boolean,
  ): Promise<ParsedPlugin> {
    const manifestPath = join(root, ".codex-plugin", "plugin.json");
    const manifest = record(await readJson(manifestPath, MAX_MANIFEST_BYTES));
    if (!manifest) {
      throw new Error("Plugin manifest must be a JSON object.");
    }
    const name = text(manifest.name);
    if (!name || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(name)) {
      throw new Error("Plugin manifest name is invalid.");
    }
    const interfaceValue = record(manifest?.interface);
    const displayName =
      text(interfaceValue?.displayName) ??
      text(interfaceValue?.display_name) ??
      name;
    const version = text(manifest?.version) ?? "0.0.0";
    const description = text(manifest?.description) ?? "";
    const shortDescription =
      text(interfaceValue?.shortDescription) ??
      text(interfaceValue?.short_description);
    const category = text(interfaceValue?.category);
    const brandColorInput = text(interfaceValue?.brandColor);
    const brandColor =
      brandColorInput && /^#[a-f0-9]{6}$/iu.test(brandColorInput)
        ? brandColorInput
        : undefined;
    if (
      displayName.length > 120 ||
      version.length > 64 ||
      description.length > 2_000 ||
      (shortDescription !== undefined && shortDescription.length > 300) ||
      (category !== undefined && category.length > 80)
    ) {
      throw new Error("Plugin manifest metadata is too large.");
    }
    const warnings: string[] = [];
    if (!manifest?.version)
      warnings.push("Plugin manifest has no version; 0.0.0 was used.");
    const unsupported: string[] = [];
    const connectorDeclaration = manifest?.connectors ?? manifest?.apps;
    const apps = await parsePluginConnectors(root, connectorDeclaration);
    const iconDataUrl = await readPluginIcon(
      root,
      interfaceValue?.logo ?? interfaceValue?.composerIcon,
    );
    if (
      manifest?.hooks !== undefined ||
      (await exists(join(root, "hooks", "hooks.json"))) ||
      (await exists(join(root, "hooks.json")))
    ) {
      unsupported.push("Hooks");
    }
    for (const [field, label] of [
      ["commands", "Commands"],
      ["agents", "Agents"],
      ["browserExtensions", "Browser extensions"],
      ["scheduledTasks", "Scheduled task templates"],
    ] as const) {
      if (manifest?.[field] !== undefined) unsupported.push(label);
    }

    const skillDeclarations = manifestPaths(manifest?.skills);
    if (!skillDeclarations.length && (await exists(join(root, "skills")))) {
      skillDeclarations.push("./skills/");
    }
    const skills: ParsedSkill[] = [];
    const skillNames = new Set<string>();
    for (const declaration of skillDeclarations) {
      const path = declaredPath(root, declaration, "Skill");
      const directory = await canonicalDirectory(path, root);
      for (const skillRoot of await discoverSkillRoots(directory)) {
        const frontmatter = parseSkillFrontmatter(
          await readPluginText(
            join(skillRoot, "SKILL.md"),
            MAX_SKILL_FILE_BYTES,
          ),
        );
        if (skillNames.has(frontmatter.name)) {
          throw new Error(
            `Plugin contains duplicate Skill: ${frontmatter.name}`,
          );
        }
        skillNames.add(frontmatter.name);
        if (prepare) {
          const files = await collectFiles(skillRoot, {
            maximumFiles: MAX_SKILL_FILES,
            maximumFileBytes: MAX_SKILL_FILE_BYTES,
            maximumBytes: MAX_SKILL_BYTES,
            rejectInstallerMetadata: true,
          });
          skills.push({
            ...frontmatter,
            root: skillRoot,
            files,
            hash: collectedHash(files),
          });
        } else {
          skills.push({ ...frontmatter, root: skillRoot });
        }
      }
    }

    const mcpInputs: unknown[] = [];
    if (
      typeof manifest.mcpServers === "string" ||
      Array.isArray(manifest.mcpServers)
    ) {
      for (const declaration of manifestPaths(manifest.mcpServers)) {
        const path = declaredPath(root, declaration, "MCP");
        mcpInputs.push(await readJson(path, MAX_MANIFEST_BYTES));
      }
    } else if (record(manifest?.mcpServers)) {
      mcpInputs.push(manifest.mcpServers);
    }
    const mcpServers: ParsedMcpServer[] = [];
    const mcpNames = new Set<string>();
    for (const input of mcpInputs) {
      for (const [serverName, definition] of Object.entries(
        mcpServerMap(input),
      )) {
        if (mcpNames.has(serverName)) {
          throw new Error(
            `Plugin contains duplicate MCP server: ${serverName}`,
          );
        }
        mcpNames.add(serverName);
        mcpServers.push(parseMcpServer(serverName, definition, warnings));
      }
    }
    if (unavailableConnectorNames(apps, mcpServers).length) {
      unsupported.push("Unavailable Connectors");
    }
    const files = prepare
      ? await collectFiles(root, {
          maximumFiles: MAX_PLUGIN_FILES,
          maximumFileBytes: MAX_PLUGIN_FILE_BYTES,
          maximumBytes: MAX_PLUGIN_BYTES,
        })
      : undefined;
    return {
      root,
      id: pluginId(name, source),
      name,
      displayName,
      version,
      description,
      ...(shortDescription ? { shortDescription } : {}),
      ...(category ? { category } : {}),
      ...(brandColor ? { brandColor } : {}),
      ...(iconDataUrl ? { iconDataUrl } : {}),
      source,
      skills,
      mcpServers,
      apps,
      unsupported,
      warnings,
      ...(files ? { files, contentHash: collectedHash(files) } : {}),
    };
  }

  private preview(parsed: ParsedPlugin): CodexPluginPreview {
    const installed = Boolean(
      this.state?.plugins.some((plugin) => plugin.id === parsed.id),
    );
    return {
      id: parsed.id,
      name: parsed.name,
      displayName: parsed.displayName,
      version: parsed.version,
      description: parsed.description,
      ...(parsed.shortDescription
        ? { shortDescription: parsed.shortDescription }
        : {}),
      ...(parsed.category ? { category: parsed.category } : {}),
      ...(parsed.brandColor ? { brandColor: parsed.brandColor } : {}),
      ...(parsed.iconDataUrl ? { iconDataUrl: parsed.iconDataUrl } : {}),
      source: structuredClone(parsed.source),
      installed,
      installable:
        blockingUnavailableConnectorNames(
          parsed.source,
          parsed.apps,
          parsed.mcpServers,
        ).length === 0 &&
        (parsed.skills.length > 0 ||
          parsed.mcpServers.some((server) => server.importable) ||
          parsed.apps.some((connector) => connector.url)),
      skills: parsed.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
      })),
      mcpServers: parsed.mcpServers.map(previewMcp),
      apps: structuredClone(parsed.apps),
      unsupported: [...parsed.unsupported],
      warnings: [...parsed.warnings],
    };
  }

  private assertSupportedAppConnectors(parsed: ParsedPlugin): void {
    const requiredApps = blockingUnavailableConnectorNames(
      parsed.source,
      parsed.apps,
      parsed.mcpServers,
    );
    if (!requiredApps.length) return;
    throw new Error(
      `Plugin requires a Connector endpoint that is unavailable: ${requiredApps.join(", ")}.`,
    );
  }

  private installedPlugin(plugin: StoredPlugin): InstalledCodexPlugin {
    return {
      id: plugin.id,
      name: plugin.name,
      displayName: plugin.displayName,
      version: plugin.version,
      description: plugin.description,
      ...(plugin.shortDescription
        ? { shortDescription: plugin.shortDescription }
        : {}),
      ...(plugin.category ? { category: plugin.category } : {}),
      ...(plugin.brandColor ? { brandColor: plugin.brandColor } : {}),
      ...(plugin.iconDataUrl ? { iconDataUrl: plugin.iconDataUrl } : {}),
      source: structuredClone(plugin.source),
      installed: true,
      installable:
        blockingUnavailableConnectorNames(
          plugin.source,
          plugin.appPreviews,
          plugin.mcpPreviews,
        ).length === 0,
      skills: structuredClone(plugin.skillPreviews),
      mcpServers: structuredClone(plugin.mcpPreviews),
      apps: structuredClone(plugin.appPreviews),
      unsupported: [...plugin.unsupported],
      warnings: [...plugin.warnings],
      contentHash: plugin.contentHash,
      installedAt: plugin.installedAt,
      updatedAt: plugin.updatedAt,
      skillNames: plugin.skills.map((skill) => skill.name),
      mcpServerIds: plugin.mcpServers.map((server) => server.id),
    };
  }

  private async buildMcpConfigs(
    parsed: ParsedPlugin,
    pluginDirectory: string,
  ): Promise<McpServerConfig[]> {
    const hostAuthTrusted = await this.hostAuthTrusted(parsed);
    const mcpServers = parsed.mcpServers.flatMap((server) => {
      if (!server.importable || server.transport === "unsupported") return [];
      if (server.hostAuth && !hostAuthTrusted) return [];
      const id = mcpConfigId(parsed.id, server.name);
      if (server.transport === "stdio") {
        const usesArtemisNode = server.command === "${ARTEMIS_NODE}";
        const command = usesArtemisNode
          ? process.execPath
          : pluginRootSubstitution(server.command!, pluginDirectory);
        const args = (server.args ?? []).map((argument) =>
          pluginRootSubstitution(argument, pluginDirectory),
        );
        return [
          validateMcpServerConfig({
            id,
            name: `${parsed.displayName}: ${server.name}`.slice(0, 100),
            transport: "stdio",
            enabled: false,
            command,
            args,
            env: usesArtemisNode ? { ELECTRON_RUN_AS_NODE: "1" } : {},
            envVars: server.envVars ?? [],
            workspacePath: join(this.options.mcpWorkspaceRoot, id),
            allowNetwork: true,
            ...(server.hostAuth ? { hostAuth: server.hostAuth } : {}),
          }),
        ];
      }
      return [
        validateMcpServerConfig({
          id,
          name: `${parsed.displayName}: ${server.name}`.slice(0, 100),
          transport: "streamable-http",
          enabled: false,
          url: server.url!,
          auth: server.auth ?? "none",
        }),
      ];
    });
    const connectors = parsed.apps.flatMap((connector) => {
      if (!connector.url) return [];
      const id = mcpConfigId(parsed.id, `connector:${connector.name}`);
      const connectorId = safeSlug(
        connector.connectorId ?? connector.name,
        "connector",
      ).slice(0, 120);
      return [
        validateMcpServerConfig({
          id,
          name: `${parsed.displayName}: ${connector.name}`.slice(0, 100),
          transport: "streamable-http",
          enabled: false,
          url: connector.url,
          auth: connector.auth ?? "oauth",
          resourceKind: "connector",
          connectorId,
        }),
      ];
    });
    return [...mcpServers, ...connectors];
  }

  private async hostAuthTrusted(parsed: ParsedPlugin): Promise<boolean> {
    if (!parsed.mcpServers.some((server) => server.hostAuth)) return true;
    if (parsed.source.kind !== "git" || !parsed.contentHash) return false;
    const url = normalizeMarketplaceUrl(parsed.source.marketplaceUrl);
    const source = (await this.loadMarketplaceStore()).sources.find(
      (candidate) => candidate.url === url,
    );
    if (!source?.signingKeyFingerprint) return false;
    const cache = this.marketplaceCache(url);
    const integrity = await verifyMarketplaceIntegrity(
      cache,
      await this.marketplaceFile(cache),
    );
    return (
      integrity?.signingKeyFingerprint === source.signingKeyFingerprint &&
      integrity.pluginHashes.get(parsed.source.pluginName) ===
        parsed.contentHash
    );
  }

  private mergeMcpUserSettings(
    next: McpServerConfig,
    current: McpServerConfig | undefined,
  ): McpServerConfig {
    if (!current || current.transport !== next.transport) return next;
    if (next.transport === "stdio" && current.transport === "stdio") {
      const scopesExpanded = Boolean(
        next.hostAuth &&
        (!current.hostAuth ||
          next.hostAuth.grant !== current.hostAuth.grant ||
          next.hostAuth.scopes.some(
            (scope) => !current.hostAuth?.scopes.includes(scope),
          )),
      );
      return {
        ...next,
        enabled: scopesExpanded ? false : current.enabled,
        env: structuredClone(next.hostAuth ? next.env : current.env),
        envVars: [...(next.hostAuth ? next.envVars : current.envVars)],
      };
    }
    if (
      next.transport === "streamable-http" &&
      current.transport === "streamable-http"
    ) {
      if (current.url !== next.url) return next;
      const auth = current.auth ?? next.auth;
      return {
        ...next,
        enabled: current.enabled,
        ...(auth ? { auth } : {}),
        ...(current.credentialProviderId
          ? { credentialProviderId: current.credentialProviderId }
          : {}),
      };
    }
    return next;
  }

  private async preparePlugin(parsed: ParsedPlugin): Promise<PreparedPlugin> {
    if (!parsed.files || !parsed.contentHash) {
      throw new Error("Plugin was not fully prepared for installation.");
    }
    const pluginDirectory = join(this.options.pluginsRoot, parsed.id);
    const skills = parsed.skills.map((skill) => {
      if (!skill.hash || !skill.files) {
        throw new Error(`Plugin Skill was not prepared: ${skill.name}`);
      }
      return { ...skill, hash: skill.hash, files: skill.files };
    });
    return {
      parsed,
      pluginDirectory,
      skills,
      mcpConfigs: await this.buildMcpConfigs(parsed, pluginDirectory),
    };
  }

  private async commitInstall(
    parsed: ParsedPlugin,
    existing: StoredPlugin | undefined,
    onProgress?: ProgressReporter,
  ): Promise<{ plugin: InstalledCodexPlugin; warnings: string[] }> {
    const prepared = await this.preparePlugin(parsed);
    const store = await this.loadStore();
    const currentMcp = await this.options.mcpStore.list();
    if (existing) await this.verifyInstalledResources(existing, currentMcp);
    onProgress?.(55);

    const oldSkillNames = new Set(
      existing?.skills.map((skill) => skill.name) ?? [],
    );
    for (const skill of prepared.skills) {
      const destination = join(this.options.skillsRoot, skill.name);
      const destinationExists = await exists(destination);
      const matchingBundledSkill =
        destinationExists &&
        !existing &&
        parsed.source.kind === "bundled" &&
        parsed.source.pluginName === skill.name &&
        (await installedSkillMatchesHash(destination, skill.hash));
      if (
        destinationExists &&
        !oldSkillNames.has(skill.name) &&
        !matchingBundledSkill
      ) {
        const owner = store.plugins.find(
          (plugin) =>
            plugin.id !== existing?.id &&
            plugin.skills.some((candidate) => candidate.name === skill.name),
        );
        throw new Error(
          owner
            ? `Skill "${skill.name}" is already installed by "${owner.displayName}".`
            : `Skill "${skill.name}" is already installed by another source.`,
        );
      }
    }
    if ((await exists(prepared.pluginDirectory)) && !existing) {
      throw new Error("Managed plugin destination already exists.");
    }

    const oldMcpIds = new Set(
      existing?.mcpServers.map((server) => server.id) ?? [],
    );
    for (const config of prepared.mcpConfigs) {
      if (
        currentMcp.some((current) => current.id === config.id) &&
        !oldMcpIds.has(config.id)
      ) {
        throw new Error(`MCP server ID is already installed: ${config.id}`);
      }
    }
    const currentById = new Map(
      currentMcp.map((config) => [config.id, config]),
    );
    const mergedMcp = prepared.mcpConfigs.map((config) =>
      this.mergeMcpUserSettings(config, currentById.get(config.id)),
    );
    const nextMcp = [
      ...currentMcp.filter((config) => !oldMcpIds.has(config.id)),
      ...mergedMcp,
    ];

    await mkdir(this.options.pluginsRoot, { recursive: true });
    await mkdir(this.options.skillsRoot, { recursive: true });
    const pluginStage = join(
      this.options.pluginsRoot,
      `.install-${randomUUID()}`,
    );
    await copyCollectedFiles(pluginStage, parsed.files!);
    const skillStages = new Map<string, string>();
    try {
      for (const skill of prepared.skills) {
        const stage = join(this.options.skillsRoot, `.install-${randomUUID()}`);
        await copyCollectedFiles(stage, skill.files);
        await writeFile(
          join(stage, SKILL_METADATA_FILE),
          `${JSON.stringify(
            {
              version: 1,
              id: `codex-plugin/${parsed.id}/${skill.name}`,
              source: `codex-plugin:${parsed.name}`,
              installedAt: new Date().toISOString(),
            },
            undefined,
            2,
          )}\n`,
          { encoding: "utf8", mode: 0o600 },
        );
        skillStages.set(skill.name, stage);
      }
    } catch (error) {
      await rm(pluginStage, { recursive: true, force: true });
      await Promise.all(
        [...skillStages.values()].map((stage) =>
          rm(stage, { recursive: true, force: true }),
        ),
      );
      throw error;
    }
    onProgress?.(75);

    const skillNames = new Set([
      ...(existing?.skills.map((skill) => skill.name) ?? []),
      ...prepared.skills.map((skill) => skill.name),
    ]);
    const moves: DirectoryMove[] = [
      {
        destination: prepared.pluginDirectory,
        backup: `${prepared.pluginDirectory}.backup-${randomUUID()}`,
        stage: pluginStage,
      },
      ...[...skillNames].map((name) => {
        const stage = skillStages.get(name);
        return {
          destination: join(this.options.skillsRoot, name),
          backup: join(
            this.options.skillsRoot,
            `.backup-${safeSlug(name)}-${randomUUID()}`,
          ),
          ...(stage ? { stage } : {}),
        };
      }),
    ];
    const now = new Date().toISOString();
    const stored: StoredPlugin = {
      id: parsed.id,
      name: parsed.name,
      displayName: parsed.displayName,
      version: parsed.version,
      description: parsed.description,
      ...(parsed.shortDescription
        ? { shortDescription: parsed.shortDescription }
        : {}),
      ...(parsed.category ? { category: parsed.category } : {}),
      ...(parsed.brandColor ? { brandColor: parsed.brandColor } : {}),
      ...(parsed.iconDataUrl ? { iconDataUrl: parsed.iconDataUrl } : {}),
      source: structuredClone(parsed.source),
      contentHash: parsed.contentHash!,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
      skills: prepared.skills.map((skill) => ({
        name: skill.name,
        hash: skill.hash,
      })),
      mcpServers: mergedMcp.map((config) => ({
        id: config.id,
        structuralHash: mcpStructuralHash(config),
      })),
      skillPreviews: prepared.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
      })),
      mcpPreviews: parsed.mcpServers.map(previewMcp),
      appPreviews: structuredClone(parsed.apps),
      unsupported: [...parsed.unsupported],
      warnings: [...parsed.warnings],
    };
    const nextStore: PluginStore = {
      version: 1,
      plugins: [
        ...store.plugins.filter((plugin) => plugin.id !== parsed.id),
        stored,
      ],
    };
    await this.commitMoves(moves, currentMcp, nextMcp, nextStore);
    onProgress?.(100);
    return {
      plugin: this.installedPlugin(stored),
      warnings: [...stored.warnings],
    };
  }

  private resourceDestinations(plugin: StoredPlugin): string[] {
    const pluginDirectory = join(this.options.pluginsRoot, plugin.id);
    if (!pathIsInside(this.options.pluginsRoot, pluginDirectory)) {
      throw new Error("Managed plugin path is unsafe.");
    }
    return [
      pluginDirectory,
      ...plugin.skills.map((skill) => {
        const path = join(this.options.skillsRoot, skill.name);
        if (!pathIsInside(this.options.skillsRoot, path)) {
          throw new Error("Managed plugin Skill path is unsafe.");
        }
        return path;
      }),
    ];
  }

  private async verifyInstalledResources(
    plugin: StoredPlugin,
    currentMcp: McpServerConfig[],
  ): Promise<void> {
    const pluginDirectory = join(this.options.pluginsRoot, plugin.id);
    if (!(await exists(pluginDirectory))) {
      throw new Error("Managed plugin files are missing.");
    }
    const pluginFiles = await collectFiles(pluginDirectory, {
      maximumFiles: MAX_PLUGIN_FILES,
      maximumFileBytes: MAX_PLUGIN_FILE_BYTES,
      maximumBytes: MAX_PLUGIN_BYTES,
    });
    if (collectedHash(pluginFiles) !== plugin.contentHash) {
      throw new Error(
        "Managed plugin files were modified; reinstall manually.",
      );
    }
    for (const skill of plugin.skills) {
      const skillPath = join(this.options.skillsRoot, skill.name);
      if (!(await exists(skillPath))) {
        throw new Error(`Plugin Skill is missing: ${skill.name}`);
      }
      const files = (
        await collectFiles(skillPath, {
          maximumFiles: MAX_SKILL_FILES + 1,
          maximumFileBytes: MAX_SKILL_FILE_BYTES,
          maximumBytes: MAX_SKILL_BYTES,
        })
      ).filter((file) => !isSkillInstallerMetadata(file.relativePath));
      if (collectedHash(files) !== skill.hash) {
        throw new Error(`Plugin Skill was modified: ${skill.name}`);
      }
    }
    for (const server of plugin.mcpServers) {
      const current = currentMcp.find((config) => config.id === server.id);
      if (!current)
        throw new Error(`Plugin MCP server is missing: ${server.id}`);
      if (mcpStructuralHash(current) !== server.structuralHash) {
        throw new Error(
          `Plugin MCP server was structurally modified: ${server.id}`,
        );
      }
    }
  }

  private async commitMoves(
    moves: DirectoryMove[],
    previousMcp: McpServerConfig[],
    nextMcp: McpServerConfig[],
    nextStore: PluginStore,
  ): Promise<void> {
    const movedBackups: DirectoryMove[] = [];
    const movedStages: DirectoryMove[] = [];
    let mcpSaved = false;
    try {
      for (const move of moves) {
        if (await exists(move.destination)) {
          await rename(move.destination, move.backup);
          movedBackups.push(move);
        }
      }
      for (const move of moves) {
        if (!move.stage) continue;
        await rename(move.stage, move.destination);
        movedStages.push(move);
      }
      await this.options.mcpStore.replaceAll(nextMcp);
      mcpSaved = true;
      await this.saveStore(nextStore);
    } catch (error) {
      if (mcpSaved) {
        await this.options.mcpStore
          .replaceAll(previousMcp)
          .catch(() => undefined);
      }
      for (const move of [...movedStages].reverse()) {
        await rm(move.destination, { recursive: true, force: true }).catch(
          () => undefined,
        );
      }
      for (const move of [...movedBackups].reverse()) {
        if (await exists(move.backup)) {
          await rename(move.backup, move.destination).catch(() => undefined);
        }
      }
      for (const move of moves) {
        if (move.stage) {
          await rm(move.stage, { recursive: true, force: true }).catch(
            () => undefined,
          );
        }
      }
      throw error;
    }
    await Promise.allSettled(
      movedBackups.map((move) =>
        rm(move.backup, { recursive: true, force: true }),
      ),
    );
  }

  private async loadStore(): Promise<PluginStore> {
    if (this.state) return this.state;
    try {
      const input = record(
        await readJson(this.options.statePath, 5 * 1024 * 1024),
      );
      if (input?.version !== 1 || !Array.isArray(input.plugins)) {
        throw new Error("Installed plugin store is invalid.");
      }
      this.state = {
        version: 1,
        plugins: input.plugins.map(validateStoredPlugin),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = { version: 1, plugins: [] };
    }
    return this.state;
  }

  private async saveStore(value: PluginStore): Promise<void> {
    await mkdir(dirname(this.options.statePath), { recursive: true });
    const temporaryPath = `${this.options.statePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, undefined, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.options.statePath);
    this.state = value;
  }
}
