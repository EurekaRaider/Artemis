import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { COMPUTER_USE_META } from "@artemis/protocol";
import { ComputerMcpServer } from "../../../src/main/computer-use/mcp-server.js";
import {
  ComputerUseService,
  type ComputerDriver,
} from "../../../src/main/computer-use/service.js";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const driver: ComputerDriver = {
    targets: async () => [],
    open: async () => ({ id: "browser:1", kind: "browser", name: "Fixture" }),
    observe: async () => ({
      revision: "1",
      width: 400,
      height: 300,
      elements: [],
      image: { data: "YWJj", mimeType: "image/jpeg" },
    }),
    act: async () => {},
    release: async () => {},
  };
  const service = new ComputerUseService({
    drivers: { browser: driver, desktop: driver },
    authorize: async () => true,
    publish: () => {},
  });
  const server = new ComputerMcpServer(service);
  cleanups.push(() => server.dispose());
  const connection = await server.start();
  const client = new Client({ name: "test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(connection.url), {
      requestInit: {
        headers: { Authorization: `Bearer ${connection.bearerToken}` },
      },
    }) as Parameters<Client["connect"]>[0],
  );
  cleanups.push(() => client.close());
  return { ...connection, client, server, driver };
}
describe("private Computer Use MCP transport", () => {
  it("marks failed verification as an error while retaining the fresh observation", async () => {
    const f = await fixture();
    f.driver.observe = async () => ({
      revision: "1",
      width: 400,
      height: 300,
      elements: [{ id: "field", role: "textbox", label: "Name", value: "" }],
    });
    const context = {
      threadId: "thread",
      turnId: "turn",
      mode: "work" as const,
    };
    const call = (name: string, args: Record<string, unknown>) =>
      f.client.callTool({
        name,
        arguments: args,
        _meta: f.server.authorize(context, name, args).metadata,
      });
    const opened = await call("computer_open", { target: "browser" });
    const observation = JSON.parse(
      (opened.content as Array<{ type: string; text: string }>).find(
        (c) => c.type === "text",
      )!.text,
    );
    const result = await call("computer_act", {
      targetId: observation.target.id,
      observationId: observation.observationId,
      actions: [{ type: "fill", elementId: "field", text: "Expected" }],
    });
    expect(result.isError).toBe(true);
    const updated = JSON.parse(
      (result.content as Array<{ type: string; text: string }>).find(
        (c) => c.type === "text",
      )!.text,
    );
    expect(updated).toMatchObject({
      status: "partial",
      attempted: 1,
      completed: 0,
      remaining: 1,
      stopped: "verification-failed",
    });
    expect(updated.observationId).not.toBe(observation.observationId);
  });
  it("requires loopback authentication and rejects browser-origin requests", async () => {
    const f = await fixture();
    expect((await fetch(f.url, { method: "POST" })).status).toBe(401);
    expect(
      (
        await fetch(f.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${f.bearerToken}`,
            Origin: "https://evil.test",
          },
        })
      ).status,
    ).toBe(401);
    expect((await f.client.listTools()).tools).toHaveLength(6);
  });
  it("requires a one-use host grant bound to the exact tool and arguments", async () => {
    const f = await fixture();
    await expect(
      f.client.callTool({ name: "computer_status", arguments: {} }),
    ).rejects.toThrow(/host-approved/);
    const args = { target: "browser" };
    const grant = f.server.authorize(
      { threadId: "thread", turnId: "turn", mode: "work" },
      "computer_open",
      args,
    );
    await expect(
      f.client.callTool({
        name: "computer_open",
        arguments: { target: "other" },
        _meta: grant.metadata,
      }),
    ).rejects.toThrow(/host-approved/);
    const result = await f.client.callTool({
      name: "computer_open",
      arguments: args,
      _meta: grant.metadata,
    });
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "image", mimeType: "image/jpeg" }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain(
      grant.metadata[COMPUTER_USE_META],
    );
    await expect(
      f.client.callTool({
        name: "computer_open",
        arguments: args,
        _meta: grant.metadata,
      }),
    ).rejects.toThrow(/host-approved/);
  });
});
