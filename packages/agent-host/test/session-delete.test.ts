import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { deletePiSessionTranscript } from "../src/session-delete.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Pi session transcript deletion", () => {
  it("removes an inactive thread JSONL only from the trusted Pi session root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-session-delete-"));
    temporaryDirectories.push(directory);
    const sessionRoot = join(directory, "sessions");
    const sessionFile = join(sessionRoot, "workspace", "thread.jsonl");
    await mkdir(join(sessionRoot, "workspace"), { recursive: true });
    await writeFile(sessionFile, '{"type":"session"}\n', {
      encoding: "utf8",
      flush: true,
    });

    await deletePiSessionTranscript(sessionFile, sessionRoot);

    await expect(readFile(sessionFile, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects an out-of-root path and preserves that file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-session-delete-"));
    temporaryDirectories.push(directory);
    const sessionRoot = join(directory, "sessions");
    const outsideFile = join(directory, "outside.jsonl");
    await mkdir(sessionRoot, { recursive: true });
    await writeFile(outsideFile, '{"type":"outside"}\n', "utf8");

    await expect(
      deletePiSessionTranscript(outsideFile, sessionRoot),
    ).rejects.toThrow(
      "Pi session transcript is outside the trusted session root.",
    );
    await expect(readFile(outsideFile, "utf8")).resolves.toBe(
      '{"type":"outside"}\n',
    );
  });

  it("rejects a non-JSONL target inside the session root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-session-delete-"));
    temporaryDirectories.push(directory);
    const sessionRoot = join(directory, "sessions");
    const nonTranscript = join(sessionRoot, "workspace", "notes.txt");
    await mkdir(join(sessionRoot, "workspace"), { recursive: true });
    await writeFile(nonTranscript, "keep", "utf8");

    await expect(
      deletePiSessionTranscript(nonTranscript, sessionRoot),
    ).rejects.toThrow("Pi session transcript must be a JSONL file.");
    await expect(readFile(nonTranscript, "utf8")).resolves.toBe("keep");
  });
});
