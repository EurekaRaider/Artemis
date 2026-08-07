import { mkdtemp, readFile, rm } from "node:fs/promises";
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

    const bundle = JSON.parse(rawBundle) as {
      application: { version: string; locale: string };
      state: {
        projectCount: number;
        threadCount: number;
        agentConcurrency: { effectiveLimit: number; queued: number };
      };
      events: Array<{ message: string; stack?: string }>;
    };
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
  });
});
