import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GlobalInstructionsStore } from "../src/main/global-instructions-store.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  for (const path of cleanupPaths.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), "artemis-agents-"));
  cleanupPaths.push(directory);
  const filePath = join(directory, "AGENTS.md");
  return {
    filePath,
    store: new GlobalInstructionsStore(filePath),
  };
}

describe("GlobalInstructionsStore", () => {
  it("creates a real editable AGENTS.md without inventing default rules", async () => {
    const { filePath, store } = await createStore();

    expect(await store.snapshot()).toEqual({
      path: filePath,
      content: "",
    });

    await store.save("# Global rules\n\nUse small changes.\n");

    expect(await readFile(filePath, "utf8")).toBe(
      "# Global rules\n\nUse small changes.\n",
    );
    expect(await store.snapshot()).toEqual({
      path: filePath,
      content: "# Global rules\n\nUse small changes.\n",
    });
  });

  it("rejects oversized global instructions", async () => {
    const { store } = await createStore();

    await expect(store.save("x".repeat(1024 * 1024 + 1))).rejects.toThrow(
      "1 MiB",
    );
  });
});
