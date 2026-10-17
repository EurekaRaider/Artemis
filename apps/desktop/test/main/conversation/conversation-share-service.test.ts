import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  ConversationShareService,
  shareCommandSchema,
} from "../../../src/main/conversation/conversation-share-service.js";
import { renderShareHtml } from "../../../src/main/conversation/conversation-share-export.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const defaults = { tools: false, thinking: false, attachments: false };
it("serves a revocable isolated preview without permitting remote resources or Node access", async () => {
  const f = await fixture();
  const preview = await f.service.prepare("thread", defaults);
  expect(preview.previewUrl).toMatch(/^artemis-preview:\/\/share-/);
  const response = f.service.respond(new Request(preview.previewUrl))!;
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(f.service.html(preview.id).html);
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "sandbox allow-scripts",
  );
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "connect-src 'none'",
  );
  expect(f.service.allowsNavigation(preview.previewUrl)).toBe(true);
  expect(f.service.allowsNavigation(`${preview.previewUrl}/other`)).toBe(false);
  expect(
    f.service.respond(new Request(`${preview.previewUrl}/other`))?.status,
  ).toBe(404);
  expect(
    f.service.respond(new Request(preview.previewUrl, { method: "POST" }))
      ?.status,
  ).toBe(405);
  const changed = await f.service.update(preview.id, defaults, []);
  expect(f.service.respond(new Request(preview.previewUrl))?.status).toBe(404);
  expect(f.service.respond(new Request(changed.previewUrl))?.status).toBe(200);
  f.service.dispose();
  expect(f.service.respond(new Request(changed.previewUrl))?.status).toBe(404);
});
async function fixture({ radius = false, gist = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "artemis-share-test-"));
  const sm = SessionManager.create(
    "/private/SECRET_WORKSPACE",
    join(root, "sessions"),
  );
  const first = sm.appendMessage({
    role: "user",
    content: "Shared question",
    timestamp: 1,
  });
  const assistant: AssistantMessage = {
    role: "assistant",
    content: [
      { type: "text", text: "Public answer" },
      { type: "thinking", thinking: "SECRET_THINKING" },
      {
        type: "toolCall",
        id: "tool-1",
        name: "read",
        arguments: { path: "SECRET_TOOL_PATH" },
      },
    ],
    api: "openai-completions",
    provider: "SECRET_PROVIDER",
    model: "SECRET_MODEL",
    timestamp: 2,
    stopReason: "toolUse",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
  sm.appendMessage(assistant);
  sm.appendMessage({
    role: "toolResult",
    toolCallId: "tool-1",
    toolName: "read",
    content: [{ type: "text", text: "SECRET_TOOL_OUTPUT" }],
    isError: false,
    timestamp: 3,
  });
  sm.appendCustomEntry("pi.share", {
    systemPrompt: "SECRET_SYSTEM_PROMPT",
    credentials: "SECRET_CREDENTIAL",
  });
  sm.appendMessage({ role: "user", content: "ABANDONED_BRANCH", timestamp: 4 });
  sm.branch(first);
  sm.appendMessage({ ...assistant, stopReason: "stop" });
  sm.appendCustomEntry("private-context", { hidden: "SECRET_EXTENSION_STATE" });
  const runGh = vi.fn(async (args: string[]) => {
    if (args[0] === "auth") {
      if (!gist) throw new Error("not signed in");
      return { stdout: "" };
    }
    return { stdout: "https://gist.github.com/test/abc123\n" };
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({
      artifact: {
        id: "artifact-1",
        canonical_url: "https://radius.earendil.com/artifacts/artifact-1",
      },
    }),
  );
  const radiusAuth = vi.fn(async () => "synthetic-radius-only");
  const service = new ConversationShareService({
    directory: join(root, "shares"),
    getThread: (id) =>
      id === "thread"
        ? {
            id,
            title: "Synthetic conversation",
            sessionFile: sm.getSessionFile(),
          }
        : undefined,
    radiusConfigured: async () => radius,
    radiusAuth,
    runGh,
    fetch,
    renderHtml: renderShareHtml,
  });
  cleanups.push(async () => {
    service.dispose();
    await rm(root, { recursive: true, force: true });
  });
  return { root, sm, service, runGh, fetch, radiusAuth };
}

it("exports only current-branch visible messages by default and removes private metadata", async () => {
  const f = await fixture({ radius: true });
  const preview = await f.service.prepare("thread", defaults);
  expect(preview.messages.map((message) => message.text)).toEqual([
    "Shared question",
    "Public answer",
  ]);
  expect(f.service.html(preview.id).html).toContain("Content-Security-Policy");
  await f.service.upload(preview.id, "auto");
  expect(f.fetch).toHaveBeenCalledOnce();
  const request = f.fetch.mock.calls[0]!;
  expect(String(request[0])).toContain("visibility=organization");
  const jsonl = String(request[1]!.body);
  expect(jsonl).toContain("Shared question");
  expect(jsonl).not.toMatch(/SECRET_|ABANDONED_BRANCH/);
  expect(jsonl).toContain('"cwd":"/shared"');
  expect(f.runGh.mock.calls.every(([args]) => args[0] === "auth")).toBe(true);
});

it("freezes the branch at preview time and honors content options and per-message exclusions", async () => {
  const f = await fixture({ radius: true });
  const original = await f.service.prepare("thread", defaults);
  f.sm.appendMessage({
    role: "user",
    content: "LATER_PRIVATE_MESSAGE",
    timestamp: 5,
  });
  const preview = await f.service.update(
    original.id,
    { tools: true, thinking: true, attachments: false },
    [original.messages[0]!.id],
  );
  expect(
    preview.messages.find((m) => m.text === "Shared question")!.included,
  ).toBe(false);
  expect(preview.messages[1]!.text).toContain("SECRET_THINKING");
  await f.service.upload(preview.id, "radius");
  const payload = String(f.fetch.mock.calls[0]![1]!.body);
  expect(payload).toContain("SECRET_TOOL_PATH");
  expect(payload).not.toContain("Shared question");
  expect(payload).not.toContain("LATER_PRIVATE_MESSAGE");
  expect(payload).not.toContain("SECRET_SYSTEM_PROMPT");
});

it("creates one secret gist for repeated upload clicks, persists only the receipt, and deletes it", async () => {
  const f = await fixture();
  let uploaded = "";
  f.runGh.mockImplementation(async (args) => {
    if (args[0] === "gist") uploaded = await readFile(args.at(-1)!, "utf8");
    return {
      stdout: args[0] === "gist" ? "https://gist.github.com/test/abc123" : "",
    };
  });
  const preview = await f.service.prepare("thread", defaults);
  const [a, b] = await Promise.all([
    f.service.upload(preview.id, "gist"),
    f.service.upload(preview.id, "gist"),
  ]);
  expect(a.id).toBe(b.id);
  expect(
    f.runGh.mock.calls.filter(([args]) => args[0] === "gist"),
  ).toHaveLength(1);
  expect(f.runGh.mock.calls.find(([args]) => args[0] === "gist")![0]).toContain(
    "--public=false",
  );
  expect(uploaded).toBe(f.service.html(preview.id).html);
  const persisted = await readFile(
    join(f.root, "shares", "shares.json"),
    "utf8",
  );
  expect(persisted).toContain("abc123");
  expect(persisted).not.toContain("Shared question");
  expect(a.url).toBe("https://pi.dev/session/#abc123");
  await f.service.delete(a.id);
  expect(f.runGh).toHaveBeenLastCalledWith([
    "api",
    "--method",
    "DELETE",
    "/gists/abc123",
  ]);
  expect(await f.service.list("thread")).toEqual([]);
});

it("never changes a forced Radius destination to Gist on failure or missing authentication", async () => {
  const f = await fixture({ radius: true });
  f.fetch.mockResolvedValue(new Response("failure", { status: 503 }));
  const preview = await f.service.prepare("thread", defaults);
  await expect(f.service.upload(preview.id, "radius")).rejects.toThrow("503");
  await expect(f.service.upload(preview.id, "radius")).rejects.toThrow("503");
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(f.runGh.mock.calls.some(([args]) => args[0] === "gist")).toBe(false);
  expect(await f.service.list("thread")).toEqual([]);
  const missing = await fixture();
  const other = await missing.service.prepare("thread", defaults);
  expect(() => missing.service.upload(other.id, "radius")).toThrow("Sign in");
});

it("aborts uploads, retains uncertain outcomes, and does not automatically retry", async () => {
  const f = await fixture({ radius: true });
  const started = Promise.withResolvers<void>();
  f.fetch.mockImplementation(async (_url, init) => {
    started.resolve();
    return new Promise((_resolve, reject) =>
      init!.signal!.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      ),
    );
  });
  const preview = await f.service.prepare("thread", defaults);
  const upload = f.service.upload(preview.id, "radius");
  await started.promise;
  f.service.cancel(preview.id);
  await expect(upload).rejects.toThrow("remote result may already exist");
  await expect(f.service.upload(preview.id, "gist")).rejects.toThrow(
    "remote result may already exist",
  );
  expect(f.fetch).toHaveBeenCalledOnce();
});

it("keeps HTML export usable without either cloud account", async () => {
  const f = await fixture({ gist: false });
  const preview = await f.service.prepare("thread", defaults);
  expect(preview.destinations).toEqual({ gist: false, radius: false });
  expect(f.service.html(preview.id).html).toContain("Content-Security-Policy");
  expect(() => f.service.upload(preview.id, "auto")).toThrow("GitHub CLI");
  expect(f.fetch).not.toHaveBeenCalled();
});

it("rejects untrusted commands and does not accept renderer-supplied paths or upload URLs", () => {
  expect(() =>
    shareCommandSchema.parse({
      type: "upload",
      previewId: "invalid",
      destination: "https://attacker.example",
    }),
  ).toThrow();
  expect(
    shareCommandSchema.parse({
      type: "prepare",
      threadId: "thread",
      options: defaults,
      sessionFile: "/etc/passwd",
    }),
  ).not.toHaveProperty("sessionFile");
});
