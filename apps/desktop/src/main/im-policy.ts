import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat, readdir } from "node:fs/promises";
import { relative, sep } from "node:path";
import {
  IM_SECURITY_VERSION,
  imPathWithinScope,
  isImProtectedPath,
  normalizeImPath,
  type ExecutionGrant,
  type ImDataScope,
  type ImConversation,
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
): ImDataScope {
  if (
    grant.security?.version !== IM_SECURITY_VERSION ||
    !grant.security.confirmedAt
  )
    throw new Error("请在桌面确认此项目的数据与分享范围后继续。");
  const scope = grant.security.scopes.find((s) => s.audience === audience);
  if (!scope) throw new Error("此会话的数据与分享范围尚未授权，请在桌面设置。");
  return scope;
}
export function authorizeImPath(
  scope: ImDataScope,
  input: string,
  write = false,
): string {
  const path = normalizeImPath(input);
  if (scope.filePaths?.some((root) => path.startsWith(`${root}/`)))
    throw new Error("授权的是文件，不能将其替换为目录后扩大范围。");
  if (isImProtectedPath(path))
    throw new Error("此文件属于受保护配置，请在私人桌面任务中处理。");
  if (!imPathWithinScope(path, write ? scope.writePaths : scope.readPaths))
    throw new Error(
      "文件不在此会话的授权范围内，请在桌面调整范围后重新发起任务。",
    );
  return path;
}
export function imContentHash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
/** Detection is supplemental. Only scoped contexts are eligible for automatic delivery. */
export function inspectImOutbound(input: string): string | undefined {
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
    return "检测到可能的凭据，请在桌面审阅。";
  if (
    /<\s*(?:img|iframe|object|embed)\b/iu.test(text) ||
    /!\[[\s\S]*?\]\s*(?:\(|\[)/u.test(text)
  )
    return "外部图片或嵌入内容需要桌面审阅。";
  if (
    /(?:javascript|data|file):/iu.test(
      text.match(/(?:\]\([^)]*\)|<[^>]*>)/gu)?.join(" ") ?? "",
    )
  )
    return "链接包含不允许的协议。";
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
        return "链接可能携带敏感数据，请在桌面审阅。";
    } catch {
      return "链接无法安全解析，请在桌面审阅。";
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
): Promise<Buffer> {
  const path = await checkedRemotePath(
    workspace,
    authorizeImPath(scope, input),
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
): Promise<void> {
  const path = await checkedRemotePath(
    workspace,
    authorizeImPath(scope, input, true),
  );
  assertCurrent();
  await checkedRemotePath(workspace, input);
  const handle = await open(
    path,
    constants.O_WRONLY |
      (process.platform === "darwin" ? constants.O_CREAT : 0) |
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
    assertCurrent();
    await handle.truncate(0);
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
}
