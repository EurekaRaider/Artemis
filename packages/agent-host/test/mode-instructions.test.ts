import { describe, expect, it } from "vitest";

import { modeInstruction } from "../src/mode-instructions.js";

describe("modeInstruction", () => {
  it("makes Plan explicitly read-only", () => {
    expect(modeInstruction("plan")).toContain("do not modify");
    expect(modeInstruction("plan")).toContain("submit_plan");
  });

  it("describes coding, general work, Office tools, and brokered execution in Work or Codemode mode", () => {
    expect(modeInstruction("work")).toContain("full local platform Shell");
    expect(modeInstruction("work")).toContain("desktop user's permissions");
    expect(modeInstruction("work")).toContain("brokered");
    expect(modeInstruction("work")).toContain("general work");
    expect(modeInstruction("work")).toContain("office document");
  });

  it("uses native PowerShell guidance in Work or Codemode mode on Windows", () => {
    const instruction = modeInstruction("work");

    expect(instruction).toContain("Windows uses PowerShell");
    expect(instruction).toContain("PowerShell 7 is preferred");
    expect(instruction).toContain("Windows PowerShell 5.1 fallback");
    expect(instruction).not.toContain("POSIX Git Bash");
  });
});
