import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TrustedExtensionStore } from "../src/main/trusted-extension-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("TrustedExtensionStore", () => {
  it("persists an explicit content hash without copying executable code", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-extension-"));
    temporaryDirectories.push(directory);
    const extensionPath = join(directory, "extension.mjs");
    const storePath = join(directory, "trusted-extensions.json");
    await writeFile(extensionPath, "export default () => {};\n", "utf8");

    const store = new TrustedExtensionStore(storePath);
    const trusted = await store.trust(extensionPath, {
      name: "Fixture",
      allowNetwork: false,
    });

    expect(trusted).toMatchObject({
      name: "Fixture",
      path: await realpath(extensionPath),
      enabled: true,
      allowNetwork: false,
    });
    expect(trusted.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.parse(await readFile(storePath, "utf8"))).toMatchObject({
      version: 1,
      extensions: [{ id: trusted.id, sha256: trusted.sha256 }],
    });
  });

  it("requires re-trust to update the approved hash", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-extension-"));
    temporaryDirectories.push(directory);
    const extensionPath = join(directory, "extension.ts");
    const store = new TrustedExtensionStore(join(directory, "trusted.json"));
    await writeFile(extensionPath, "export default () => {};\n", "utf8");
    const first = await store.trust(extensionPath);
    await writeFile(extensionPath, "export default async () => {};\n", "utf8");
    const second = await store.trust(extensionPath);

    expect(second.id).toBe(first.id);
    expect(second.sha256).not.toBe(first.sha256);
  });
});
