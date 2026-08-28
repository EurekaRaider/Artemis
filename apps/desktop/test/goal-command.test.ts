import { describe, expect, it } from "vitest";

import { parseGoalCommand } from "../src/renderer/goal-command.js";

describe("Goal composer commands", () => {
  it("supports show, edit, pause, resume, and clear without creating a turn", () => {
    expect(parseGoalCommand("/goal")).toEqual({ kind: "show" });
    expect(parseGoalCommand("/goal edit")).toEqual({ kind: "edit" });
    expect(parseGoalCommand("/goal pause")).toEqual({ kind: "pause" });
    expect(parseGoalCommand("/goal resume")).toEqual({ kind: "resume" });
    expect(parseGoalCommand("/goal clear")).toEqual({ kind: "clear" });
  });

  it("parses an explicit token budget from a new Goal", () => {
    expect(
      parseGoalCommand("/goal Ship verified release --token-budget 50000"),
    ).toEqual({
      kind: "set",
      objective: "Ship verified release",
      tokenBudget: 50_000,
    });
  });

  it("rejects invalid token budgets", () => {
    expect(parseGoalCommand("/goal Ship it --token-budget many")?.kind).toBe(
      "invalid",
    );
  });
});
