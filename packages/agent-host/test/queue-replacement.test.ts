import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ArtemisAgentHost } from "../src/runtime.js";

describe("follow-up queue replacement", () => {
  it("keeps steering messages and replaces follow-ups in the requested order", async () => {
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
      const thread = (
        host as unknown as {
          threads: Map<
            string,
            {
              currentTurnId?: string;
              session: {
                clearQueue(): { steering: string[]; followUp: string[] };
                followUp(text: string): Promise<void>;
                steer(text: string): Promise<void>;
              };
            }
          >;
        }
      ).threads.get("thread-queue")!;
      thread.currentTurnId = "turn-queue-1";
      const calls: string[] = [];
      thread.session.clearQueue = () => ({
        steering: ["Keep this steering message"],
        followUp: ["Discard this follow-up"],
      });
      thread.session.steer = async (message) => {
        calls.push(`steer:${message}`);
      };
      thread.session.followUp = async (message) => {
        calls.push(`follow-up:${message}`);
      };

      await host.replaceFollowUpQueue("thread-queue", ["First", "Second"]);

      expect(calls).toEqual([
        "steer:Keep this steering message",
        "follow-up:First",
        "follow-up:Second",
      ]);
    } finally {
      host.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
