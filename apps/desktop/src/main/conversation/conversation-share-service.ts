import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { z } from "zod";
import {
  SessionManager,
  serializeSessionBranch,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
  Message as PiMessage,
} from "@earendil-works/pi-ai";
import { DEFAULT_RADIUS_GATEWAY } from "@earendil-works/pi-ai/providers/radius-config";
import { WORKSPACE_HTML_SCHEME } from "../../shared/timeline-preview.js";
import type {
  ConversationShare,
  ShareCommand,
  ShareDestination,
  ShareOptions,
  SharePreview,
} from "../../shared/conversation-share.js";

const execute = promisify(execFile);
const optionsSchema = z.object({
  tools: z.boolean(),
  thinking: z.boolean(),
  attachments: z.boolean(),
});
const previewId = z.string().uuid();
export const shareCommandSchema: z.ZodType<ShareCommand> = z.discriminatedUnion(
  "type",
  [
    z.object({
      type: z.literal("prepare"),
      threadId: z.string().min(1).max(200),
      options: optionsSchema,
    }),
    z.object({
      type: z.literal("update"),
      previewId,
      options: optionsSchema,
      excludedIds: z.array(z.string().max(200)).max(10000),
    }),
    z.object({
      type: z.literal("upload"),
      previewId,
      destination: z.enum(["auto", "gist", "radius"]),
    }),
    z.object({ type: z.literal("cancel"), previewId }),
    z.object({ type: z.literal("export"), previewId }),
    z.object({ type: z.literal("list"), threadId: z.string().min(1).max(200) }),
    z.object({ type: z.literal("delete"), id: previewId }),
  ],
);
const recordSchema = z.object({
  id: previewId,
  threadId: z.string(),
  title: z.string(),
  createdAt: z.string(),
  destination: z.enum(["gist", "radius"]),
  remoteId: z.string().min(1).max(200),
  url: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === "https:"),
});
type Message = Extract<SessionEntry, { type: "message" }>;
type Snapshot = {
  preview: SharePreview;
  source: Message[];
  html: string;
  jsonl: string;
  excludedIds: string[];
  revision: number;
  preparing?: boolean;
  attempted?: Promise<ConversationShare>;
  controller?: AbortController | undefined;
};
export interface ShareServiceOptions {
  directory: string;
  getThread(
    id: string,
  ):
    { id: string; title: string; sessionFile?: string | undefined } | undefined;
  radiusConfigured(): Promise<boolean>;
  radiusAuth(signal: AbortSignal): Promise<string | undefined>;
  runGh?: (args: string[], signal?: AbortSignal) => Promise<{ stdout: string }>;
  fetch?: typeof globalThis.fetch;
  renderHtml?: (jsonl: string) => Promise<string>;
}

/** Only allowlisted message fields reach an exported snapshot. */
function filteredMessage(
  entry: Message,
  options: ShareOptions,
): PiMessage | undefined {
  const m = entry.message;
  if (m.role !== "user" && m.role !== "assistant" && m.role !== "toolResult")
    return undefined;
  if (m.role === "toolResult" && !options.tools) return undefined;
  const parts: Array<TextContent | ImageContent | ThinkingContent | ToolCall> =
    typeof m.content === "string"
      ? [{ type: "text", text: m.content }]
      : m.content;
  const content: typeof parts = [];
  for (const part of parts) {
    if (part.type === "text") content.push({ type: "text", text: part.text });
    else if (
      part.type === "image" &&
      options.attachments &&
      /^(image\/(png|jpeg|gif|webp))$/.test(part.mimeType)
    )
      content.push({ type: "image", data: part.data, mimeType: part.mimeType });
    else if (part.type === "thinking" && options.thinking)
      content.push({ type: "thinking", thinking: part.thinking });
    else if (part.type === "toolCall" && options.tools)
      content.push({
        type: "toolCall",
        id: part.id,
        name: part.name,
        arguments: structuredClone(part.arguments),
      });
  }
  if (!content.length) return undefined;
  if (m.role === "user")
    return {
      role: "user",
      content: content as (TextContent | ImageContent)[],
      timestamp: m.timestamp,
    };
  if (m.role === "toolResult")
    return {
      role: "toolResult",
      toolCallId: m.toolCallId,
      toolName: m.toolName,
      content: content as (TextContent | ImageContent)[],
      isError: m.isError,
      timestamp: m.timestamp,
    };
  return {
    role: "assistant",
    content: content as AssistantMessage["content"],
    api: "openai-completions",
    provider: "artemis",
    model: "shared",
    stopReason: m.stopReason,
    timestamp: m.timestamp,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

export class ConversationShareService {
  private readonly previews = new Map<string, Snapshot>();
  private readonly jobs = new Set<string>();
  private records: ConversationShare[] | undefined;
  private persistTail: Promise<void> = Promise.resolve();
  private recordLoad: Promise<void> | undefined;
  private worker: Worker | undefined;
  private readonly pending = new Map<
    string,
    { resolve(html: string): void; reject(error: Error): void }
  >();
  private readonly runGh: NonNullable<ShareServiceOptions["runGh"]>;
  constructor(private readonly options: ShareServiceOptions) {
    this.runGh =
      options.runGh ??
      ((args, signal) =>
        execute("gh", args, {
          encoding: "utf8",
          windowsHide: true,
          timeout: 60_000,
          maxBuffer: 1024 * 1024,
          ...(signal ? { signal } : {}),
        }));
  }
  private snapshot(id: string): Snapshot {
    const value = this.previews.get(id);
    if (!value) throw new Error("Share preview expired. Prepare it again.");
    return value;
  }
  private renderHtml(jsonl: string): Promise<string> {
    if (this.options.renderHtml) return this.options.renderHtml(jsonl);
    if (!this.worker) {
      const worker = new Worker(
        new URL("./conversation-share-worker.js", import.meta.url),
        { resourceLimits: { maxOldGenerationSizeMb: 256 } },
      );
      this.worker = worker;
      worker.on(
        "message",
        ({ id, html, error }: { id: string; html: string; error?: string }) => {
          const pending = this.pending.get(id);
          if (!pending) return;
          this.pending.delete(id);
          if (error) pending.reject(new Error(error));
          else pending.resolve(html);
        },
      );
      const fail = (error: Error) => {
        if (this.worker !== worker) return;
        this.worker = undefined;
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
      };
      worker.on("error", fail);
      worker.on("exit", () => fail(new Error("Share preview worker exited.")));
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, jsonl });
    });
  }
  async prepare(
    threadId: string,
    options: ShareOptions,
  ): Promise<SharePreview> {
    const thread = this.options.getThread(threadId);
    if (!thread?.sessionFile)
      throw new Error("This conversation has no saved messages to share.");
    if ((await stat(thread.sessionFile)).size > 32 * 1024 * 1024)
      throw new Error(
        "The session is too large to share. Export a smaller branch.",
      );
    const source = SessionManager.open(thread.sessionFile)
      .getBranch()
      .filter((entry): entry is Message => entry.type === "message");
    const [gist, radius] = await Promise.all([
      this.runGh(["auth", "status"]).then(
        () => true,
        () => false,
      ),
      this.options.radiusConfigured(),
    ]);
    // Bound retained conversation data. Running uploads keep their own snapshot.
    for (const [id, value] of this.previews) {
      if (
        !value.controller &&
        (this.previews.size >= 4 ||
          Date.now() - Date.parse(value.preview.createdAt) > 15 * 60_000)
      )
        this.previews.delete(id);
    }
    const id = randomUUID();
    const snapshot: Snapshot = {
      preview: {
        id,
        threadId,
        title: thread.title,
        createdAt: new Date().toISOString(),
        previewUrl: "",
        messages: [],
        options,
        destinations: { gist, radius },
      },
      source,
      html: "",
      jsonl: "",
      excludedIds: [],
      revision: 0,
    };
    this.previews.set(id, snapshot);
    try {
      return await this.update(id, options, []);
    } catch (error) {
      this.previews.delete(id);
      throw error;
    }
  }
  async update(
    id: string,
    options: ShareOptions,
    excludedIds: string[],
  ): Promise<SharePreview> {
    const snapshot = this.snapshot(id);
    if (snapshot.attempted)
      throw new Error(
        "Prepare a new preview before changing an uploaded snapshot.",
      );
    const revision = ++snapshot.revision;
    snapshot.preparing = true;
    const sm = SessionManager.inMemory("/shared");
    sm.appendSessionInfo(snapshot.preview.title);
    const excluded = new Set(excludedIds);
    const messages: SharePreview["messages"] = [];
    for (const entry of snapshot.source) {
      const message = filteredMessage(entry, options);
      if (!message) continue;
      const included = !excluded.has(entry.id);
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content
              .map((part) =>
                part.type === "text"
                  ? part.text
                  : part.type === "thinking"
                    ? part.thinking
                    : part.type === "toolCall"
                      ? `${part.name} ${JSON.stringify(part.arguments)}`
                      : "[image]",
              )
              .join("\n");
      messages.push({ id: entry.id, role: message.role, text, included });
      if (included) sm.appendMessage(message);
    }
    try {
      const jsonl = serializeSessionBranch(sm);
      const html = await this.renderHtml(jsonl);
      if (Buffer.byteLength(html) + Buffer.byteLength(jsonl) > 16 * 1024 * 1024)
        throw new Error("The selected content is too large to share.");
      if (snapshot.revision !== revision)
        throw new Error("Share preview was superseded.");
      snapshot.html = html;
      snapshot.jsonl = jsonl;
      snapshot.excludedIds = [...excluded];
      snapshot.preview = {
        ...snapshot.preview,
        previewUrl: `${WORKSPACE_HTML_SCHEME}://share-${id}/session.html?revision=${revision}`,
        messages,
        options: { ...options },
      };
      return structuredClone(snapshot.preview);
    } finally {
      if (snapshot.revision === revision) snapshot.preparing = false;
    }
  }
  html(id: string): { title: string; html: string } {
    const snapshot = this.snapshot(id);
    return { title: snapshot.preview.title, html: snapshot.html };
  }
  allowsNavigation(url: string): boolean {
    return [...this.previews.values()].some(
      ({ preview }) => preview.previewUrl === url.split("#", 1)[0],
    );
  }
  respond(request: Request): Response | undefined {
    const url = new URL(request.url);
    if (
      url.protocol !== `${WORKSPACE_HTML_SCHEME}:` ||
      !url.hostname.startsWith("share-")
    )
      return;
    const snapshot = [...this.previews.values()].find(
      ({ preview }) => preview.previewUrl === request.url.split("#", 1)[0],
    );
    if (!snapshot) return new Response(null, { status: 404 });
    if (!["GET", "HEAD"].includes(request.method))
      return new Response(null, { status: 405 });
    return new Response(request.method === "HEAD" ? null : snapshot.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts",
        "Permissions-Policy":
          "camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), usb=(), serial=(), hid=(), payment=(), display-capture=()",
      },
    });
  }
  upload(id: string, requested: ShareDestination): Promise<ConversationShare> {
    const snapshot = this.snapshot(id);
    if (snapshot.attempted) return snapshot.attempted;
    if (snapshot.preparing)
      throw new Error("Wait for the share preview to finish.");
    if (!snapshot.preview.messages.some((message) => message.included))
      throw new Error("Select at least one message.");
    const destination =
      requested === "auto"
        ? snapshot.preview.destinations.radius
          ? "radius"
          : "gist"
        : requested;
    if (!snapshot.preview.destinations[destination])
      throw new Error(
        destination === "gist"
          ? "GitHub CLI is unavailable or not signed in."
          : "Sign in to Radius first.",
      );
    if (this.jobs.has(snapshot.preview.threadId))
      throw new Error(
        "A share upload for this conversation is already running.",
      );
    this.jobs.add(snapshot.preview.threadId);
    const controller = new AbortController();
    snapshot.controller = controller;
    snapshot.attempted = this.performUpload(
      snapshot,
      destination,
      AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
    ).finally(() => {
      this.jobs.delete(snapshot.preview.threadId);
      snapshot.controller = undefined;
    });
    return snapshot.attempted;
  }
  private async performUpload(
    snapshot: Snapshot,
    destination: "gist" | "radius",
    signal: AbortSignal,
  ): Promise<ConversationShare> {
    let remoteId: string;
    let url: string;
    try {
      if (destination === "radius") {
        const token = await this.options.radiusAuth(signal);
        signal.throwIfAborted();
        if (!token) throw new Error("Radius authentication is unavailable.");
        const endpoint = new URL("/v1/artifacts", DEFAULT_RADIUS_GATEWAY);
        endpoint.searchParams.set("visibility", "organization");
        endpoint.searchParams.set("title", snapshot.preview.title);
        const response = await (this.options.fetch ?? globalThis.fetch)(
          endpoint,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/x-ndjson",
            },
            body: snapshot.jsonl,
            signal,
          },
        );
        if (!response.ok)
          throw new Error(`Radius upload failed (${response.status}).`);
        const data = (await response.json()) as {
          artifact?: { id?: string; canonical_url?: string };
        };
        url = data.artifact?.canonical_url ?? "";
        remoteId =
          data.artifact?.id ??
          new URL(url).pathname.split("/").filter(Boolean).at(-1) ??
          "";
        if (!remoteId || new URL(url).protocol !== "https:")
          throw new Error("Radius returned an invalid share response.");
      } else {
        const directory = await mkdtemp(
          join(tmpdir(), "artemis-share-upload-"),
        );
        try {
          const path = join(directory, "session.html");
          await writeFile(path, snapshot.html, { mode: 0o600 });
          const result = await this.runGh(
            [
              "gist",
              "create",
              "--public=false",
              "--desc",
              snapshot.preview.title,
              path,
            ],
            signal,
          );
          const match =
            /^https:\/\/gist\.github\.com\/(?:[\w-]+\/)?([a-f0-9]+)\s*$/i.exec(
              result.stdout.trim(),
            );
          if (!match)
            throw new Error("GitHub returned an invalid gist response.");
          remoteId = match[1]!;
          url = `https://pi.dev/session/#${remoteId}`;
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      }
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof Error &&
          /timeout|abort|network|fetch failed/i.test(error.message))
      )
        throw new Error(
          "Upload interrupted; the remote result may already exist. Check the target before creating another share.",
        );
      throw error;
    }
    const record: ConversationShare = {
      id: randomUUID(),
      threadId: snapshot.preview.threadId,
      title: snapshot.preview.title,
      createdAt: new Date().toISOString(),
      destination,
      remoteId,
      url,
    };
    await this.list(record.threadId);
    this.records!.push(record);
    await this.persist();
    return record;
  }
  cancel(id: string): void {
    this.previews.get(id)?.controller?.abort();
  }
  async list(threadId: string): Promise<ConversationShare[]> {
    if (!this.records) {
      this.recordLoad ??= (async () => {
        try {
          this.records = z
            .array(recordSchema)
            .parse(
              JSON.parse(
                await readFile(
                  join(this.options.directory, "shares.json"),
                  "utf8",
                ),
              ),
            );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          this.records = [];
        }
      })();
      await this.recordLoad;
    }
    return this.records!.filter((record) => record.threadId === threadId).map(
      (record) => ({ ...record }),
    );
  }
  async delete(id: string): Promise<void> {
    await this.list("");
    const record = this.records!.find((item) => item.id === id);
    if (!record) throw new Error("Share not found.");
    if (record.destination === "gist") {
      if (!/^[a-f0-9]+$/i.test(record.remoteId))
        throw new Error("Invalid gist identifier.");
      await this.runGh([
        "api",
        "--method",
        "DELETE",
        `/gists/${record.remoteId}`,
      ]);
    } else
      throw new Error(
        "Manage or delete this Radius share from its artifact page.",
      );
    this.records = this.records!.filter((item) => item.id !== id);
    await this.persist();
  }
  private persist(): Promise<void> {
    const json = JSON.stringify(this.records);
    const next = this.persistTail
      .catch(() => {})
      .then(async () => {
        await mkdir(this.options.directory, { recursive: true });
        const target = join(this.options.directory, "shares.json");
        const temporary = `${target}.${randomUUID()}.tmp`;
        await writeFile(temporary, json, { mode: 0o600 });
        await rename(temporary, target);
      });
    this.persistTail = next;
    return next;
  }
  dispose(): void {
    for (const snapshot of this.previews.values()) snapshot.controller?.abort();
    this.previews.clear();
    for (const pending of this.pending.values())
      pending.reject(new Error("Share service closed."));
    this.pending.clear();
    void this.worker?.terminate();
    this.worker = undefined;
  }
}
