import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { forkPiSession } from "../../src/sessions/session-fork.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("forkPiSession", () => {
  it("creates an independent JSONL branch without changing the source", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-pi-fork-"));
    temporaryDirectories.push(directory);
    const workspace = join(directory, "workspace");
    const sessions = join(directory, "sessions");
    await mkdir(workspace);
    const manager = SessionManager.create(workspace, sessions);
    manager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Original request" }],
      timestamp: Date.now(),
    });
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Original response" }],
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
    const sourceFile = manager.getSessionFile();
    expect(sourceFile && existsSync(sourceFile)).toBe(true);

    const firstReplyId = manager.getLeafId()!;
    manager.appendMessage({
      role: "user",
      content: "Later request",
      timestamp: Date.now(),
    });
    const historical = SessionManager.open(
      forkPiSession(sourceFile!, firstReplyId, "Original response"),
    );
    expect(historical.getEntries()).toHaveLength(2);
    expect(
      SessionManager.open(
        forkPiSession(sourceFile!, undefined, "Original response"),
      ).getEntries(),
    ).toHaveLength(2);
    expect(() =>
      forkPiSession(sourceFile!, undefined, "unknown reply"),
    ).toThrow(/uniquely/);
    expect(() =>
      forkPiSession(sourceFile!, manager.getLeafId()!, "Later request"),
    ).toThrow(/completed assistant/);
    expect(() =>
      forkPiSession(sourceFile!, "missing", "Original response"),
    ).toThrow(/not found/);
    const forkedFile = forkPiSession(sourceFile!);
    const reopenedSource = SessionManager.open(sourceFile!);
    const forked = SessionManager.open(forkedFile);

    expect(forkedFile).not.toBe(sourceFile);
    expect(reopenedSource.getEntries()).toHaveLength(3);
    expect(forked.getEntries()).toHaveLength(3);
    expect(forked.getHeader().parentSession).toBe(sourceFile);
  });
});
