export type GoalCommand =
  | { kind: "show" }
  | { kind: "pause" | "resume" | "clear" | "edit" }
  | { kind: "set"; objective: string; tokenBudget?: number }
  | { kind: "invalid"; message: string };

export function parseGoalCommand(prompt: string): GoalCommand | undefined {
  const match = prompt.match(/^\/goal(?:\s+([\s\S]*))?$/iu);
  if (!match) return undefined;
  const argument = match[1]?.trim();
  if (!argument) return { kind: "show" };
  const action = argument.toLocaleLowerCase();
  if (
    action === "pause" ||
    action === "resume" ||
    action === "clear" ||
    action === "edit"
  ) {
    return { kind: action };
  }
  const budgetMatch = argument.match(/^(.*?)(?:\s+--token-budget\s+(\S+))$/iu);
  if (!budgetMatch) return { kind: "set", objective: argument };
  const objective = budgetMatch[1]?.trim() ?? "";
  const rawBudget = budgetMatch[2] ?? "";
  if (!objective) {
    return { kind: "invalid", message: "A Goal objective is required." };
  }
  if (!/^\d+$/u.test(rawBudget) || Number(rawBudget) <= 0) {
    return {
      kind: "invalid",
      message: "--token-budget must be a positive integer.",
    };
  }
  return {
    kind: "set",
    objective,
    tokenBudget: Number(rawBudget),
  };
}
