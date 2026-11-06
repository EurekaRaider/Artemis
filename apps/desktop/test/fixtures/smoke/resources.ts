import { mcpConfigStore } from "../../../src/main/main.js";
import { smokeMode } from "./environment.js";

export async function seedSmokeMcpEditorFixture(): Promise<void> {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  // The smokeMode guard matches the IPC interception gates above: seeding
  // must stay a smoke-harness-only behavior so a merely VIEW-tagged process
  // can never write a synthetic server into a real mcp.json.
  if (
    !smokeMode ||
    !mcpConfigStore ||
    (!view?.startsWith("mcp-editor") && view !== "nocturne-resources-mcp")
  ) {
    return;
  }
  // Synthetic identity only: the URL uses the reserved .test TLD and the
  // bearer credential stays unset, so no real endpoint, account, or secret
  // can ever enter the seeded snapshot. enabled stays false because
  // initializeOptionalCapabilities only auto-connects enabled servers — the
  // seeded fixture therefore performs zero dial-out at startup.
  await mcpConfigStore.upsert({
    id: "artemis-smoke-remote",
    name: "Artemis Smoke Remote",
    transport: "streamable-http",
    enabled: false,
    url: "https://mcp.artemis-smoke.example.test/mcp",
    auth: "bearer",
  });
  // Second synthetic seed (PR8 review F3): a stdio server so the Electron
  // drift coverage exercises command-transport arguments, not only the HTTP
  // URL. The command is a path that cannot exist and enabled stays false, so
  // the fixture performs zero spawn and zero dial-out at startup. The empty
  // workspace is synthesized by the store inside the isolated user-data
  // directory (McpConfigStore.withDefaultWorkspace).
  await mcpConfigStore.upsert({
    id: "artemis-smoke-local",
    name: "Artemis Smoke Local",
    transport: "stdio",
    enabled: false,
    command: "/artemis-smoke-mcp-editor/stdio-server",
    args: ["--smoke"],
    env: {},
    envVars: [],
    workspacePath: "",
    allowNetwork: false,
  });
}

export async function seedSmokeIconSizingFixture(): Promise<void> {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  // The smokeMode guard matches seedSmokeMcpEditorFixture: seeding must stay
  // a smoke-harness-only behavior so a merely VIEW-tagged process can never
  // write a synthetic server into a real mcp.json.
  if (!smokeMode || !view?.startsWith("icon-sizing-")) {
    return;
  }
  if (!mcpConfigStore) {
    throw new Error("MCP service is not ready.");
  }
  // Synthetic identity only (mcp-editor seed precedent): a stdio command
  // path that cannot exist and enabled:false, so the seeded row performs
  // zero spawn and zero dial-out at startup. The Resource Center manage
  // view renders this row's ResourceAvatar with the semantic icon, which is
  // the .resource-avatar .resource-semantic-icon sizing surface this smoke
  // measures.
  await mcpConfigStore.upsert({
    id: "artemis-smoke-icon-sizing",
    name: "Artemis Smoke Icon Sizing",
    transport: "stdio",
    enabled: false,
    command: "/artemis-smoke-icon-sizing/stdio-server",
    args: ["--smoke"],
    env: {},
    envVars: [],
    workspacePath: "",
    allowNetwork: false,
  });
}
