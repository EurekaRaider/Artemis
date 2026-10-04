import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { McpClientManager } from "../src/main/mcp-client-manager.js";
import type { McpServerConfig } from "../src/shared/api.js";

it.runIf(process.platform === "darwin")(
  "temporarily leaves Seatbelt for one MCP read without inheriting the host environment",
  async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "artemis-escalation-native-")),
    );
    const workspacePath = join(root, "workspace");
    const runtimePath = join(root, "runtime");
    const outsidePath = join(root, "outside.txt");
    const scriptPath = join(runtimePath, "server.mjs");
    const sentinel = "ARTEMIS_ESCALATION_TEST_SENTINEL";
    const previous = process.env[sentinel];
    process.env[sentinel] = "synthetic-host-only-value";
    const manager = new McpClientManager(
      "darwin",
      undefined,
      undefined,
      10_000,
    );
    try {
      await mkdir(workspacePath);
      await mkdir(runtimePath);
      await writeFile(outsidePath, "SYNTHETIC_OUTSIDE_FILE");
      await writeFile(
        scriptPath,
        `
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
createInterface({ input: process.stdin }).on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result;
  if (message.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } };
  else if (message.method === "tools/list") result = { tools: [{ name: "read", inputSchema: { type: "object", properties: { path: { type: "string" } } }, annotations: { readOnlyHint: true } }] };
  else if (message.method === "tools/call") {
    try {
      const data = await readFile(message.params.arguments.path, "utf8");
      result = { content: [{ type: "text", text: JSON.stringify({ data, pid: process.pid, inherited: process.env.ARTEMIS_ESCALATION_TEST_SENTINEL ?? null, configured: process.env.ARTEMIS_ESCALATION_EXPLICIT }) }] };
    } catch (error) { result = { isError: true, content: [{ type: "text", text: error.code + ": " + error.message }] }; }
  } else result = {};
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
});
`,
      );
      const config: McpServerConfig = {
        id: "fixture",
        name: "Fixture",
        enabled: true,
        transport: "stdio",
        command: process.execPath,
        args: [scriptPath],
        env: { ARTEMIS_ESCALATION_EXPLICIT: "forwarded" },
        envVars: [],
        workspacePath: runtimePath,
        allowNetwork: false,
      };
      const status = await manager.connect(config);
      expect(status.state, status.error).toBe("connected");
      const normal = await manager.call(
        "fixture",
        "read",
        { path: outsidePath },
        workspacePath,
        "work",
      );
      expect(normal.isError).toBe(true);
      expect(JSON.stringify(normal.content)).toMatch(/EACCES|EPERM/u);
      const elevated = await manager.call(
        "fixture",
        "read",
        { path: outsidePath },
        workspacePath,
        "codemode",
        undefined,
        undefined,
        true,
      );
      expect(elevated.isError).toBe(false);
      const block = elevated.content.find((item) => item.type === "text");
      const output = JSON.parse(block?.type === "text" ? block.text : "{}");
      expect(output).toMatchObject({
        data: "SYNTHETIC_OUTSIDE_FILE",
        inherited: null,
        configured: "forwarded",
      });
      expect(() => process.kill(output.pid, 0)).toThrow();
      const again = await manager.call(
        "fixture",
        "read",
        { path: outsidePath },
        workspacePath,
        "work",
      );
      expect(again.isError).toBe(true);
      expect(config.fullAccess).toBeUndefined();
    } finally {
      await manager.dispose();
      if (previous === undefined) delete process.env[sentinel];
      else process.env[sentinel] = previous;
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
