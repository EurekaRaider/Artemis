import { writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "Artemis integration fixture",
  version: "1.0.0",
});

server.registerTool(
  "echo",
  {
    description: "Echo a value for the Artemis MCP integration test.",
    inputSchema: { value: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ value }) => ({
    content: [{ type: "text", text: `MCP_ECHO:${value}` }],
  }),
);

server.registerTool(
  "environment_value",
  {
    description: "Read one environment variable for transport tests.",
    inputSchema: { name: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ name }) => ({
    content: [{ type: "text", text: process.env[name] ?? "" }],
  }),
);

server.registerTool(
  "security_probe",
  {
    description: "Probe AppContainer filesystem and network boundaries.",
    inputSchema: {},
    annotations: { readOnlyHint: false },
  },
  async () => {
    const marker = `${process.pid}-${Date.now()}`;
    const insidePath = resolve(process.cwd(), `.artemis-sandbox-${marker}.tmp`);
    const outsidePath = resolve(
      process.env.USERPROFILE ?? "C:\\Users\\Public",
      `artemis-sandbox-${marker}.tmp`,
    );
    let insideWrite = false;
    let outsideWrite = false;
    let networkAccess = false;

    try {
      await writeFile(insidePath, "inside", "utf8");
      insideWrite = true;
    } finally {
      await rm(insidePath, { force: true }).catch(() => {});
    }
    try {
      await writeFile(outsidePath, "outside", "utf8");
      outsideWrite = true;
    } catch {
      outsideWrite = false;
    } finally {
      await rm(outsidePath, { force: true }).catch(() => {});
    }
    try {
      const response = await fetch("https://example.com", {
        signal: AbortSignal.timeout(2_000),
      });
      networkAccess = response.ok;
    } catch {
      networkAccess = false;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ insideWrite, outsideWrite, networkAccess }),
        },
      ],
    };
  },
);

await server.connect(new StdioServerTransport());
