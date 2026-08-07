import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { TrustedExtensionManager } from "../src/main/trusted-extension-manager.js";
import { TrustedExtensionStore } from "../src/main/trusted-extension-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("TrustedExtensionManager", () => {
  it("passes local full access through discovery and each executable tool call", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "artemis-extension-access-"),
    );
    temporaryDirectories.push(directory);
    const extensionPath = join(directory, "extension.mjs");
    await writeFile(extensionPath, "export default () => {};\n", "utf8");
    const config = await new TrustedExtensionStore(
      join(directory, "trusted.json"),
    ).trust(extensionPath, { name: "Fixture" });
    const accessValues: unknown[] = [];
    const manager = new TrustedExtensionManager(
      "win32",
      "C:\\helper.ps1",
      "C:\\extension-worker.js",
      async (request, _config, _mode, localFullAccess) => {
        accessValues.push(localFullAccess);
        return request.type === "discover"
          ? {
              tools: [
                {
                  name: "greet",
                  label: "Greet",
                  description: "Greet somebody",
                  inputSchema: { type: "object", properties: {} },
                },
              ],
              unsupported: {
                handlers: 0,
                commands: 0,
                flags: 0,
                shortcuts: 0,
              },
            }
          : {
              content: [{ type: "text", text: "hello" }],
            };
      },
    );

    await (
      manager.refresh as (
        configs: (typeof config)[],
        workspacePath: string,
        localFullAccess: boolean,
      ) => Promise<unknown>
    )([config], directory, false);
    await (
      manager.call as (
        extensionId: string,
        toolName: string,
        argumentsValue: Record<string, unknown>,
        workspacePath: string,
        mode: "execute",
        localFullAccess: boolean,
      ) => Promise<unknown>
    )(config.id, "greet", {}, directory, "execute", false);
    await (
      manager.call as (
        extensionId: string,
        toolName: string,
        argumentsValue: Record<string, unknown>,
        workspacePath: string,
        mode: "execute",
        localFullAccess: boolean,
      ) => Promise<unknown>
    )(config.id, "greet", {}, directory, "execute", true);

    expect(accessValues).toEqual([false, false, true]);
  });

  it("discovers only hash-matched tools and executes them through its process factory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-extension-"));
    temporaryDirectories.push(directory);
    const extensionPath = join(directory, "extension.mjs");
    await writeFile(extensionPath, "export default () => {};\n", "utf8");
    const config = await new TrustedExtensionStore(
      join(directory, "trusted.json"),
    ).trust(extensionPath, { name: "Fixture" });
    const factory = vi.fn(async (request: { type: string }) =>
      request.type === "discover"
        ? {
            tools: [
              {
                name: "greet",
                label: "Greet",
                description: "Greet somebody",
                inputSchema: { type: "object", properties: {} },
              },
            ],
            unsupported: { handlers: 0, commands: 0, flags: 0, shortcuts: 0 },
          }
        : {
            content: [{ type: "text", text: "hello" }],
          },
    );
    const manager = new TrustedExtensionManager(
      "win32",
      "C:\\helper.ps1",
      "C:\\extension-worker.js",
      factory,
    );

    expect((await manager.refresh([config], directory))[0]).toMatchObject({
      state: "ready",
      tools: [{ toolName: "greet" }],
    });
    expect(
      await manager.call(config.id, "greet", {}, directory, "execute"),
    ).toEqual({ output: "hello", isError: false });
    await expect(
      manager.call(config.id, "greet", {}, directory, "plan"),
    ).rejects.toThrow("cannot execute");
  });

  it("invalidates tools when the approved file changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-extension-"));
    temporaryDirectories.push(directory);
    const extensionPath = join(directory, "extension.mjs");
    await writeFile(extensionPath, "export default () => {};\n", "utf8");
    const config = await new TrustedExtensionStore(
      join(directory, "trusted.json"),
    ).trust(extensionPath);
    const manager = new TrustedExtensionManager(
      "darwin",
      undefined,
      "/extension-worker.js",
      async () => ({
        tools: [],
        unsupported: { handlers: 0, commands: 0, flags: 0, shortcuts: 0 },
      }),
    );

    await writeFile(extensionPath, "export default async () => {};\n", "utf8");
    expect((await manager.refresh([config], directory))[0]).toMatchObject({
      state: "changed",
      tools: [],
    });
  });
});
