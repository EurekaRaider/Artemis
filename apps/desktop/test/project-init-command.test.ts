import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { expandProjectInitCommand } from "../src/shared/project-init-command.js";

const workerSource = readFileSync(
  fileURLToPath(new URL("../src/agent/agent-worker.ts", import.meta.url)),
  "utf8",
);

describe("project init slash command", () => {
  it("expands init into a grounded project-level AGENTS.md task", () => {
    const expanded = expandProjectInitCommand("/init");

    expect(expanded).toContain("project root");
    expect(expanded).toContain("AGENTS.md");
    expect(expanded).toContain("Inspect the repository");
    expect(expanded).toContain("preserve");
    expect(expanded).not.toBe("/init");
  });

  it("recognizes only an exact init command", () => {
    expect(expandProjectInitCommand("  /INIT  ")).not.toBe("  /INIT  ");
    expect(expandProjectInitCommand("/init extra")).toBe("/init extra");
    expect(expandProjectInitCommand("Explain /init")).toBe("Explain /init");
  });

  it("expands prompt, steer, and follow-up text inside the one Pi worker", () => {
    expect(
      workerSource.match(/expandProjectInitCommand\(command\.text\)/gu),
    ).toHaveLength(3);
  });
});
