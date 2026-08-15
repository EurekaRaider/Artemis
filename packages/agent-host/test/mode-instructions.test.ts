import { describe, expect, it } from "vitest";

import { modeInstruction } from "../src/mode-instructions.js";

describe("modeInstruction", () => {
  it("makes Plan and Review explicitly read-only", () => {
    expect(modeInstruction("plan")).toContain("do not modify");
    expect(modeInstruction("review")).toContain("without modifying");
  });

  it("describes coding, general work, Office tools, and brokered execution in Execute mode", () => {
    expect(modeInstruction("execute")).toContain("full local platform Shell");
    expect(modeInstruction("execute")).toContain("desktop user's permissions");
    expect(modeInstruction("execute")).toContain("brokered");
    expect(modeInstruction("execute")).toContain("general work");
    expect(modeInstruction("execute")).toContain("office document");
  });

  it("uses native PowerShell guidance in Execute mode on Windows", () => {
    const instruction = modeInstruction("execute");

    expect(instruction).toContain("Windows uses PowerShell");
    expect(instruction).toContain("PowerShell 7 is preferred");
    expect(instruction).toContain("Windows PowerShell 5.1 fallback");
    expect(instruction).not.toContain("POSIX Git Bash");
  });
});
