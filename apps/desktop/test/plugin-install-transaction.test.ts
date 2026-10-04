import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginInstallTransaction } from "../src/main/plugin-install-transaction.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "plugin-transaction-"));
  roots.push(root);
  const statePath = join(root, "state.json");
  const journalPath = join(root, "journal.json");
  const move = {
    destination: join(root, "plugin"),
    stage: join(root, "stage"),
    backup: join(root, "backup"),
    existed: true,
  };
  const previousStore = { plugins: ["old"] },
    nextStore = { plugins: ["new"] };
  let mcp = "old";
  const service = new PluginInstallTransaction({
    statePath,
    journalPath,
    roots: [root],
    saveStore: async (value: typeof previousStore) => {
      await writeFile(statePath, JSON.stringify(value));
    },
    saveMcp: async (value: string) => {
      mcp = value;
    },
  });
  await writeFile(statePath, JSON.stringify(previousStore));
  return {
    root,
    statePath,
    journalPath,
    move,
    previousStore,
    nextStore,
    service,
    mcp: () => mcp,
  };
}
it("recovers interrupted directory moves before the primary store commit", async () => {
  const f = await fixture();
  await mkdir(f.move.backup);
  await writeFile(join(f.move.backup, "value"), "old");
  await mkdir(f.move.destination);
  await writeFile(join(f.move.destination, "value"), "new");
  await writeFile(
    f.journalPath,
    JSON.stringify({
      version: 1,
      committed: false,
      moves: [f.move],
      previousStore: f.previousStore,
      nextStore: f.nextStore,
      previousMcp: "old",
    }),
  );
  await f.service.recover();
  expect(await readFile(join(f.move.destination, "value"), "utf8")).toBe("old");
  expect(JSON.parse(await readFile(f.statePath, "utf8"))).toEqual(
    f.previousStore,
  );
  await expect(readFile(f.journalPath)).rejects.toMatchObject({
    code: "ENOENT",
  });
  await f.service.recover();
});
it("rolls back a store write when the process dies before the durable commit marker", async () => {
  const f = await fixture();
  await mkdir(f.move.backup);
  await writeFile(join(f.move.backup, "value"), "old");
  await mkdir(f.move.destination);
  await writeFile(join(f.move.destination, "value"), "new");
  await writeFile(f.statePath, JSON.stringify(f.nextStore));
  await writeFile(
    f.journalPath,
    JSON.stringify({
      version: 1,
      committed: false,
      moves: [f.move],
      previousStore: f.previousStore,
      nextStore: f.nextStore,
      previousMcp: "old",
    }),
  );
  await f.service.recover();
  expect(await readFile(join(f.move.destination, "value"), "utf8")).toBe("old");
  await expect(readFile(f.journalPath)).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it("commits directory, MCP and store changes and removes recovery artifacts", async () => {
  const f = await fixture();
  await mkdir(f.move.destination);
  await mkdir(f.move.stage);
  await writeFile(join(f.move.stage, "value"), "new");
  await f.service.commit([f.move], f.previousStore, f.nextStore, "old", "new");
  expect(f.mcp()).toBe("new");
  expect(JSON.parse(await readFile(f.statePath, "utf8"))).toEqual(f.nextStore);
  expect(await readFile(join(f.move.destination, "value"), "utf8")).toBe("new");
});
it("does not overwrite an unresolved journal or touch paths outside managed roots", async () => {
  const f = await fixture();
  const content = JSON.stringify({
    version: 1,
    committed: false,
    moves: [{ ...f.move, destination: join(f.root, "nested", "escape") }],
    previousStore: f.previousStore,
    nextStore: f.nextStore,
    previousMcp: "old",
  });
  await writeFile(f.journalPath, content);
  await expect(f.service.recover()).rejects.toThrow("escapes");
  await expect(
    f.service.commit([], f.previousStore, f.nextStore, "old", "new"),
  ).rejects.toThrow("requires recovery");
  expect(await readFile(f.journalPath, "utf8")).toBe(content);
});

it("rolls back an interrupted reinstall whose store is unchanged", async () => {
  const f = await fixture();
  await mkdir(f.move.backup);
  await writeFile(join(f.move.backup, "value"), "old");
  await mkdir(f.move.stage);
  await writeFile(
    f.journalPath,
    JSON.stringify({
      version: 1,
      committed: false,
      moves: [f.move],
      previousStore: f.previousStore,
      nextStore: f.previousStore,
      previousMcp: "old",
    }),
  );
  await f.service.recover();
  expect(await readFile(join(f.move.destination, "value"), "utf8")).toBe("old");
});
