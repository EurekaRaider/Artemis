import { describe, expect, it } from "vitest";

import { evaluateModePolicy } from "../src/index.js";

describe("evaluateModePolicy", () => {
  it.each(["plan", "review"] as const)(
    "rejects writes in %s mode before execution",
    (mode) => {
      expect(
        evaluateModePolicy(mode, {
          kind: "write",
          summary: "Write README.md",
        }),
      ).toMatchObject({ outcome: "deny" });
    },
  );

  it("allows reads in plan mode", () => {
    expect(
      evaluateModePolicy("plan", {
        kind: "read",
        summary: "Read README.md",
      }),
    ).toMatchObject({ outcome: "allow" });
  });

  it("requires explicit approval for writes in execute mode", () => {
    expect(
      evaluateModePolicy("execute", {
        kind: "write",
        summary: "Write README.md",
      }),
    ).toMatchObject({
      outcome: "ask",
      risk: "medium",
    });
  });

  it("requires explicit approval for writes and deletes in execute mode", () => {
    expect(
      evaluateModePolicy("execute", {
        kind: "write",
        summary: "Write report.docx",
      }),
    ).toMatchObject({
      outcome: "ask",
      risk: "medium",
    });
    expect(
      evaluateModePolicy("execute", {
        kind: "delete",
        summary: "Delete report.docx",
      }),
    ).toMatchObject({
      outcome: "ask",
      risk: "high",
      allowedScopes: ["once"],
    });
  });
});
