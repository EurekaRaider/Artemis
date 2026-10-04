import { describe, expect, it } from "vitest";

import { evaluateModePolicy } from "../src/index.js";

describe("evaluateModePolicy", () => {
  it.each(["work", "codemode"] as const)(
    "preserves the execution approval boundary in %s",
    (mode) => {
      expect(
        evaluateModePolicy(mode, { kind: "write", summary: "Write file" }),
      ).toMatchObject({ outcome: "ask" });
      expect(
        evaluateModePolicy(mode, { kind: "delete", summary: "Delete file" }),
      ).toMatchObject({ outcome: "ask", risk: "high" });
    },
  );
  it("rejects unknown modes instead of treating them as execution", () => {
    expect(
      evaluateModePolicy("unknown" as never, {
        kind: "read",
        summary: "Read file",
      }),
    ).toMatchObject({ outcome: "deny" });
  });
  it.each(["plan"] as const)(
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
      evaluateModePolicy("work", {
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
      evaluateModePolicy("work", {
        kind: "write",
        summary: "Write report.docx",
      }),
    ).toMatchObject({
      outcome: "ask",
      risk: "medium",
    });
    expect(
      evaluateModePolicy("work", {
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
