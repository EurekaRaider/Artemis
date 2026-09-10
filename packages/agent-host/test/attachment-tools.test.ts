import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { ArtemisAgentHost } from "../src/runtime.js";
import type { BrokerExecutionRequest } from "@artemis/protocol";

describe("attachment tools policy", () => {
  it("registers brokered read-only tools in every mode without adding write or shell to Plan", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-attachment-tools-"));
    const requests: BrokerExecutionRequest[] = [];
    const host = new ArtemisAgentHost(
      {
        async request(request) {
          requests.push(request);
          return { approved: true, data: { attachments: [] } };
        },
      },
      { emit() {} },
    );
    try {
      await host.openThread({
        threadId: "task",
        workspacePath: root,
        target: "local",
      });
      const thread = (
        host as unknown as {
          threads: Map<
            string,
            {
              currentTurnId: string;
              currentMode: "plan" | "review" | "execute";
              delegatedTools: Array<{
                name: string;
                execute: (id: string, p: object) => Promise<unknown>;
              }>;
              executeTools: Array<{ name: string }>;
            }
          >;
        }
      ).threads.get("task")!;
      for (const tools of [thread.delegatedTools, thread.executeTools])
        expect(tools.map((t) => t.name)).toEqual(
          expect.arrayContaining([
            "attachment_list",
            "attachment_read",
            "attachment_search",
          ]),
        );
      expect(thread.delegatedTools.map((t) => t.name)).not.toEqual(
        expect.arrayContaining(["bash", "write"]),
      );
      thread.currentTurnId = "turn";
      for (const mode of ["plan", "review", "execute"] as const) {
        thread.currentMode = mode;
        await thread.delegatedTools
          .find((t) => t.name === "attachment_list")!
          .execute("read", {});
        expect(requests.at(-1)).toMatchObject({
          kind: "attachment.read",
          mode,
          threadId: "task",
          turnId: "turn",
        });
      }
    } finally {
      await host.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
