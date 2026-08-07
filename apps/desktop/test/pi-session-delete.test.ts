import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  deletePiSessionTranscript,
  piSessionsRoot,
} from "../src/main/pi-session-delete.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("main-process Pi session transcript deletion", () => {
  it("resolves the default and PI_CODING_AGENT_DIR session roots", () => {
    const homeDirectory = join(tmpdir(), "artemis-fake-home");
    const configuredDirectory = join(tmpdir(), "artemis-configured-pi-agent");

    expect(piSessionsRoot({}, homeDirectory)).toBe(
      join(homeDirectory, ".pi", "agent", "sessions"),
    );
    expect(
      piSessionsRoot(
        { PI_CODING_AGENT_DIR: configuredDirectory },
        homeDirectory,
      ),
    ).toBe(join(resolve(configuredDirectory), "sessions"));
  });

  it("deletes a JSONL transcript inside the trusted session root", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "artemis-main-session-delete-"),
    );
    temporaryDirectories.push(directory);
    const sessionRoot = join(directory, "sessions");
    const sessionFile = join(sessionRoot, "project", "thread.jsonl");
    await mkdir(join(sessionRoot, "project"), { recursive: true });
    await writeFile(sessionFile, '{"type":"session"}\n', "utf8");

    await deletePiSessionTranscript(sessionFile, sessionRoot);

    await expect(readFile(sessionFile, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects and preserves a JSONL transcript outside the trusted root", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "artemis-main-session-delete-"),
    );
    temporaryDirectories.push(directory);
    const sessionRoot = join(directory, "sessions");
    const outsideFile = join(directory, "outside.jsonl");
    await mkdir(sessionRoot, { recursive: true });
    await writeFile(outsideFile, '{"type":"outside"}\n', "utf8");

    await expect(
      deletePiSessionTranscript(outsideFile, sessionRoot),
    ).rejects.toThrow();
    await expect(readFile(outsideFile, "utf8")).resolves.toBe(
      '{"type":"outside"}\n',
    );
  });

  it("rejects and preserves a non-JSONL file inside the trusted root", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "artemis-main-session-delete-"),
    );
    temporaryDirectories.push(directory);
    const sessionRoot = join(directory, "sessions");
    const nonTranscript = join(sessionRoot, "project", "notes.txt");
    await mkdir(join(sessionRoot, "project"), { recursive: true });
    await writeFile(nonTranscript, "keep", "utf8");

    await expect(
      deletePiSessionTranscript(nonTranscript, sessionRoot),
    ).rejects.toThrow();
    await expect(readFile(nonTranscript, "utf8")).resolves.toBe("keep");
  });
});
