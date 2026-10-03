import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import { WORKSPACE_HTML_SCHEME } from "../shared/timeline-preview.js";
import { resolveWorkspaceFileLink } from "./workspace-file-link.js";

interface HtmlLease {
  threadId: string;
  workspace: string;
  path: string;
  directory: string;
  absolutePath: string;
  url: string;
}
const assetTypes: Record<string, string> = {
  // 页面间导航（<base> 相对解析，OD /raw/ 同构）：租约目录内兄弟 HTML 按
  // 真实文档返回（CSP 沙箱随响应下发，脚本限制不变）
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};
const inside = (directory: string, path: string) => {
  const child = relative(directory, path);
  return (
    !!child &&
    child !== ".." &&
    !child.startsWith("../") &&
    !child.startsWith("..\\") &&
    !isAbsolute(child)
  );
};

/** Each frame gets a revocable resource directory, never file: access or an IPC bridge. */
export class WorkspaceHtmlPreview {
  private leases = new Map<string, HtmlLease>();
  private generation = 0;
  constructor(
    private workspaceForThread: (threadId: string) => Promise<string>,
  ) {}

  async open(threadId: string, href: string): Promise<{ url: string }> {
    const generation = this.generation;
    const workspace = await realpath(await this.workspaceForThread(threadId));
    const file = await resolveWorkspaceFileLink(workspace, href);
    if (!/\.html?$/iu.test(file.path))
      throw new Error("HTML preview requires an HTML file.");
    if ((await stat(file.absolutePath)).size > 4 * 1024 * 1024)
      throw new Error("HTML preview exceeds 4 MiB.");
    if (generation !== this.generation)
      throw new Error("Preview session closed.");
    const id = randomUUID();
    const url = `${WORKSPACE_HTML_SCHEME}://${id}/${encodeURIComponent(basename(file.path))}`;
    this.leases.set(id, {
      threadId,
      workspace,
      path: file.path,
      directory: dirname(file.absolutePath),
      absolutePath: file.absolutePath,
      url,
    });
    return { url };
  }
  release(threadId: string, url: string) {
    for (const [id, lease] of this.leases)
      if (lease.threadId === threadId && lease.url === url)
        this.leases.delete(id);
  }
  clear() {
    this.generation++;
    this.leases.clear();
  }
  allowsNavigation(url: string) {
    return [...this.leases.values()].some(
      (lease) => lease.url === url.split("#", 1)[0],
    );
  }

  async respond(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const lease = this.leases.get(url.hostname);
    if (url.protocol !== `${WORKSPACE_HTML_SCHEME}:` || !lease)
      return new Response(null, { status: 404 });
    if (!["GET", "HEAD"].includes(request.method))
      return new Response(null, { status: 405 });
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const workspace = await realpath(
        await this.workspaceForThread(lease.threadId),
      );
      const entry = await resolveWorkspaceFileLink(workspace, lease.path);
      if (
        workspace !== lease.workspace ||
        entry.absolutePath !== lease.absolutePath
      )
        throw new Error("Workspace changed.");
      const path = await realpath(
        resolve(lease.directory, `.${decodeURIComponent(url.pathname)}`),
      );
      if (!inside(lease.directory, path) || !inside(workspace, path))
        throw new Error("Resource escapes preview directory.");
      const document = path === lease.absolutePath;
      const mimeType = document
        ? "text/html; charset=utf-8"
        : assetTypes[extname(path).toLowerCase()];
      if (!mimeType) throw new Error("Unsupported preview resource.");
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const metadata = await handle.stat();
      const limit = mimeType.startsWith("image/")
        ? 16 * 1024 * 1024
        : 4 * 1024 * 1024;
      if (!metadata.isFile() || metadata.size > limit)
        throw new Error("Preview resource exceeds limit.");
      if (
        (await realpath(path)) !== path ||
        this.leases.get(url.hostname) !== lease
      )
        throw new Error("Preview closed.");
      // Bound the actual read as well as stat: a file may grow while being read.
      const bytes = Buffer.alloc(metadata.size + 1);
      let bytesRead = 0;
      while (bytesRead < bytes.length) {
        const result = await handle.read(
          bytes,
          bytesRead,
          bytes.length - bytesRead,
          bytesRead,
        );
        if (!result.bytesRead) break;
        bytesRead += result.bytesRead;
      }
      if (bytesRead > metadata.size) throw new Error("Resource changed.");
      if (this.leases.get(url.hostname) !== lease)
        throw new Error("Preview closed.");
      const origin = `${WORKSPACE_HTML_SCHEME}://${url.hostname}`;
      const policy = `default-src 'none'; script-src 'unsafe-inline' ${origin}; style-src 'unsafe-inline' ${origin}; img-src data: blob: ${origin}; font-src data: ${origin}; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts`;
      return new Response(
        request.method === "HEAD" ? null : bytes.subarray(0, bytesRead),
        {
          headers: {
            "Content-Type": mimeType,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": policy,
            "Referrer-Policy": "no-referrer",
            "Access-Control-Allow-Origin": "*",
            "Permissions-Policy":
              "camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), usb=(), serial=(), hid=(), payment=(), display-capture=()",
          },
        },
      );
    } catch {
      return new Response(null, { status: 404 });
    } finally {
      await handle?.close();
    }
  }
}
