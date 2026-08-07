import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { ArtemisAgentHost } from "../src/runtime.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function createHost() {
  return new ArtemisAgentHost(
    {
      async request() {
        throw new Error("The resume test must not execute brokered tools");
      },
    },
    { emit() {} },
  );
}

describe("Pi session restart recovery", () => {
  it("reopens the exact JSONL session and preserves its branch entries", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artemis-resume-"));
    cleanupPaths.push(workspace);
    const project = join(workspace, "project");
    const sessions = join(workspace, "sessions");
    await mkdir(project);
    const persisted = SessionManager.create(project, sessions);
    persisted.appendMessage({
      role: "user",
      content: [
        {
          type: "text",
          text: "Context that must survive an Agent Host restart",
        },
      ],
      timestamp: Date.now(),
    });
    persisted.appendMessage({
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Persisted response from the previous desktop process",
        },
      ],
      api: "test",
      provider: "test",
      model: "deterministic",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    } as never);
    const sessionFile = persisted.getSessionFile();
    expect(sessionFile).toBeTruthy();
    expect(
      SessionManager.open(sessionFile!).getEntries().length,
    ).toBeGreaterThanOrEqual(2);

    const firstHost = createHost();
    const opened = await firstHost.openThread({
      threadId: "thread-resume",
      workspacePath: project,
      target: "local",
      sessionFile,
    });
    expect(opened.sessionFile).toBe(sessionFile);
    firstHost.dispose();
    expect(
      SessionManager.open(sessionFile!).getEntries().length,
    ).toBeGreaterThanOrEqual(2);

    const restartedHost = createHost();
    const resumed = await restartedHost.openThread({
      threadId: "thread-resume",
      workspacePath: project,
      target: "local",
      sessionFile,
    });
    expect(resumed.sessionFile).toBe(sessionFile);
    expect(
      SessionManager.open(sessionFile!).getEntries().length,
    ).toBeGreaterThanOrEqual(2);

    const forked = restartedHost.forkThread("thread-resume");
    const forkEntries = SessionManager.open(forked.sessionFile).getEntries();
    expect(forkEntries).toContainEqual(
      expect.objectContaining({
        type: "message",
        message: expect.objectContaining({
          role: "user",
          content: expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              text: "Context that must survive an Agent Host restart",
            }),
          ]),
        }),
      }),
    );
    restartedHost.dispose();
  });
});
