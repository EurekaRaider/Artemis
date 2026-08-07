import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

interface MemoryRecallResult {
  context: string;
  selectedEntries: number;
  projectEntries: number;
  globalEntries: number;
  characters: number;
}

interface MemoryRecallModule {
  recallMemoryForTurn(input: {
    prompt: string;
    projectMemory: string;
    globalMemory: string;
    limits: {
      maxEntries: number;
      maxCharacters: number;
      globalMaxEntries: number;
      globalMaxCharacters: number;
    };
  }): MemoryRecallResult;
}

async function loadMemoryRecall(): Promise<MemoryRecallModule> {
  const sourcePath = join(
    dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1")),
    "../src/main/memory-recall.ts",
  );
  expect(
    await readFile(sourcePath, "utf8").catch(() => undefined),
    "memory recall production module is missing",
  ).toBeTypeOf("string");
  return import(
    /* @vite-ignore */ pathToFileURL(sourcePath).href
  ) as Promise<MemoryRecallModule>;
}

const PROJECT_MEMORY = `# Project memory

## Recover the Artemis Windows Ninja build
Keywords: artemis, windows, cmake, ninja, target-only, rebuild

Inspect only processes whose command line names this workspace and target. Clean
only that target, rebuild it, then verify the artifact timestamp and no-work
state.

## Preserve renderer-only Electron boundaries
Keywords: electron, renderer, preload, node-api, boundary

Renderer modules consume the preload API and never import Electron main-process
or Node APIs.
`;

const GLOBAL_MEMORY = `# Global memory

## Diagnose Windows Ninja target rebuilds
Keywords: windows, cmake, ninja, target-only, rebuild

Across Windows CMake repositories, inspect exact process command lines before
removing a stale lock. Rebuild only the requested target and verify the artifact.

## Publish a verified Git branch
Keywords: git, push, branch, remote, verify

After an explicitly requested push, compare local HEAD with the remote branch.
`;

const LIMITS = {
  maxEntries: 3,
  maxCharacters: 700,
  globalMaxEntries: 1,
  globalMaxCharacters: 260,
};

describe("recallMemoryForTurn", () => {
  it("selects only a strongly relevant heading-bounded project snippet", async () => {
    const { recallMemoryForTurn } = await loadMemoryRecall();
    const result = recallMemoryForTurn({
      prompt:
        "The Artemis Windows Ninja target rebuild is stuck. Check the target-only rebuild and stale lock.",
      projectMemory: PROJECT_MEMORY,
      globalMemory: "",
      limits: LIMITS,
    });

    expect(result.projectEntries).toBe(1);
    expect(result.globalEntries).toBe(0);
    expect(result.context).toContain(
      "## Recover the Artemis Windows Ninja build",
    );
    expect(result.context).toContain("verify the artifact timestamp");
    expect(result.context).not.toContain(
      "## Preserve renderer-only Electron boundaries",
    );
    expect(result.context).not.toContain("# Project memory");
  });

  it("prefers project memory and applies the smaller global entry and character budgets", async () => {
    const { recallMemoryForTurn } = await loadMemoryRecall();
    const input = {
      prompt:
        "Diagnose this Artemis Windows CMake Ninja target-only rebuild and verify the artifact.",
      projectMemory: PROJECT_MEMORY,
      globalMemory: GLOBAL_MEMORY,
      limits: LIMITS,
    };

    const first = recallMemoryForTurn(input);
    const second = recallMemoryForTurn(input);

    expect(second).toEqual(first);
    expect(first.projectEntries).toBeGreaterThan(0);
    expect(first.globalEntries).toBeLessThanOrEqual(LIMITS.globalMaxEntries);
    expect(first.context.indexOf("Recover the Artemis")).toBeLessThan(
      first.context.indexOf("Diagnose Windows Ninja"),
    );
    const globalContext = first.context.slice(
      first.context.indexOf("## Diagnose Windows Ninja"),
    );
    expect(globalContext.length).toBeLessThanOrEqual(
      LIMITS.globalMaxCharacters,
    );
    expect(first.characters).toBe(first.context.length);
    expect(first.characters).toBeLessThanOrEqual(LIMITS.maxCharacters);
  });

  it("ignores common-word and weak matches and returns no hidden context when irrelevant", async () => {
    const { recallMemoryForTurn } = await loadMemoryRecall();
    const result = recallMemoryForTurn({
      prompt: "Please help with the project files and finish the current task.",
      projectMemory: PROJECT_MEMORY,
      globalMemory: GLOBAL_MEMORY,
      limits: LIMITS,
    });

    expect(result).toEqual({
      context: "",
      selectedEntries: 0,
      projectEntries: 0,
      globalEntries: 0,
      characters: 0,
    });
  });

  it("never truncates or exceeds a heading-bounded entry budget", async () => {
    const { recallMemoryForTurn } = await loadMemoryRecall();
    const result = recallMemoryForTurn({
      prompt: "Artemis Windows CMake Ninja target-only rebuild",
      projectMemory: PROJECT_MEMORY,
      globalMemory: GLOBAL_MEMORY,
      limits: {
        maxEntries: 1,
        maxCharacters: 120,
        globalMaxEntries: 1,
        globalMaxCharacters: 60,
      },
    });

    expect(result.context).toBe("");
    expect(result.selectedEntries).toBe(0);
    expect(result.characters).toBe(0);
  });
});
