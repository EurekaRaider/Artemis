import { build } from "esbuild";
import { parsers } from "prettier/plugins/typescript";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { desktopMainEntry } from "../../scripts/build/electron-entrypoints.mjs";

const desktop = fileURLToPath(new URL("../../", import.meta.url));
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(directory, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(directory, entry.name)]
        : [],
  );
}

describe("production and verification entrypoint isolation", () => {
  it("bundles the shipped main entry without fixtures or verification drivers", async () => {
    const result = await build({
      absWorkingDir: desktop,
      entryPoints: [desktopMainEntry(true)],
      bundle: true,
      write: false,
      metafile: true,
      packages: "external",
      platform: "node",
      format: "esm",
      logLevel: "silent",
    });
    const inputs = Object.keys(result.metafile!.inputs);
    expect(inputs.some((path) => path.endsWith("src/main/main.ts"))).toBe(true);
    expect(
      inputs.filter((path) =>
        /(^|\/)(test|tests|fixtures)\/|scripts\/verify\//.test(path),
      ),
    ).toEqual([]);
    expect(result.outputFiles[0]!.text).not.toContain(
      "Simulated MCP server save failure.",
    );
    expect(result.outputFiles[0]!.text).not.toContain("artemis-smoke-project");
  });
  it.each([
    "src/shared/connector-types.ts",
    "src/shared/oauth-contracts.ts",
    "src/main/updates/update-contracts.ts",
    "src/main/conversation/attachment-work.ts",
    "../../packages/gateway/src/runtime/routing-contracts.ts",
  ])("keeps neutral contracts free of runtime imports: %s", async (entry) => {
    const result = await build({
      entryPoints: [join(desktop, entry)],
      bundle: true,
      write: false,
      metafile: true,
      packages: "external",
      platform: "node",
      format: "esm",
      logLevel: "silent",
    });
    const inputs = Object.values(result.metafile!.inputs);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.imports).toEqual([]);
  });
  it("keeps production application owners free of smoke scenarios and fixture imports", () => {
    const files = sources(join(desktop, "src/main"));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // The bootstrap strips untrusted development environment flags in a
      // packaged app. That security gate is intentionally retained.
      if (!file.endsWith("bootstrap-application.ts"))
        expect(source, file).not.toMatch(
          /ARTEMIS_SMOKE_|seedSmoke|driveSmoke|Simulated .*failure/,
        );
      expect(source, file).not.toMatch(
        /(?:from|import\()\s*["'][^"']*(?:test\/fixtures|scripts\/verify)/,
      );
    }
  });
  it("keeps IPC registration and Electron lifecycle wiring out of the composition root", () => {
    const main = readFileSync(join(desktop, "src/main/main.ts"), "utf8");
    expect(main).not.toMatch(
      /ipcMain\.(?:handle|on|once)\s*\(|app\.on\s*\(|new BrowserWindow\s*\(/,
    );
    for (const file of sources(join(desktop, "src/main"))) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(
        /import\s+(?!type\b)[^;]*from\s+["'][^"']*main\.js["']/,
      );
    }
  });
  it("keeps task execution, sessions, goals and broker functions as composition delegates", () => {
    const main = readFileSync(join(desktop, "src/main/main.ts"), "utf8");
    const ast = parsers.typescript.parse(main, {}) as any;
    for (const name of [
      "startTaskTurn",
      "startTaskTurnUnchecked",
      "openAgentThread",
      "createTaskThread",
      "scheduleGoalContinuation",
      "handleGoalBrokerRequest",
      "handleBrokerRequest",
      "resolveApproval",
      "emitPayload",
      "emitPayloadBatch",
    ]) {
      const fn = ast.body
        .map((node: any) => node.declaration ?? node)
        .find((node: any) => node.id?.name === name);
      expect(fn?.body.body, name).toHaveLength(1);
      expect(fn.body.body[0].type, name).toBe("ReturnStatement");
      expect(fn.body.body[0].argument?.callee.type, name).toBe(
        "MemberExpression",
      );
    }
  });
  it("keeps extracted UI owners outside the application component", () => {
    const app = readFileSync(join(desktop, "src/renderer/app/App.tsx"), "utf8");
    expect(app).not.toMatch(
      /function (?:Timeline|ChildAgentPanel|AgentTeamPanel|ToolActivityGroupCard)\s*\(/,
    );
    expect(app).not.toMatch(/<(?:NavigationSidebar|WorkspaceDock)[\s>]/);
    expect(app).toContain("useSidebarNavigation(projectSidebar)");
  });
});
