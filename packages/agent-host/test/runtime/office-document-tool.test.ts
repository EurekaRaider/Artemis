import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";
import { ArtemisAgentHost } from "../../src/runtime/runtime.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("Office document tool format inference", () => {
  it.each([
    ["Slides.PPTX", "powerpoint"],
    ["预算.xlsx", "excel"],
    ["Brief.docx", "word"],
  ])("opens %s without a redundant format parameter", async (path, format) => {
    const root = await mkdtemp(join(tmpdir(), "artemis-office-tool-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const request = vi.fn(async () => ({ approved: true, data: {} }));
    const host = new ArtemisAgentHost(
      { request },
      { emit() {} },
      { agentDir: join(root, "agent") },
    );
    cleanups.push(async () => host.dispose());
    await host.configure({ credentials: {}, officeEnabled: true });
    await host.openThread({
      threadId: "thread",
      workspacePath: root,
      target: "local",
    });
    const thread = (
      host as unknown as {
        threads: Map<
          string,
          {
            currentTurnId: string;
            currentMode: string;
            executeTools: Array<{
              name: string;
              parameters: TSchema;
              execute(id: string, params: unknown): Promise<unknown>;
            }>;
          }
        >;
      }
    ).threads.get("thread")!;
    thread.currentTurnId = "turn";
    thread.currentMode = "work";
    const tool = thread.executeTools.find(
      (entry) => entry.name === "office_document",
    )!;
    const params = {
      operation: "open",
      path,
      model_approval: {
        risk: "medium",
        explicit_user_request: true,
        reason: "Open the requested workspace document",
      },
    };
    expect(Value.Check(tool.parameters, params)).toBe(true);
    await tool.execute("call", params);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "office.document",
        mode: "work",
        document: expect.objectContaining({
          operation: "open",
          path,
          format,
          protocolVersion: 2,
        }),
      }),
    );
    await tool.execute("explicit", { ...params, format: "word" });
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({ format: "word" }),
      }),
    );
    // Uninstall must revoke direct calls from an already running turn too.
    await host.configure({ credentials: {}, officeEnabled: false });
    request.mockClear();
    await expect(tool.execute("stale", params)).rejects.toThrow(
      "Install the Office suite",
    );
    expect(request).not.toHaveBeenCalled();
  });
});

it("does not expose Office before the pack is installed", async () => {
  const root = await mkdtemp(join(tmpdir(), "artemis-office-disabled-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const broker = vi.fn(async () => ({ approved: true, data: {} }));
  const host = new ArtemisAgentHost(
    { request: broker },
    { emit() {} },
    { agentDir: join(root, "agent") },
  );
  cleanups.push(() => host.dispose());
  await host.openThread({
    threadId: "thread",
    workspacePath: root,
    target: "local",
  });
  const thread = (
    host as unknown as {
      threads: Map<
        string,
        {
          session: { getActiveToolNames(): string[] };
          executeTools: Array<{
            name: string;
            execute(id: string, params: unknown): Promise<unknown>;
          }>;
        }
      >;
    }
  ).threads.get("thread")!;
  expect(thread.session.getActiveToolNames()).not.toContain("office_document");
  const tool = thread.executeTools.find(
    (tool) => tool.name === "office_document",
  )!;
  await expect(
    tool.execute("direct", { operation: "read", path: "file.docx" }),
  ).rejects.toThrow("Install the Office suite");
  expect(broker).not.toHaveBeenCalled();
});
