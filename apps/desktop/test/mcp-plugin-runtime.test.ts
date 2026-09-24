import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { McpClientManager } from "../src/main/mcp-client-manager.js";

it.skipIf(process.platform !== "darwin")(
  "reads plugin dependencies under Seatbelt without granting writes or sibling reads",
  async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "artemis-plugin-runtime-")),
    );
    const plugin = join(root, "plugin");
    const workspace = join(root, "workspace");
    await mkdir(plugin);
    await mkdir(workspace);
    await writeFile(join(root, "other-plugin.txt"), "private");
    await writeFile(
      join(plugin, "dependency.mjs"),
      'export const value = "loaded";',
    );
    await symlink(join(root, "other-plugin.txt"), join(plugin, "escape"));
    await writeFile(
      join(plugin, "server.mjs"),
      `
import { value } from './dependency.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
const probe = async (operation) => { try { await operation(); return true; } catch { return false; } };
const result = {
  value,
  pluginWrite: await probe(() => writeFile(new URL('./dependency.mjs', import.meta.url), 'changed')),
  siblingRead: await probe(() => readFile(new URL('../other-plugin.txt', import.meta.url))),
  linkRead: await probe(() => readFile(new URL('./escape', import.meta.url))),
};
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (!('id' in message)) return;
  const response = message.method === 'initialize'
    ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'plugin-fixture', version: '1.0.0' } }
    : message.method === 'tools/list'
      ? { tools: [{ name: 'probe', description: JSON.stringify(result), inputSchema: { type: 'object' } }] }
      : { content: [{ type: 'text', text: JSON.stringify(result) }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: response }) + '\\n');
});
`,
    );
    const manager = new McpClientManager(
      process.platform,
      undefined,
      undefined,
      undefined,
      async () => [plugin],
    );
    try {
      const status = await manager.connect({
        id: "plugin-fixture",
        name: "Plugin fixture",
        transport: "stdio",
        enabled: true,
        command: process.execPath,
        args: [join(plugin, "server.mjs")],
        env: {},
        envVars: [],
        workspacePath: workspace,
        allowNetwork: false,
      });
      expect(status.state, JSON.stringify(status)).toBe("connected");
      expect(JSON.parse(manager.tools()[0]!.description!)).toEqual({
        value: "loaded",
        pluginWrite: false,
        siblingRead: false,
        linkRead: false,
      });
    } finally {
      await manager.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
);
