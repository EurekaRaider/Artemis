import { describe, expect, it } from "vitest";
import { isExecutionMode, runModeSchema } from "../src/schema.js";
import { runModeCapabilities } from "../src/custom-agents.js";

describe("canonical run modes", () => {
  it("normalizes historical modes without interpreting old code as Codemode", () => {
    expect(runModeSchema.parse("execute")).toBe("work");
    expect(runModeSchema.parse("review")).toBe("plan");
    expect(runModeSchema.safeParse("code").success).toBe(false);
  });
  it("gives Work and Codemode identical capability ceilings", () => {
    expect(runModeCapabilities("codemode")).toEqual(
      runModeCapabilities("work"),
    );
    expect(runModeCapabilities("work").has("filesystem-write")).toBe(true);
    expect(runModeCapabilities("plan")).toEqual(new Set(["business-read"]));
  });
  it("fails closed for unknown and unnormalized input", () => {
    for (const mode of ["execute", "review", "unknown", undefined, null])
      expect(isExecutionMode(mode)).toBe(false);
  });
});
