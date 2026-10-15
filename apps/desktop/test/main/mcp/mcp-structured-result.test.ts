import { afterEach, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { callMcpClientTool } from "../../../src/main/mcp/mcp-client-manager.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture(
  result: Record<string, unknown>,
  outputSchema?: Record<string, unknown>,
) {
  const client = new Client({ name: "test", version: "1" });
  const server = new Server(
    { name: "test", version: "1" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "value",
        inputSchema: { type: "object" },
        ...(outputSchema ? { outputSchema } : {}),
      },
    ],
  }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  // Emit the newer protocol envelope directly: this SDK's server still enforces
  // object-only structured content. The client remains entirely real.
  const onMessage = b.onmessage!;
  b.onmessage = (message, extra) => {
    if (
      "method" in message &&
      message.method === "tools/call" &&
      "id" in message
    ) {
      void b.send({ jsonrpc: "2.0", id: message.id, result });
    } else onMessage(message, extra);
  };
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  await client.listTools();
  return client;
}
it.each([null, false, 0, "", [1, false, null], { value: 42 }])(
  "keeps JSON value %j through real MCP SDK validation",
  async (structuredContent) => {
    const client = await fixture({ content: [], structuredContent });
    expect(
      await callMcpClientTool(client, { name: "value", arguments: {} }),
    ).toEqual({ content: [], structuredContent, isError: false });
  },
);
it("distinguishes omitted content and preserves error results", async () => {
  const client = await fixture({
    content: [{ type: "text", text: "failed" }],
    isError: true,
  });
  const result = await callMcpClientTool(client, {
    name: "value",
    arguments: {},
  });
  expect(result).not.toHaveProperty("structuredContent");
  expect(result.isError).toBe(true);
});
it("retains declared output-schema validation", async () => {
  const client = await fixture(
    { content: [], structuredContent: { value: "wrong" } },
    {
      type: "object",
      properties: { value: { type: "number" } },
      required: ["value"],
    },
  );
  await expect(
    callMcpClientTool(client, { name: "value", arguments: {} }),
  ).rejects.toThrow(/output schema/);
});
it("rejects malformed content envelopes", async () => {
  const client = await fixture({
    content: [{ type: "text", text: 3 }],
    structuredContent: false,
  });
  await expect(
    callMcpClientTool(client, { name: "value", arguments: {} }),
  ).rejects.toThrow();
});
it("does not dispatch an already cancelled call", async () => {
  const client = await fixture({ content: [], structuredContent: 0 });
  const controller = new AbortController();
  controller.abort();
  await expect(
    callMcpClientTool(
      client,
      { name: "value", arguments: {} },
      controller.signal,
    ),
  ).rejects.toThrow();
});
