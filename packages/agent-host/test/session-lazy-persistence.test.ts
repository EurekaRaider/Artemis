import { existsSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtemisAgentHost } from "../src/runtime.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Pi session lazy persistence", () => {
  it("keeps an empty task off disk while preserving its initialized tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-lazy-session-"));
    cleanupPaths.push(root);
    const workspacePath = join(root, "workspace");
    const agentDir = join(root, "agent");
    await mkdir(workspacePath);

    const host = new ArtemisAgentHost(
      {
        async request() {
          throw new Error("The lazy-session test must not broker tools.");
        },
      },
      { emit() {} },
      { agentDir },
    );
    const opened = await host.openThread({
      threadId: "empty-thread",
      workspacePath,
      target: "local",
    });

    expect(opened.sessionFile).toBeUndefined();
    await expect(access(join(agentDir, "sessions"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const thread = (
      host as unknown as {
        threads: Map<
          string,
          {
            executeTools: Array<{ name: string }>;
            delegatedTools: Array<{ name: string }>;
          }
        >;
      }
    ).threads.get("empty-thread");
    expect(thread).toBeDefined();
    expect(thread!.executeTools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "read",
        "write",
        "office_document",
        "bash",
        "request_user_input",
      ]),
    );
    expect(thread!.delegatedTools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["read", "request_user_input"]),
    );

    host.dispose();
  });

  it("creates the session directory and transcript for the first real turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-lazy-session-"));
    cleanupPaths.push(root);
    const workspacePath = join(root, "workspace");
    const agentDir = join(root, "agent");
    await mkdir(workspacePath);

    vi.spyOn(AgentSession.prototype, "prompt").mockImplementation(
      async function (text) {
        this.sessionManager.appendMessage({
          role: "user",
          content: [{ type: "text", text }],
          timestamp: Date.now(),
        });
        this.sessionManager.appendMessage({
          role: "assistant",
          content: [{ type: "text", text: "Persisted response" }],
          api: "test",
          provider: "test",
          model: "deterministic",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: "stop",
          timestamp: Date.now(),
        } as never);
      },
    );

    let sessionFile: string | undefined;
    let sessionFileExistedWhenReported = false;
    const host = new ArtemisAgentHost(
      {
        async request() {
          throw new Error("The lazy-session test must not broker tools.");
        },
      },
      { emit() {} },
      {
        agentDir,
        onSessionFile(_threadId, path) {
          sessionFile = path;
          sessionFileExistedWhenReported = existsSync(path);
        },
      },
    );
    const opened = await host.openThread({
      threadId: "persisted-thread",
      workspacePath,
      target: "local",
    });
    expect(opened.sessionFile).toBeUndefined();
    await expect(access(join(agentDir, "sessions"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    await host.prompt(
      "persisted-thread",
      "turn-1",
      "Record this conversation",
      "execute",
    );

    expect(sessionFile).toBeTruthy();
    expect(sessionFileExistedWhenReported).toBe(true);
    await expect(readFile(sessionFile!, "utf8")).resolves.toContain(
      "Persisted response",
    );
    expect(
      SessionManager.open(sessionFile!).getEntries().length,
    ).toBeGreaterThanOrEqual(2);

    host.dispose();
  });

  it("does not create an empty directory when a turn ends before any assistant message", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-lazy-session-"));
    cleanupPaths.push(root);
    const workspacePath = join(root, "workspace");
    const agentDir = join(root, "agent");
    await mkdir(workspacePath);

    vi.spyOn(AgentSession.prototype, "prompt").mockImplementation(
      async function (text) {
        this.sessionManager.appendMessage({
          role: "user",
          content: [{ type: "text", text }],
          timestamp: Date.now(),
        });
        throw new Error("Cancelled before the assistant responded");
      },
    );

    let sessionFile: string | undefined;
    const host = new ArtemisAgentHost(
      {
        async request() {
          throw new Error("The lazy-session test must not broker tools.");
        },
      },
      { emit() {} },
      {
        agentDir,
        onSessionFile(_threadId, path) {
          sessionFile = path;
        },
      },
    );
    await host.openThread({
      threadId: "cancelled-thread",
      workspacePath,
      target: "local",
    });

    await expect(
      host.prompt(
        "cancelled-thread",
        "turn-1",
        "Do not persist this incomplete turn",
        "execute",
      ),
    ).rejects.toThrow("Cancelled before the assistant responded");
    expect(sessionFile).toBeUndefined();
    await expect(access(join(agentDir, "sessions"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    host.dispose();
  });
});
