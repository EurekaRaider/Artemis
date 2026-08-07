import { describe, expect, it } from "vitest";

import { modeInstruction } from "../src/mode-instructions.js";

describe("modeInstruction", () => {
  it("makes Plan and Review explicitly read-only", () => {
    expect(modeInstruction("plan")).toContain("do not modify");
    expect(modeInstruction("review")).toContain("without modifying");
  });

  it("describes coding, general work, Office tools, and brokered execution in Execute mode", () => {
    expect(modeInstruction("execute")).toContain("full local bash");
    expect(modeInstruction("execute")).toContain("desktop user's permissions");
    expect(modeInstruction("execute")).toContain("brokered");
    expect(modeInstruction("execute")).toContain("general work");
    expect(modeInstruction("execute")).toContain("office document");
  });

  it("uses POSIX Bash guidance in Execute mode on Windows", () => {
    const instruction = modeInstruction("execute");

    expect(instruction).toContain("On Windows");
    expect(instruction).toContain("POSIX");
    expect(instruction).toContain("find");
    expect(instruction).toContain("2>/dev/null");
    expect(instruction).not.toContain("dir /s /b");
    expect(instruction).not.toContain("2>nul");
  });
});
