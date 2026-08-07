import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { DiagnosticBundleService } from "../src/main/diagnostic-bundle.js";

const gunzipAsync = promisify(gunzip);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("DiagnosticBundleService", () => {
  it("loads version 1 event diagnostics before exporting version 2", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-diagnostics-"));
    temporaryDirectories.push(directory);
    const statePath = join(directory, "events.json");
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        events: [
          {
            source: "main",
            severity: "warning",
            message: "legacy event",
            timestamp: "2026-08-06T00:00:00.000Z",
          },
        ],
      }),
    );
    const service = new DiagnosticBundleService(statePath, []);
    const destination = join(directory, "bundle.json.gz");
    await service.exportBundle(destination, {
      appVersion: "1.2.3",
      platform: "darwin",
      architecture: "arm64",
      locale: "en",
      projectCount: 0,
      threadCount: 0,
      activeTurnCount: 0,
      agentConcurrency: {
        preference: { mode: "auto" },
        startupLimit: 10,
        effectiveLimit: 10,
        active: 0,
        queued: 0,
        hardLimit: 16,
        throttled: false,
        pressureReasons: [],
        parallelism: 10,
        totalMemoryGiB: 32,
      },
    });
    const bundle = JSON.parse(
      (await gunzipAsync(await readFile(destination))).toString("utf8"),
    ) as {
      version: number;
      events: Array<{ message: string }>;
      turnLatency: unknown[];
    };
    expect(bundle.version).toBe(2);
    expect(bundle.events[0]?.message).toBe("legacy event");
    expect(bundle.turnLatency).toEqual([]);
  });

  it("persists a bounded event buffer and exports only redacted data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-diagnostics-"));
    temporaryDirectories.push(directory);
    const statePath = join(directory, "state", "events.json");
    const privateRoot = "C:\\Users\\person\\secret-workspace";
    const service = new DiagnosticBundleService(statePath, [privateRoot], 2);
    service.record({
      source: "main",
      severity: "warning",
      message: "old event",
    });
    service.record({
      source: "agent-host",
      severity: "error",
      message: `${privateRoot}\\src\\main.ts token=first-secret`,
      stack: `Error: failure\n    at ${privateRoot}\\src\\main.ts:4:2`,
    });
    service.record({
      source: "renderer",
      severity: "fatal",
      message: "Authorization: Bearer access-token-secret",
    });
    service.recordTurnLatency({
      timestamp: "2026-08-07T00:00:00.000Z",
      outcome: "completed",
      coldThread: false,
      providerId: "openai",
      modelId: "gpt-test",
      thinkingLevel: "low",
      mode: "execute",
      enabledMcpServers: 2,
      toolCount: 9,
      mcpToolCount: 7,
      queueDepth: 0,
      eventCount: 12,
      contextTokens: 4_096,
      cacheReadTokens: 2_048,
      stagesMs: {
        localPreModel: 42,
        workspaceResolve: 3,
        modelToFirstText: 120,
      },
      prompt: "private prompt must not persist",
      response: "private response must not persist",
      path: `${privateRoot}\\prompt.txt`,
      credential: "token=latency-secret",
    } as Parameters<DiagnosticBundleService["recordTurnLatency"]>[0]);

    const reopened = new DiagnosticBundleService(statePath, [privateRoot], 2);
    const destination = join(directory, "bundle.json.gz");
    await reopened.exportBundle(destination, {
      appVersion: "1.2.3",
      platform: "win32",
      architecture: "x64",
      locale: "zh-CN",
      projectCount: 2,
      threadCount: 7,
      activeTurnCount: 1,
      agentConcurrency: {
        preference: { mode: "auto" },
        startupLimit: 12,
        effectiveLimit: 11,
        active: 9,
        queued: 2,
        hardLimit: 16,
        throttled: true,
        pressureReasons: ["cpu"],
        parallelism: 15,
        totalMemoryGiB: 48,
      },
    });

    const rawBundle = (await gunzipAsync(await readFile(destination))).toString(
      "utf8",
    );
    expect(rawBundle).not.toContain("old event");
    expect(rawBundle).not.toContain(privateRoot);
    expect(rawBundle).not.toContain("first-secret");
    expect(rawBundle).not.toContain("access-token-secret");
    expect(rawBundle).not.toContain("private prompt");
    expect(rawBundle).not.toContain("private response");
    expect(rawBundle).not.toContain("latency-secret");

    const bundle = JSON.parse(rawBundle) as {
      version: number;
      application: { version: string; locale: string };
      state: {
        projectCount: number;
        threadCount: number;
        agentConcurrency: { effectiveLimit: number; queued: number };
      };
      events: Array<{ message: string; stack?: string }>;
      turnLatency: Array<{ stagesMs: { localPreModel: number } }>;
    };
    expect(bundle.version).toBe(2);
    expect(bundle.application).toMatchObject({
      version: "1.2.3",
      locale: "zh-CN",
    });
    expect(bundle.state).toMatchObject({ projectCount: 2, threadCount: 7 });
    expect(bundle.state.agentConcurrency).toMatchObject({
      effectiveLimit: 11,
      queued: 2,
    });
    expect(bundle.events).toHaveLength(2);
    expect(bundle.events[0]?.message).toContain("[PATH]");
    expect(bundle.events[0]?.message).toContain("[REDACTED]");
    expect(bundle.events[1]?.message).toContain("[REDACTED]");
    expect(bundle.turnLatency).toEqual([
      expect.objectContaining({
        providerId: "openai",
        cacheReadTokens: 2_048,
        stagesMs: expect.objectContaining({
          localPreModel: 42,
          workspaceResolve: 3,
        }),
      }),
    ]);
    expect(bundle.turnLatency[0]).not.toHaveProperty("prompt");
    expect(bundle.turnLatency[0]).not.toHaveProperty("response");
    expect(bundle.turnLatency[0]).not.toHaveProperty("path");
  });
});
