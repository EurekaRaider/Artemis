// Thread data root: hash-free storage + one-shot legacy migration.
//
// The plugin revision content hash gates CODE trust only; document version
// history binds to the thread so it survives plugin upgrades. These tests
// pin the migration that rescues data written by legacy hash-scoped builds.

import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readdir,
  rm,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  ensureThreadDataRoot,
  threadDataRoot,
} from "../../../src/main/design/design-plugin-thread-data.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

async function makeScratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), "thread-data-"));
}

test("fresh thread: data root is hash-free and gets created", async () => {
  const scratch = await makeScratch();
  const root = await ensureThreadDataRoot(scratch, "thread-1");
  assert.equal(root, join(scratch, "thread-1", "data"));
  assert.deepEqual(await readdir(root), []); // exists but empty
  await rm(scratch, { recursive: true, force: true });
});

test("legacy hash-scoped data migrates into data/ and the emptied legacy dir is removed", async () => {
  const scratch = await makeScratch();
  const legacy = join(scratch, "thread-1", HASH_A);
  await mkdir(join(legacy, "documents", "doc-1"), { recursive: true });
  await writeFile(
    join(legacy, "design-documents.jsonl"),
    '{"id":"doc-1","name":"customer.html"}\n',
    "utf8",
  );
  await writeFile(
    join(legacy, "documents", "doc-1", "v1-aaaa.html"),
    "<html>",
    "utf8",
  );

  const root = await ensureThreadDataRoot(scratch, "thread-1");
  assert.equal(root, join(scratch, "thread-1", "data"));
  assert.equal(
    await readdir(join(root, "documents", "doc-1")).then((e) => e.length),
    1,
  );
  // legacy directory fully emptied → removed; data survives in data/
  const siblings = await readdir(join(scratch, "thread-1"));
  assert.deepEqual(siblings, ["data"]);
  await rm(scratch, { recursive: true, force: true });
});

test("data/ already populated: migration is skipped, legacy dirs untouched", async () => {
  const scratch = await makeScratch();
  await mkdir(join(threadDataRoot(scratch, "thread-1"), "documents"), {
    recursive: true,
  });
  await writeFile(
    join(threadDataRoot(scratch, "thread-1"), "design-documents.jsonl"),
    "x\n",
  );
  const legacy = join(scratch, "thread-1", HASH_A);
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, "design-documents.jsonl"), "old\n");

  await ensureThreadDataRoot(scratch, "thread-1");
  assert.equal(
    await readFile0(join(legacy, "design-documents.jsonl")),
    "old\n",
  );
  await rm(scratch, { recursive: true, force: true });
});

test("multiple legacy dirs: newest mtime wins, older dirs left in place", async () => {
  const scratch = await makeScratch();
  const oldDir = join(scratch, "thread-1", HASH_A);
  const newDir = join(scratch, "thread-1", HASH_B);
  await mkdir(join(oldDir, "documents"), { recursive: true });
  await mkdir(join(newDir, "documents"), { recursive: true });
  await writeFile(join(oldDir, "documents", "v1-old.html"), "old", "utf8");
  await writeFile(join(newDir, "documents", "v1-new.html"), "new", "utf8");
  const past = new Date(Date.now() - 60_000);
  await utimes(oldDir, past, past);

  const root = await ensureThreadDataRoot(scratch, "thread-1");
  assert.deepEqual(await readdir(join(root, "documents")), ["v1-new.html"]);
  // untouched older legacy dir stays (dev-only artifact, never deleted)
  assert.deepEqual(await readdir(join(oldDir, "documents")), ["v1-old.html"]);
  await rm(scratch, { recursive: true, force: true });
});

async function readFile0(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf8");
}
