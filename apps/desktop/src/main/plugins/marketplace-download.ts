import { createHash } from "node:crypto";
import { lstat, mkdir, open, rm } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { x as extractTar } from "tar";
import {
  type GitHubRateLimit,
  type MarketplaceFetcher,
} from "./plugin-types.js";
import {
  MAX_MARKETPLACE_ARCHIVE_BYTES,
  MAX_MARKETPLACE_ARCHIVE_ENTRIES,
  MAX_PLUGIN_FILE_BYTES,
  MAX_MARKETPLACE_ARCHIVE_UNPACKED_BYTES,
  GITHUB_API,
  MAX_GITHUB_RATE_LIMIT_RETRY_MILLISECONDS,
} from "./plugin-constants.js";
import { collectFiles, copyCollectedFiles } from "./plugin-files.js";
export function githubRetryAfterMilliseconds(
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

export function githubRateLimit(
  response: Response,
): GitHubRateLimit | undefined {
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

export function githubRateLimitError(limit: GitHubRateLimit): Error {
  const retry = limit.resetAt
    ? ` Try again after ${limit.resetAt.toLocaleString()}.`
    : " Try again after the GitHub rate-limit window resets.";
  return new Error(
    `GitHub marketplace download was rate limited because unauthenticated requests share a 60 requests/hour per-IP quota.${retry}`,
  );
}

export async function downloadResponse(
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

export async function extractMarketplaceArchive(
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

export async function defaultDownloadRepository(
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

export async function stageOfflineMarketplaceInput(
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

export function normalizeMarketplaceUrl(input: string): string {
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

export function githubMarketplaceRepository(urlInput: string): string {
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

export function normalizeGithubMarketplaceUrl(input: string): string {
  const url = normalizeMarketplaceUrl(input);
  const repository = githubMarketplaceRepository(url).toLowerCase();
  return `https://github.com/${repository}.git`;
}

export function marketplaceSourceId(url: string): string {
  return `marketplace-${createHash("sha256")
    .update(url)
    .digest("hex")
    .slice(0, 20)}`;
}

export function marketplaceDownloadFailure(error: unknown): Error {
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
