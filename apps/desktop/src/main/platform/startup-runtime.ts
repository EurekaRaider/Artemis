import { join } from "node:path";
import { app } from "electron";
import { preparePackagedNodePtyRuntime } from "../terminal/node-pty-runtime.js";
import { configureNodePtyRuntime } from "../terminal/terminal-service.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "startupTiming"
  | "startupTimings"
  | "recordedStartupTimingCount"
  | "diagnosticBundleService"
  | "packagedNodePtyRuntimeReady"
  | "packagedNodePtyRuntime"
>;
export function createStartupRuntime(services: Dependencies) {
  const { startupTiming, startupTimings } = services;
  function markStartupStage(stage: string): void {
    startupTimings.push(startupTiming.mark(stage));
    while (
      services.diagnosticBundleService &&
      services.recordedStartupTimingCount < startupTimings.length
    ) {
      const timing = startupTimings[services.recordedStartupTimingCount];
      if (!timing) break;
      services.recordedStartupTimingCount += 1;
      services.diagnosticBundleService.record({
        source: "main",
        severity: "info",
        message: `Startup ${timing.stage}: ${timing.elapsedMs} ms total (+${timing.deltaMs} ms).`,
      });
    }
  }

  async function ensureNodePtyRuntime(): Promise<void> {
    if (process.platform !== "darwin" || !app.isPackaged) return;
    if (process.arch !== "arm64" && process.arch !== "x64") {
      throw new Error(
        `Packaged terminals do not support macOS ${process.arch}.`,
      );
    }
    services.packagedNodePtyRuntimeReady ??= preparePackagedNodePtyRuntime(
      join(
        process.resourcesPath,
        "app.asar.unpacked",
        "node_modules",
        "node-pty",
      ),
      process.arch,
    ).then((runtime) => {
      services.packagedNodePtyRuntime = runtime;
      configureNodePtyRuntime(runtime.moduleRoot);
      markStartupStage("terminal-runtime-ready");
    });
    return services.packagedNodePtyRuntimeReady;
  }
  return { markStartupStage, ensureNodePtyRuntime };
}
