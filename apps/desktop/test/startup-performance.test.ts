import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const mainSource = source("../src/main/main.ts");
const preloadSource = source("../src/preload/preload.ts");
const resourceCenterSource = source("../src/renderer/ResourceCenter.tsx");
const apiSource = source("../src/shared/api.ts");
const packageJson = JSON.parse(source("../package.json")) as {
  build: {
    mac?: { artifactName?: string };
    nsis?: unknown;
    portable?: unknown;
    win?: { artifactName?: string };
  };
};

describe("desktop startup latency guardrails", () => {
  it("creates the renderer without awaiting Agent runtime warm-up", () => {
    const startup = mainSource.slice(mainSource.indexOf("app\n  .whenReady()"));
    const warmup = startup.indexOf("agentRuntimeReady = applyAgentRuntime();");
    const createWindow = startup.indexOf("mainWindow = createMainWindow();");

    expect(warmup).toBeGreaterThanOrEqual(0);
    expect(createWindow).toBeGreaterThan(warmup);
    expect(startup.slice(warmup, createWindow)).not.toContain(
      "await agentRuntimeReady",
    );
    expect(startup).not.toContain("await applyAgentRuntime();");
  });

  it("loads installed MCP configuration without waiting for full settings", () => {
    expect(apiSource).toContain(
      "listMcpServers(): Promise<McpServerStatus[]>;",
    );
    expect(apiSource).toContain('resourceMcpList: "artemis:resource-mcp-list"');
    expect(preloadSource).toContain(
      "listMcpServers: () => ipcRenderer.invoke(IPC.resourceMcpList)",
    );
    expect(mainSource).toContain("IPC.resourceMcpList");
    expect(mainSource).toContain("getMcpServerStatuses()");
    const mcpStatusLoader = mainSource.slice(
      mainSource.indexOf("async function getMcpServerStatuses"),
      mainSource.indexOf("async function installedSkillsWithState"),
    );
    expect(mcpStatusLoader).not.toContain("optionalCapabilitiesReady");
    expect(mcpStatusLoader).not.toContain("agentRuntimeReady");
    expect(resourceCenterSource).toContain(".listMcpServers()");
    expect(resourceCenterSource).toContain("const [mcpServers, setMcpServers]");
    expect(resourceCenterSource).toContain("const visibleMcp = mcpServers");
    expect(resourceCenterSource).toContain(
      '(server) => server.config.resourceKind !== "connector"',
    );
    expect(resourceCenterSource).toContain("visibleMcp.map((server)");
  });

  it("ships Windows as an archive without installer wrappers", () => {
    expect(packageJson.build.nsis).toBeUndefined();
    expect(packageJson.build.portable).toBeUndefined();
  });

  it("includes the platform and architecture in package artifact names", () => {
    expect(packageJson.build.mac?.artifactName).toBe(
      "Artemis-macOS-${arch}-${version}.${ext}",
    );
    expect(packageJson.build.win?.artifactName).toBe(
      "Artemis-Windows-${arch}-${version}.${ext}",
    );
  });
});
