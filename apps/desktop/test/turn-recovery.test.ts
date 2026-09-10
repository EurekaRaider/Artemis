import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reduceAgentEvents, type AgentPayload } from "@artemis/protocol";
import { AppStore } from "../src/main/store.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "artemis-turn-recovery-"));
  directories.push(directory);
  const path = join(directory, "state.sqlite");
  const store = new AppStore(path);
  const now = new Date().toISOString();
  store.createThread({
    id: "task",
    title: "Task",
    mode: "execute",
    target: "local",
    status: "idle",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  const checkpoint = {
    threadId: "task",
    turnId: "turn",
    text: "Finish the requested change",
    mode: "execute" as const,
    memoryContext: "Project guidance stays separate from the user message.",
  };
  store.appendEventsAndUpdateThread(
    "task",
    [
      {
        eventId: randomUUID(),
        turnId: "turn",
        payload: {
          type: "user.message",
          messageId: "user",
          text: checkpoint.text,
        },
      },
      {
        eventId: randomUUID(),
        turnId: "turn",
        payload: { type: "turn.started", mode: "execute" },
      },
    ],
    { status: "running" },
    checkpoint,
  );
  return { store, path, checkpoint };
}

describe("durable active-turn recovery", () => {
  it("survives SIGKILL with the committed request and tool result intact", async () => {
    const { store, path, checkpoint } = await fixture();
    store.close();
    const modulePath = join(directories.at(-1)!, "store.mjs");
    buildSync({
      entryPoints: [
        fileURLToPath(new URL("../src/main/store.ts", import.meta.url)),
      ],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: modulePath,
      logLevel: "silent",
    });
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { AppStore } from ${JSON.stringify(pathToFileURL(modulePath).href)};
      const store = new AppStore(${JSON.stringify(path)});
      store.appendEvent("tool-start", "task", "turn", { type: "tool.started", toolCallId: "write", toolName: "write" });
      store.appendEvent("tool-end", "task", "turn", { type: "tool.completed", toolCallId: "write", output: "Committed before crash", isError: false });
      process.kill(process.pid, "SIGKILL");
    `,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(child.signal, child.stderr).toBe("SIGKILL");
    const reopened = new AppStore(path);
    reopened.recoverInterruptedThreads();
    expect(reopened.getTurnCheckpoint("task")).toEqual(checkpoint);
    expect(
      reduceAgentEvents("task", reopened.getThreadEvents("task")).tools.write
        ?.output,
    ).toBe("Committed before crash");
    expect(reopened.getThread("task")?.status).toBe("running");
    reopened.close();
  });

  it("recovers the same turn after reopening, retaining output and completed tools", async () => {
    const { store, path, checkpoint } = await fixture();
    store.appendEvent(randomUUID(), "task", "turn", {
      type: "message.part.delta",
      partId: "text",
      partType: "text",
      delta: "Already done",
    });
    store.appendEvent(randomUUID(), "task", "turn", {
      type: "tool.started",
      toolCallId: "write",
      toolName: "write",
      input: { path: "done.txt" },
    });
    store.appendEvent(randomUUID(), "task", "turn", {
      type: "tool.completed",
      toolCallId: "write",
      output: "Written",
      isError: false,
    });
    store.close();
    const reopened = new AppStore(path);
    const events = reopened.recoverInterruptedThreads();
    expect(events.some((event) => event.payload.type === "turn.failed")).toBe(
      false,
    );
    expect(reopened.getTurnCheckpoint("task")).toEqual(checkpoint);
    expect(reopened.getThread("task")?.status).toBe("running");
    const state = reduceAgentEvents("task", reopened.getThreadEvents("task"));
    expect(state.turnOrder).toEqual(["turn"]);
    expect(Object.values(state.userMessages)).toHaveLength(1);
    expect(state.tools.write?.output).toBe("Written");
    expect(state.activity?.phase).toBe("reconnecting");
    reopened.close();
  });

  it.each([
    { type: "turn.completed", reason: "completed" },
    { type: "turn.completed", reason: "cancelled" },
    { type: "turn.failed", message: "Explicit failure" },
  ] as AgentPayload[])(
    "never resumes a terminal turn ($type $reason)",
    async (payload) => {
      const { store, path } = await fixture();
      // Simulate a crash between persisting the terminal event and updating thread status.
      store.appendEvent(randomUUID(), "task", "turn", payload);
      store.close();
      const reopened = new AppStore(path);
      reopened.recoverInterruptedThreads();
      expect(reopened.getTurnCheckpoint("task")).toBeUndefined();
      expect(reopened.getThread("task")?.status).toBe(
        payload.type === "turn.failed" ? "failed" : "idle",
      );
      reopened.close();
    },
  );

  it("does not turn an unresolved approval into a grant during recovery", async () => {
    const { store, path } = await fixture();
    store.appendEvent(randomUUID(), "task", "turn", {
      type: "approval.requested",
      approvalId: "approval",
      nonce: "restart-nonce-0001",
      summary: "Write",
      paths: [],
      network: [],
      risk: "medium",
      allowedScopes: ["once"],
    });
    store.updateThread("task", { status: "waiting-approval" });
    store.close();
    const reopened = new AppStore(path);
    const events = reopened.recoverInterruptedThreads();
    expect(
      events.find((event) => event.payload.type === "approval.resolved")
        ?.payload,
    ).toMatchObject({ approved: false });
    expect(reopened.getTurnCheckpoint("task")).toBeDefined();
    expect(reopened.getThread("task")?.status).toBe("running");
    reopened.close();
  });
});
