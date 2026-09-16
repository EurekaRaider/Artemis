import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceReadTool } from "../src/workspace-read-tool.js";
import { ArtemisAgentHost } from "../src/runtime.js";

const roots: string[] = [];
async function fixture(text: string) {
  const root = await mkdtemp(join(tmpdir(), "artemis-bounded-read-"));
  roots.push(root);
  await writeFile(join(root, "sample.log"), text);
  const tool = createWorkspaceReadTool(root);
  return (
    params: { path?: string; offset?: number; limit?: number } = {},
    signal?: AbortSignal,
  ) => tool.execute("call", { path: "sample.log", ...params }, signal);
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("bounded workspace read", () => {
  it("uses the bounded reader in the host's read-only and execute tool sets", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-host-read-"));
    roots.push(root);
    await writeFile(join(root, "sample.log"), "log entry\n".repeat(300_000));
    const host = new ArtemisAgentHost(
      {
        async request() {
          throw new Error("Read must not execute a broker mutation");
        },
      },
      { emit() {} },
    );
    try {
      await host.openThread({
        threadId: "read-test",
        workspacePath: root,
        target: "local",
      });
      const thread = (
        host as unknown as {
          threads: Map<
            string,
            {
              delegatedTools: ReturnType<typeof createWorkspaceReadTool>[];
              executeTools: ReturnType<typeof createWorkspaceReadTool>[];
            }
          >;
        }
      ).threads.get("read-test")!;
      for (const tools of [thread.delegatedTools, thread.executeTools]) {
        const read = tools.find((tool) => tool.name === "read")!;
        const result = await read.execute("read", { path: "sample.log" });
        expect(result.details.nextOffset).toBe(16384);
        expect(JSON.stringify(result.content).length).toBeLessThan(20000);
      }
    } finally {
      host.dispose();
    }
  });

  it("keeps small file results unchanged", async () => {
    const read = await fixture("hello\n你好\n");
    const result = await read();
    expect(result.content).toEqual([{ type: "text", text: "hello\n你好\n" }]);
    expect(result.details.nextOffset).toBeUndefined();
  });

  it("caps a multi-megabyte single-line log even when a caller requests a larger limit", async () => {
    const read = await fixture("x".repeat(8 * 1024 * 1024));
    for (const params of [{}, { limit: 100_000_000 }]) {
      const result = await read(params);
      expect(result.details.bytesRead).toBe(16384);
      expect(result.details.nextOffset).toBe(16384);
      expect(JSON.stringify(result.content).length).toBeLessThan(17000);
      expect(result.content[0]).toMatchObject({
        text: expect.stringContaining("nextOffset=16384"),
      });
    }
  });

  it("round-trips Chinese and emoji across byte boundaries without omissions or duplication", async () => {
    const original = "abc你好😀世界🌍\n".repeat(8);
    const read = await fixture(original);
    let offset = 0;
    let reconstructed = "";
    for (let page = 0; page < 100; page++) {
      const result = await read({ offset, limit: 7 });
      const block = result.content[0]!;
      if (block.type !== "text") throw new Error("Expected text");
      reconstructed += block.text.split("\n[Partial file:")[0];
      if (result.details.nextOffset === undefined) break;
      expect(result.details.nextOffset).toBeGreaterThan(offset);
      offset = result.details.nextOffset;
    }
    expect(reconstructed).toBe(original);
  });

  it("handles empty files and EOF without continuation loops", async () => {
    const read = await fixture("");
    for (const offset of [0, 100]) {
      const result = await read({ offset });
      expect(result.details.nextOffset).toBeUndefined();
      expect(result.content).toEqual([{ type: "text", text: "" }]);
    }
  });

  it("rejects invalid ranges, directories and workspace escapes", async () => {
    const read = await fixture("text");
    for (const params of [
      { offset: -1 },
      { offset: 0.5 },
      { limit: 0 },
      { path: "." },
      { path: "../outside.log" },
    ])
      await expect(read(params)).rejects.toThrow();
  });

  it("honors cancellation before reading", async () => {
    const read = await fixture("text");
    const controller = new AbortController();
    controller.abort();
    await expect(read({}, controller.signal)).rejects.toThrow();
  });
});
