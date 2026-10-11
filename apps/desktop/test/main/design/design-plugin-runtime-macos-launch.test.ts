import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { SandboxLaunch } from "@artemis/platform";
import { PluginRuntimeWorker } from "../../../src/main/design/design-plugin-runtime-worker.js";

afterEach(() => vi.unstubAllGlobals());

it.each(["arm64", "x64"])(
  "requires the same Seatbelt restrictions on macOS %s",
  (arch) => {
    const entry = realpathSync(import.meta.filename);
    const cwd = dirname(entry);
    vi.stubGlobal("process", { ...process, platform: "darwin", arch });
    const worker = new PluginRuntimeWorker({
      entry,
      cwd,
      // Inspect the launch plan without spawning a foreign-platform wrapper.
      sandboxExecutable: process.execPath,
      pluginId: "test.plugin",
      contentHash: "test-hash",
    });
    const launch = (
      worker as unknown as { buildSandboxedLaunch(): SandboxLaunch }
    ).buildSandboxedLaunch();
    expect(launch.implementation).toBe("macos-seatbelt");
    expect(launch.args[0]).toBe("-p");
    expect(launch.args[1]).toContain("(deny default)");
    expect(launch.args[1]).toContain("(deny network*)");
    expect(launch.args[1]).toContain("(deny process-fork)");
    expect(launch.args[1]).toContain("file-write*");
    expect(launch.cwd).toBe(cwd);
    expect(launch.env?.ELECTRON_RUN_AS_NODE).toBe("1");
  },
);

it.each(["ia32", "arm"])("refuses unsupported macOS %s", (arch) => {
  const entry = realpathSync(import.meta.filename);
  vi.stubGlobal("process", { ...process, platform: "darwin", arch });
  const worker = new PluginRuntimeWorker({
    entry,
    cwd: dirname(entry),
    sandboxExecutable: process.execPath,
    pluginId: "test.plugin",
    contentHash: "test-hash",
  });
  expect(() =>
    (
      worker as unknown as { buildSandboxedLaunch(): SandboxLaunch }
    ).buildSandboxedLaunch(),
  ).toThrow(/Refusing to start unsandboxed/u);
});
