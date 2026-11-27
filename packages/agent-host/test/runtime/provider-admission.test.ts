import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { streamSimple } from "@earendil-works/pi-ai/api/anthropic-messages";
import type { Model } from "@earendil-works/pi-ai";

import {
  createProviderAdmission,
  createProviderBackoffExtension,
} from "../../src/runtime/provider-admission.js";
import {
  PROVIDER_BACKOFF_DEFAULT_MILLISECONDS,
  PROVIDER_BACKOFF_MAX_MILLISECONDS,
  providerResponseRetryDelayMilliseconds,
} from "../../src/runtime/stream-health.js";
import { AgentConcurrencyLimiter } from "../../src/runtime/agent-concurrency.js";
import { CodemodeWorkerPool } from "../../src/runtime/codemode-workers.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("provider response rate-limit backoff", () => {
  it("parses Retry-After and retry-after-ms headers for rate-limited and overloaded responses", () => {
    const now = Date.UTC(2026, 10, 27, 15, 0, 0);
    const futureHttpDate = new Date(now + 12_000).toUTCString();

    expect(
      providerResponseRetryDelayMilliseconds(
        429,
        { "Retry-After": "4.5" },
        now,
      ),
    ).toBe(4_500);
    expect(
      providerResponseRetryDelayMilliseconds(
        429,
        { "retry-after": futureHttpDate },
        now,
      ),
    ).toBe(12_000);
    expect(
      providerResponseRetryDelayMilliseconds(
        429,
        { "Retry-After-Ms": "1250" },
        now,
      ),
    ).toBe(1_250);
    expect(providerResponseRetryDelayMilliseconds(429, {}, now)).toBe(
      PROVIDER_BACKOFF_DEFAULT_MILLISECONDS,
    );
    expect(
      providerResponseRetryDelayMilliseconds(
        429,
        { "retry-after": "9999" },
        now,
      ),
    ).toBe(PROVIDER_BACKOFF_MAX_MILLISECONDS);

    expect(
      providerResponseRetryDelayMilliseconds(503, { "retry-after": "3" }, now),
    ).toBe(3_000);
    expect(
      providerResponseRetryDelayMilliseconds(529, { "retry-after": "2" }, now),
    ).toBe(2_000);
    expect(
      providerResponseRetryDelayMilliseconds(503, {}, now),
    ).toBeUndefined();
    expect(
      providerResponseRetryDelayMilliseconds(529, {}, now),
    ).toBeUndefined();

    expect(
      providerResponseRetryDelayMilliseconds(200, { "retry-after": "10" }, now),
    ).toBeUndefined();
    expect(
      providerResponseRetryDelayMilliseconds(400, { "retry-after": "10" }, now),
    ).toBeUndefined();
    expect(
      providerResponseRetryDelayMilliseconds(500, { "retry-after": "10" }, now),
    ).toBeUndefined();
  });

  it("records provider admission backoff from Pi after_provider_response on HTTP 429", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-backoff-hook-"));
    const blockedUntil = new Map<string, number>();
    const codemodeWorkers = new CodemodeWorkerPool(() => 1);
    const admission = createProviderAdmission({
      concurrency: new AgentConcurrencyLimiter(2, 1),
      codemodeWorkers,
      providerAdmissionBlockedUntil: blockedUntil,
    });

    const runtime = await ModelRuntime.create({
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
      credentials: {
        read: async () => ({ type: "api_key", key: "test-only" }),
        list: async () => [],
        modify: async () => undefined,
        delete: async () => {},
      },
    });
    const model = runtime.getModel("anthropic", "claude-sonnet-4-5")!;
    const responses: Array<{
      status: number;
      headers: Record<string, string>;
    }> = [];

    runtime.streamSimple = (current, context, options) =>
      streamSimple(current as Model<"anthropic-messages">, context, {
        ...options,
        apiKey: "test-only",
        maxRetries: 0,
        fetch: async () =>
          new Response(
            JSON.stringify({
              type: "error",
              error: {
                type: "rate_limit_error",
                message: "Rate limited",
              },
            }),
            {
              status: 429,
              headers: {
                "content-type": "application/json",
                "retry-after": "7",
              },
            },
          ),
      });

    const resourceLoader = new DefaultResourceLoader({
      cwd: root,
      agentDir: root,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      extensionFactories: [
        createProviderBackoffExtension(
          () => model.provider,
          (providerId, status, headers) => {
            responses.push({ status, headers });
            admission.recordProviderResponseBackoff(
              providerId,
              status,
              headers,
            );
          },
        ),
      ],
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: root,
      agentDir: root,
      modelRuntime: runtime,
      model,
      noTools: "builtin",
      resourceLoader,
      sessionManager: SessionManager.inMemory(root),
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
      }),
    });
    cleanups.push(async () => {
      session.dispose();
      codemodeWorkers.dispose();
      await rm(root, { recursive: true, force: true });
    });

    const before = Date.now();
    await session.prompt("Trigger rate limit");

    expect(responses).toHaveLength(1);
    expect(responses[0]!.status).toBe(429);
    const deadline = blockedUntil.get("anthropic");
    expect(deadline).toBeDefined();
    expect(deadline! - before).toBeGreaterThanOrEqual(6_000);
    expect(deadline! - before).toBeLessThanOrEqual(10_000);
  });
});
