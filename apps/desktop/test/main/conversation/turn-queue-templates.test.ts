import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ArtemisAgentHost } from "@artemis/agent-host";
import { threadCommandSchema, type AgentHostCommand } from "@artemis/protocol";
import { createTurnQueueRuntime } from "../../../src/main/conversation/turn-queue-runtime.js";
import { RecoverableTurnQueues } from "../../../src/main/conversation/recoverable-turn-queue.js";

describe("prompt templates in desktop queues", () => {
  it("retains command text and images through expansion, editing, steering and recovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-template-queue-"));
    const agentDir = join(root, "agent");
    await mkdir(join(agentDir, "prompts"), { recursive: true });
    await writeFile(join(agentDir, "prompts/review.md"), "Review $1");
    const queues = new RecoverableTurnQueues();
    const host = new ArtemisAgentHost(
      { async request() {} },
      {
        emit(threadId, _turnId, payload) {
          if (payload.type === "queue.updated")
            queues.reconcile(threadId, payload.steering, payload.followUp);
        },
      },
      { agentDir },
    );
    const activeTurns = new Map([["thread", "turn"]]);
    const request = vi.fn(async (command: AgentHostCommand) => {
      if (command.type === "turn.prepare-input")
        return host.prepareTemplateInput(command.threadId, command.text);
      if (command.type === "turn.follow-up")
        return host.followUp(
          command.threadId,
          command.text,
          command.attachments,
          command.inputPrepared,
        );
      if (command.type === "turn.queue.replace")
        return host.replaceFollowUpQueue(
          command.threadId,
          command.expectedFollowUp,
          command.followUp,
        );
      if (command.type === "turn.queue.steer-item")
        return host.steerQueuedFollowUp(
          command.threadId,
          command.followUpIndex,
          command.expectedFollowUp,
        );
      throw new Error(`Unexpected command: ${command.type}`);
    });
    const runtime = createTurnQueueRuntime({
      activeTurns,
      openedThreads: new Set(["thread"]),
      compactingThreads: new Set(),
      compactionFollowUps: new RecoverableTurnQueues(),
      recoverableTurnQueues: queues,
      store: { getThread: () => ({ id: "thread", status: "running" }) },
      agentProcess: { request },
      parseThreadCommand: (command: unknown) =>
        threadCommandSchema.parse(command),
      attachmentScope: (id: string) => id,
      attachmentStore: () => ({
        bind: async (_scope: string, attachments: unknown[]) => attachments,
      }),
      emitPayload: vi.fn(),
      startTaskTurn: vi.fn(),
    } as unknown as Parameters<typeof createTurnQueueRuntime>[0]);
    try {
      await host.openThread({
        threadId: "thread",
        workspacePath: root,
        target: "local",
      });
      const hosted = (
        host as unknown as {
          threads: Map<
            string,
            {
              currentTurnId?: string;
              session: {
                agent: { steeringQueue: { messages: unknown[] } };
                getFollowUpMessages(): string[];
              };
            }
          >;
        }
      ).threads.get("thread")!;
      hosted.currentTurnId = "turn";
      const screenshot = {
        name: "shot.png",
        mimeType: "image/png" as const,
        data: "QQ==",
      };
      await runtime.queueTurn("turn.follow-up", {
        threadId: "thread",
        text: "/review first",
        attachments: [screenshot],
      });
      expect(hosted.session.getFollowUpMessages()).toEqual(["Review first"]);
      expect(queues.snapshot("thread").followUp).toEqual(["/review first"]);
      await runtime.replaceTurnQueue({
        threadId: "thread",
        expectedFollowUp: ["/review first"],
        followUp: [{ sourceIndex: 0, text: "/review edited" }],
      });
      expect(hosted.session.getFollowUpMessages()).toEqual(["Review edited"]);
      expect(queues.snapshot("thread").followUp).toEqual(["/review edited"]);
      await runtime.steerQueuedTurn({
        threadId: "thread",
        followUpIndex: 0,
        expectedFollowUp: ["/review edited"],
      });
      expect(hosted.session.agent.steeringQueue.messages).toMatchObject([
        {
          role: "user",
          content: [
            { type: "text", text: "Review edited" },
            { type: "image", data: "QQ==" },
          ],
        },
      ]);
      expect(queues.recover("thread", ["Review edited"])).toEqual([
        { text: "/review edited", attachments: [screenshot] },
      ]);
      // Preparation can perform I/O; a turn ending during it must not leave a ghost queue item.
      request.mockImplementationOnce(async () => {
        activeTurns.delete("thread");
        return "Review late";
      });
      await expect(
        runtime.queueTurn("turn.follow-up", {
          threadId: "thread",
          text: "/review late",
        }),
      ).rejects.toThrow("active turn ended");
      expect(queues.snapshot("thread").followUp).toEqual([]);
    } finally {
      host.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
