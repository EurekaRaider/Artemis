import { randomUUID } from "node:crypto";
import { constants, type BigIntStats, type ReadStream } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { Readable } from "node:stream";
import { resolveWorkspaceFileLink } from "./workspace-file-link.js";
import {
  WORKSPACE_VIDEO_SCHEME,
  workspaceVideoMimeType,
  workspaceAudioMimeType,
  type WorkspaceVideoSource,
} from "../shared/workspace-video.js";

export { WORKSPACE_VIDEO_SCHEME } from "../shared/workspace-video.js";
interface VideoLease extends WorkspaceVideoSource {
  threadId: string;
  workspace: string;
  absolutePath: string;
  streams: Set<ReadStream>;
}
const versionOf = (stat: BigIntStats) =>
  `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;

// A separate lease per player allows independent cancellation and deterministic cleanup.
export class WorkspaceVideoPreview {
  private readonly leases = new Map<string, VideoLease>();
  private generation = 0;
  constructor(
    private readonly workspaceForThread: (threadId: string) => Promise<string>,
  ) {}

  private async resolve(threadId: string, href: string) {
    const workspace = await realpath(await this.workspaceForThread(threadId));
    const file = await resolveWorkspaceFileLink(workspace, href);
    const mimeType =
      workspaceVideoMimeType(file.path) ?? workspaceAudioMimeType(file.path);
    if (!mimeType) throw new Error("Unsupported media format.");
    return { ...file, workspace, mimeType };
  }

  async open(threadId: string, href: string): Promise<WorkspaceVideoSource> {
    const generation = this.generation;
    const file = await this.resolve(threadId, href);
    const handle = await open(
      file.absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile() || stat.size === 0n)
        throw new Error("Video is empty or not ready.");
      if (generation !== this.generation)
        throw new Error("Video session closed.");
      const source = {
        path: file.path,
        mimeType: file.mimeType,
        version: versionOf(stat),
        url: `${WORKSPACE_VIDEO_SCHEME}://video/${randomUUID()}`,
      };
      this.leases.set(source.url, {
        ...source,
        threadId,
        workspace: file.workspace,
        absolutePath: file.absolutePath,
        streams: new Set(),
      });
      return source;
    } finally {
      await handle.close();
    }
  }

  release(threadId: string, url: string): void {
    const lease = this.leases.get(url);
    if (!lease || lease.threadId !== threadId) return;
    this.leases.delete(url);
    for (const stream of lease.streams) stream.destroy();
  }

  clear(): void {
    this.generation += 1;
    for (const lease of this.leases.values())
      this.release(lease.threadId, lease.url);
  }

  async respond(request: Request): Promise<Response> {
    const lease = this.leases.get(request.url);
    if (!lease) return new Response(null, { status: 404 });
    if (!["GET", "HEAD"].includes(request.method))
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const file = await this.resolve(lease.threadId, lease.path);
      if (
        file.workspace !== lease.workspace ||
        file.absolutePath !== lease.absolutePath
      )
        throw new Error("Workspace changed");
      handle = await open(
        file.absolutePath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const metadata = await handle.stat({ bigint: true });
      // Recheck after opening to avoid granting a path replaced during resolution.
      const checked = await this.resolve(lease.threadId, lease.path);
      if (
        checked.workspace !== lease.workspace ||
        checked.absolutePath !== file.absolutePath ||
        !this.leases.has(request.url)
      )
        throw new Error("Access changed");
      if (!metadata.isFile() || versionOf(metadata) !== lease.version) {
        this.release(lease.threadId, lease.url);
        return new Response(null, { status: 409 });
      }
      const size = Number(metadata.size);
      let start = 0,
        end = size - 1,
        status = 200;
      const range =
        request.method === "GET" ? request.headers.get("range") : null;
      if (range && !range.includes(",")) {
        const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
        let valid = Boolean(match && (match[1] || match[2]));
        if (valid && match) {
          if (!match[1]) {
            const suffix = Number(match[2]);
            valid = Number.isSafeInteger(suffix) && suffix > 0;
            start = Math.max(0, size - suffix);
          } else {
            start = Number(match[1]);
            const requestedEnd = match[2] ? Number(match[2]) : size - 1;
            valid =
              Number.isSafeInteger(start) &&
              Number.isSafeInteger(requestedEnd) &&
              requestedEnd >= start;
            end = Math.min(requestedEnd, size - 1);
          }
        }
        if (!valid || start >= size)
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` },
          });
        status = 206;
      }
      const headers = {
        "Content-Type": lease.mimeType,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(status === 206
          ? { "Content-Range": `bytes ${start}-${end}/${size}` }
          : {}),
      };
      if (request.method === "HEAD")
        return new Response(null, { status, headers });
      const stream = handle.createReadStream({
        start,
        end,
        autoClose: true,
        highWaterMark: 64 * 1024,
        signal: request.signal,
      });
      handle = undefined; // stream owns the descriptor, including on cancellation.
      lease.streams.add(stream);
      stream.once("close", () => lease.streams.delete(stream));
      return new Response(
        Readable.toWeb(stream, {
          strategy: {
            highWaterMark: 64 * 1024,
            size: (chunk: Buffer) => chunk.byteLength,
          },
        }) as ReadableStream<Uint8Array>,
        { status, headers },
      );
    } catch {
      this.release(lease.threadId, lease.url);
      return new Response(null, { status: 404 });
    } finally {
      await handle?.close();
    }
  }
}
