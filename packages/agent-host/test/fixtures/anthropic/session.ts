import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/anthropic-messages";
import {
  PromptCacheController,
  withPromptCacheController,
} from "../../../src/context/prompt-cache.js";
import { withConnectionRecovery } from "../../../src/runtime/connection-recovery.js";

export interface ThreadRequest {
  messages: Array<{ role: string; content: unknown }>;
  system?: unknown;
  tools?: unknown;
  thread?: { type: "create" | "continue"; previous_message_id?: string };
}
export function anthropicReply(id: string): Response {
  const events = [
    {
      type: "message_start",
      message: {
        id,
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 0 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "text_delta",
        text: "Summary: retain the user's requirements and continue the work.",
      },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 10 },
    },
    { type: "message_stop" },
  ];
  return new Response(
    events
      .map(
        (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}
export function threadRejection(code: string): Response {
  return new Response(
    JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "thread rejected",
        details: { error_code: code },
      },
    }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
}
export async function anthropicSession() {
  const root = await mkdtemp(join(tmpdir(), "artemis-anthropic-threads-"));
  const requests: ThreadRequest[] = [];
  const contexts: Context[] = [];
  const streamOptions: SimpleStreamOptions[] = [];
  const controls: {
    respond?: (
      request: ThreadRequest,
      index: number,
    ) => Response | undefined | Promise<Response | undefined>;
  } = {};
  const runtime = await ModelRuntime.create({
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
    credentials: {
      read: async () => ({ type: "api_key", key: "test-only-key" }),
      list: async () => [],
      modify: async () => undefined,
      delete: async () => {},
    },
  });
  const model = runtime.getModel("anthropic", "claude-sonnet-4-5")!;
  const controller = new PromptCacheController();
  runtime.streamSimple = (current, context, options) => {
    contexts.push(structuredClone(context));
    streamOptions.push({ ...options });
    return streamSimple(current as Model<"anthropic-messages">, context, {
      ...options,
      apiKey: "test-only-key",
      maxRetries: 0,
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as ThreadRequest;
        requests.push(request);
        return (
          (await controls.respond?.(request, requests.length)) ??
          anthropicReply(`reply-${requests.length}`)
        );
      },
    });
  };
  const wrapped = withConnectionRecovery(
    withPromptCacheController(runtime, controller),
    () => {},
    { wait: async () => {} },
  );
  const resources = new DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
  });
  await resources.reload();
  const { session } = await createAgentSession({
    cwd: root,
    agentDir: root,
    modelRuntime: wrapped,
    model,
    resourceLoader: resources,
    noTools: "builtin",
    sessionManager: SessionManager.inMemory(root),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false, keepRecentTokens: 64, reserveTokens: 128 },
      cacheWarming: "off",
    }),
  });
  controller.registerSession(session.sessionId, {
    scope: "parent",
    priorTopLevelUserTurns: 0,
  });
  return {
    session,
    runtime: wrapped,
    model,
    requests,
    contexts,
    streamOptions,
    controls,
    controller,
    async dispose() {
      session.dispose();
      controller.unregisterSession(session.sessionId);
      await rm(root, { recursive: true, force: true });
    },
  };
}
