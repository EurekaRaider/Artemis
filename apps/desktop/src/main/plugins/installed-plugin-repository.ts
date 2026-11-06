import { validateStoredPlugin } from "./plugin-validation.js";

import { readJson } from "./plugin-files.js";
import { record } from "./plugin-values.js";

import type { PluginStore } from "./plugin-types.js";

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { PluginServiceDependencies } from "./plugin-service-dependencies.js";
export function createInstalledPluginRepository(
  services: Pick<
    PluginServiceDependencies,
    "operation" | "state" | "installTransaction" | "options"
  >,
) {
  async function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const previous = services.operation;
    let release!: () => void;
    services.operation = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }

  async function loadStore(): Promise<PluginStore> {
    if (services.state) return services.state;
    await services.installTransaction().recover();
    if (services.state) return services.state;
    try {
      const input = record(
        await readJson(services.options.statePath, 5 * 1024 * 1024),
      );
      if (input?.version !== 1 || !Array.isArray(input.plugins)) {
        throw new Error("Installed plugin store is invalid.");
      }
      services.state = {
        version: 1,
        plugins: input.plugins.map(validateStoredPlugin),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      services.state = { version: 1, plugins: [] };
    }
    return services.state;
  }

  async function saveStore(value: PluginStore): Promise<void> {
    await mkdir(dirname(services.options.statePath), { recursive: true });
    const temporaryPath = `${services.options.statePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, undefined, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, services.options.statePath);
    services.state = value;
  }
  const handlers = { exclusive, loadStore, saveStore };
  return handlers;
}
