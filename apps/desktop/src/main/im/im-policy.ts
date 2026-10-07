import { imText } from "@artemis/gateway";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat, readdir } from "node:fs/promises";
import { relative, sep } from "node:path";
import {
  IM_SECURITY_VERSION,
  imPathWithinScope,
  isImProtectedPath,
  normalizeImPath,
  imScopeCanWrite,
  imScopeConfirmation,
  type AppLocale,
  type ExecutionGrant,
  type ImDataScope,
  type ImConversation,
  type RemoteOperation,
} from "@artemis/protocol";
import { checkedRemotePath } from "./im-sandbox.js";

// Darwin's O_NOFOLLOW_ANY is documented in sys/fcntl.h. Unlike O_NOFOLLOW,
// it rejects a replacement symlink at any ancestor during the open syscall.
// Other platforms conservatively require existing files for broker writes;
// creating files there needs a native relative-handle implementation.
function noFollowFlags(): number {
  return process.platform === "darwin"
    ? 0x20000000
    : (constants.O_NOFOLLOW ?? 0);
}

export function imAudience(conversation: ImConversation): string {
  if (conversation.kind === "direct") return "owner";
  if (!conversation.spaceId)
    throw new Error("Group work requires a confirmed collaboration space.");
  return `space:${conversation.spaceId}`;
}
export function requireImScope(
  grant: ExecutionGrant,
  audience: string,
  access: "read" | "write" = "read",
  locale: AppLocale = "zh-CN",
): ImDataScope {
  if (grant.security?.version !== IM_SECURITY_VERSION)
    throw new Error(imText(locale, "confirmProjectScope"));
  const scope = grant.security.scopes.find((s) => s.audience === audience);
  if (!scope) throw new Error(imText(locale, "conversationScopeUnauthorized"));
  // Enabling this project/audience grants its configured reads by default.
  // Pending execution consent must not block queries or ordinary coordination.
  if (access === "write" && !imScopeConfirmation(grant.security, scope))
    throw new Error(imText(locale, "confirmWriteCommands"));
  return scope;
}
export class ImPermissionError extends Error {
  constructor(
    readonly code: "scope-denied" | "system-denied",
    message: string,
  ) {
    super(message);
    this.name = "ImPermissionError";
  }
}
/** Ancestors expose a projection of the grant, never a filesystem listing. */
export function imProjectedDirectory(scope: ImDataScope, input: string) {
  if (!scope.readPaths.length) return undefined;
  const path = input === "." ? "" : normalizeImPath(input);
  if (path && imPathWithinScope(path, scope.readPaths)) return undefined;
  const prefix = path ? `${path}/` : "";
  const entries = new Map<string, { path: string; directory: boolean }>();
  for (const root of scope.readPaths) {
    if (!root.startsWith(prefix) || isImProtectedPath(root)) continue;
    const child = prefix + root.slice(prefix.length).split("/")[0];
    entries.set(child, {
      path: child,
      directory: child !== root || !scope.filePaths?.includes(root),
    });
  }
  return entries.size
    ? [...entries.values()].sort((a, b) => a.path.localeCompare(b.path))
    : undefined;
}

export function imRequiresApproval(
  approval: ExecutionGrant["approval"],
  operation: RemoteOperation,
): boolean {
  if (operation.action === "read" || operation.action === "participants")
    return false;
  if (
    operation.action === "collaborate" &&
    ["participants", "status", "wait", "cancel"].includes(
      operation.command.action,
    )
  )
    return false;
  return approval === "ask";
}

/** Only directory reads may address the root; never broaden file/write paths. */
export function authorizeImReadPath(
  scope: ImDataScope,
  input: string,
  locale: AppLocale = "zh-CN",
): string {
  if (input === "." || imProjectedDirectory(scope, input)) return input;
  return authorizeImPath(scope, input, undefined, locale);
}

export function authorizeImPath(
  scope: ImDataScope,
  input: string,
  write = false,
  locale: AppLocale = "zh-CN",
): string {
  const path = normalizeImPath(input);
  if (scope.filePaths?.some((root) => path.startsWith(`${root}/`)))
    throw new Error(imText(locale, "fileReplacedByDirectory"));
  if (isImProtectedPath(path)) throw new Error(imText(locale, "protectedFile"));
  // Empty readPaths grants the whole project root; empty writePaths still
  // grants no writes.
  const withinScope = write
    ? imScopeCanWrite(scope, path)
    : scope.readPaths.length === 0 || imPathWithinScope(path, scope.readPaths);
  if (!withinScope)
    throw new ImPermissionError(
      "scope-denied",
      imText(locale, "fileOutsideScope"),
    );
  return path;
}
export function imContentHash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
/** Detection is supplemental. Only scoped contexts are eligible for automatic delivery. */
export function inspectImOutbound(
  input: string,
  locale: AppLocale = "zh-CN",
): string | undefined {
  const text = input
    .normalize("NFKC")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, "");
  if (
    /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/u.test(text) ||
    /\bAuthorization\s*:\s*(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.\-]{16,}/iu.test(
      text,
    ) ||
    /\b(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{24,}|AKIA[A-Z0-9]{16})\b/u.test(
      text,
    )
  )
    return imText(locale, "credentialReview");
  if (
    /<\s*(?:img|iframe|object|embed)\b/iu.test(text) ||
    /!\[[\s\S]*?\]\s*(?:\(|\[)/u.test(text)
  )
    return imText(locale, "embeddedContentReview");
  if (
    /(?:javascript|data|file):/iu.test(
      text.match(/(?:\]\([^)]*\)|<[^>]*>)/gu)?.join(" ") ?? "",
    )
  )
    return imText(locale, "linkProtocolDenied");
  for (const raw of text.match(/https?:\/\/[^\s<>"')]+/giu) ?? []) {
    try {
      const url = new URL(raw);
      if (
        url.username ||
        url.password ||
        [...url.searchParams.keys()].some((key) =>
          /^(?:token|api[_-]?key|password|secret|authorization|credential)$/iu.test(
            key,
          ),
        )
      )
        return imText(locale, "linkSensitiveReview");
    } catch {
      return imText(locale, "linkInvalidReview");
    }
  }
  return undefined;
}

/** Inspect the opened object, not just a path checked before opening. */
export async function readImFile(
  workspace: string,
  input: string,
  scope: ImDataScope,
  limit = 10 * 1024 * 1024,
  locale: AppLocale = "zh-CN",
): Promise<Buffer> {
  const path = await checkedRemotePath(
    workspace,
    authorizeImPath(scope, input, undefined, locale),
  );
  const handle = await open(path, constants.O_RDONLY | noFollowFlags());
  try {
    const opened = await handle.stat();
    const checked = await lstat(await checkedRemotePath(workspace, input));
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.ino !== checked.ino ||
      opened.dev !== checked.dev ||
      opened.size > limit
    )
      throw new Error("File changed, is linked, or exceeds the size limit.");
    const bytes = Buffer.alloc(Math.min(limit + 1, opened.size + 1));
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        total,
        bytes.length - total,
        null,
      );
      if (!bytesRead) break;
      total += bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(await checkedRemotePath(workspace, input));
    if (
      total > limit ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      current.ino !== opened.ino ||
      current.dev !== opened.dev ||
      after.nlink !== 1
    )
      throw new Error(
        "File changed while being read. Retry after it is stable.",
      );
    return bytes.subarray(0, total);
  } finally {
    await handle.close();
  }
}

export async function imScopeEntries(workspace: string, input: string) {
  const directory = input
    ? await checkedRemotePath(workspace, normalizeImPath(input))
    : workspace;
  if (input && isImProtectedPath(input))
    throw new Error("Protected directory.");
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .slice(0, 1000)
    .map((entry) => {
      const path = relative(workspace, `${directory}${sep}${entry.name}`)
        .split(sep)
        .join("/");
      return {
        path,
        directory: entry.isDirectory(),
        protected: entry.isSymbolicLink() || isImProtectedPath(path),
      };
    })
    .sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.path.localeCompare(b.path),
    );
}

export async function writeImFile(
  workspace: string,
  input: string,
  content: string,
  scope: ImDataScope,
  assertCurrent: () => void = () => {},
  expectedHash?: string,
  locale: AppLocale = "zh-CN",
): Promise<void> {
  const path = await checkedRemotePath(
    workspace,
    authorizeImPath(scope, input, true, locale),
  );
  assertCurrent();
  await checkedRemotePath(workspace, input);
  const handle = await open(
    path,
    (expectedHash && expectedHash !== "absent"
      ? constants.O_RDWR
      : constants.O_WRONLY) |
      (expectedHash === "absent" ? constants.O_EXCL : 0) |
      (process.platform === "darwin" &&
      (!expectedHash || expectedHash === "absent")
        ? constants.O_CREAT
        : 0) |
      noFollowFlags(),
    0o600,
  );
  try {
    const opened = await handle.stat();
    const current = await lstat(await checkedRemotePath(workspace, input));
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      current.ino !== opened.ino ||
      current.dev !== opened.dev
    )
      throw new Error("File changed or is linked. Write denied.");
    if (expectedHash && expectedHash !== "absent") {
      if (
        opened.size > 10 * 1024 * 1024 ||
        imContentHash(await handle.readFile()) !== expectedHash
      )
        throw new Error(
          "File changed since it was read. Read it again and merge before writing.",
        );
    }
    assertCurrent();
    await handle.truncate(0);
    const bytes = Buffer.from(content, "utf8");
    for (let offset = 0; offset < bytes.length;) {
      const { bytesWritten } = await handle.write(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      offset += bytesWritten;
    }
  } finally {
    await handle.close();
  }
}
