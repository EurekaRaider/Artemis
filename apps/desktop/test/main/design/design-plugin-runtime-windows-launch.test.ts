import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SandboxLaunch } from "@artemis/platform";
import { PluginRuntimeWorker } from "../../../src/main/design/design-plugin-runtime-worker.js";

afterEach(() => vi.unstubAllGlobals());

describe("Windows Design runtime launch", () => {
  for (const electron of [undefined, "42.0.0"]) {
    it(`preserves sandbox restrictions with ${electron ? "Electron" : "Node"}`, () => {
      const entry = realpathSync(import.meta.filename);
      const cwd = dirname(entry);
      vi.stubGlobal("process", {
        ...process,
        platform: "win32",
        arch: "x64",
        versions: { ...process.versions, electron },
      });
      const worker = new PluginRuntimeWorker({
        entry,
        cwd,
        windowsHelperPath: entry,
        pluginId: "test.plugin",
        contentHash: "test-hash",
      });
      const launch = (
        worker as unknown as { buildSandboxedLaunch(): SandboxLaunch }
      ).buildSandboxedLaunch();
      const args = JSON.parse(
        Buffer.from(
          launch.args[launch.args.indexOf("-ArgumentsBase64") + 1]!,
          "base64",
        ).toString("utf8"),
      ) as string[];
      expect(args.includes("--no-stdio-init")).toBe(Boolean(electron));
      expect(args).toContain("--preserve-symlinks-main");
      expect(args).toContain("--entry-url");
      expect(launch.implementation).toBe("windows-appcontainer");
      expect(launch.args).toContain("-DenyChildProcesses");
      expect(launch.args.at(-1)).toBe("deny");
      expect(launch.env?.ELECTRON_RUN_AS_NODE).toBe("1");
    });
  }
});
