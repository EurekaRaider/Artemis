import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ArtemisAgentHost } from "../src/runtime.js";

interface QueueTestImage {
  type: "image";
  data: string;
  mimeType: string;
}

interface QueueTestSession {
  _isAgentRunActive: boolean;
  _followUpMessages: string[];
  steer(text: string, images?: QueueTestImage[]): Promise<void>;
  followUp(text: string, images?: QueueTestImage[]): Promise<void>;
  sendCustomMessage(
    message: {
      customType: string;
      content: string;
      display: boolean;
      details?: unknown;
    },
    options: { deliverAs: "steer" },
  ): Promise<void>;
  getSteeringMessages(): readonly string[];
  getFollowUpMessages(): readonly string[];
  agent: {
    steeringQueue: { messages: unknown[] };
    followUpQueue: { messages: unknown[] };
  };
}

function queueTestThread(host: ArtemisAgentHost, threadId: string) {
  return (
    host as unknown as {
      threads: Map<
        string,
        { currentTurnId?: string; session: QueueTestSession }
      >;
    }
  ).threads.get(threadId)!;
}

describe("follow-up queue mutation", () => {
  it("edits, deletes, and reorders exact follow-ups without losing images", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-queue-replacement-"));
    const workspacePath = join(root, "workspace");
    const agentDir = join(root, "agent");
    await mkdir(workspacePath);

    const host = new ArtemisAgentHost(
      { async request() {} },
      { emit() {} },
      { agentDir },
    );
    try {
      await host.openThread({
        threadId: "thread-queue",
        workspacePath,
        target: "local",
      });
      const thread = queueTestThread(host, "thread-queue");
      thread.currentTurnId = "turn-queue-1";
      const images = ["Zmlyc3Q=", "c2Vjb25k", "dGhpcmQ="].map((data) => ({
        type: "image" as const,
        data,
        mimeType: "image/png",
      }));
      await thread.session.steer("Keep this steering message", [images[0]!]);
      await thread.session.followUp("First", [images[0]!]);
      await thread.session.followUp("Second", [images[1]!]);
      await thread.session.followUp("Delete me", [images[2]!]);
      const steeringBefore = [...thread.session.agent.steeringQueue.messages];
      const firstBefore = thread.session.agent.followUpQueue.messages[0];

      await host.replaceFollowUpQueue(
        "thread-queue",
        ["First", "Second", "Delete me"],
        [
          { sourceIndex: 1, text: "Edited second" },
          { sourceIndex: 0, text: "First" },
        ],
      );

      expect(thread.session.getSteeringMessages()).toEqual([
        "Keep this steering message",
      ]);
      expect(thread.session.agent.steeringQueue.messages).toEqual(
        steeringBefore,
      );
      expect(thread.session.getFollowUpMessages()).toEqual([
        "Edited second",
        "First",
      ]);
      expect(thread.session.agent.followUpQueue.messages[1]).toBe(firstBefore);
      expect(thread.session.agent.followUpQueue.messages).toMatchObject([
        {
          role: "user",
          content: [{ type: "text", text: "Edited second" }, images[1]],
        },
        {
          role: "user",
          content: [{ type: "text", text: "First" }, images[0]],
        },
      ]);
    } finally {
      host.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("moves the exact queued message with images and preserves hidden messages", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-queue-steer-item-"));
    const workspacePath = join(root, "workspace");
    const agentDir = join(root, "agent");
    await mkdir(workspacePath);

    const host = new ArtemisAgentHost(
      { async request() {} },
      { emit() {} },
      { agentDir },
    );
    try {
      await host.openThread({
        threadId: "thread-steer-item",
        workspacePath,
        target: "local",
      });
      const thread = queueTestThread(host, "thread-steer-item");
      thread.currentTurnId = "turn-steer-item-1";

      const firstImage = {
        type: "image" as const,
        data: "Zmlyc3Q=",
        mimeType: "image/png",
      };
      const selectedImage = {
        type: "image" as const,
        data: "c2VsZWN0ZWQ=",
        mimeType: "image/png",
      };
      const thirdImage = {
        type: "image" as const,
        data: "dGhpcmQ=",
        mimeType: "image/png",
      };
      await thread.session.steer("Keep this steering message");
      await thread.session.followUp("First", [firstImage]);
      await thread.session.followUp("Steer this one", [selectedImage]);
      await thread.session.followUp("Third", [thirdImage]);

      thread.session._isAgentRunActive = true;
      await thread.session.sendCustomMessage(
        {
          customType: "artemis-agent-team-message",
          content: "Hidden team handoff",
          display: false,
          details: { messageId: "message-hidden" },
        },
        { deliverAs: "steer" },
      );
      thread.session._isAgentRunActive = false;

      const hiddenMessage = thread.session.agent.steeringQueue.messages[1];
      await host.steerQueuedFollowUp("thread-steer-item", 1, [
        "First",
        "Steer this one",
        "Third",
      ]);

      expect(thread.session.getSteeringMessages()).toEqual([
        "Keep this steering message",
        "Steer this one",
      ]);
      expect(thread.session.getFollowUpMessages()).toEqual(["First", "Third"]);
      expect(thread.session.agent.steeringQueue.messages[1]).toBe(
        hiddenMessage,
      );
      expect(thread.session.agent.steeringQueue.messages).toHaveLength(3);
      expect(thread.session.agent.steeringQueue.messages[2]).toMatchObject({
        role: "user",
        content: [{ type: "text", text: "Steer this one" }, selectedImage],
      });
      expect(thread.session.agent.followUpQueue.messages).toMatchObject([
        {
          role: "user",
          content: [{ type: "text", text: "First" }, firstImage],
        },
        {
          role: "user",
          content: [{ type: "text", text: "Third" }, thirdImage],
        },
      ]);

      const steeringBefore = [...thread.session.agent.steeringQueue.messages];
      const followUpBefore = [...thread.session.agent.followUpQueue.messages];
      await expect(
        host.steerQueuedFollowUp("thread-steer-item", 0, ["Stale first"]),
      ).rejects.toThrow("Queued follow-ups changed");
      expect(thread.session.agent.steeringQueue.messages).toEqual(
        steeringBefore,
      );
      expect(thread.session.agent.followUpQueue.messages).toEqual(
        followUpBefore,
      );
      expect(thread.session.getSteeringMessages()).toEqual([
        "Keep this steering message",
        "Steer this one",
      ]);
      expect(thread.session.getFollowUpMessages()).toEqual(["First", "Third"]);
    } finally {
      host.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a stale repeated-text snapshot before moving another image", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-queue-steer-stale-"));
    const workspacePath = join(root, "workspace");
    const agentDir = join(root, "agent");
    await mkdir(workspacePath);

    const host = new ArtemisAgentHost(
      { async request() {} },
      { emit() {} },
      { agentDir },
    );
    try {
      await host.openThread({
        threadId: "thread-steer-stale",
        workspacePath,
        target: "local",
      });
      const thread = queueTestThread(host, "thread-steer-stale");
      thread.currentTurnId = "turn-steer-stale-1";

      const images = ["QQ==", "Qg==", "Qw=="].map((data) => ({
        type: "image" as const,
        data,
        mimeType: "image/png",
      }));
      await thread.session.followUp("Repeat", [images[0]!]);
      await thread.session.followUp("Repeat", [images[1]!]);
      await thread.session.followUp("Repeat", [images[2]!]);
      const clickedQueueSnapshot = [...thread.session.getFollowUpMessages()];

      const firstMessage = thread.session.agent.followUpQueue.messages.shift();
      thread.session._followUpMessages.shift();
      const remainingMessages = [
        ...thread.session.agent.followUpQueue.messages,
      ];
      const steeringBefore = [...thread.session.agent.steeringQueue.messages];
      expect(firstMessage).toMatchObject({
        role: "user",
        content: [{ type: "text", text: "Repeat" }, images[0]],
      });

      await expect(
        host.steerQueuedFollowUp("thread-steer-stale", 1, clickedQueueSnapshot),
      ).rejects.toThrow("Queued follow-ups changed");

      expect(thread.session.agent.steeringQueue.messages).toEqual(
        steeringBefore,
      );
      expect(thread.session.agent.followUpQueue.messages).toEqual(
        remainingMessages,
      );
      expect(thread.session.agent.followUpQueue.messages).toMatchObject([
        {
          role: "user",
          content: [{ type: "text", text: "Repeat" }, images[1]],
        },
        {
          role: "user",
          content: [{ type: "text", text: "Repeat" }, images[2]],
        },
      ]);
      expect(thread.session.getFollowUpMessages()).toEqual([
        "Repeat",
        "Repeat",
      ]);
    } finally {
      host.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
