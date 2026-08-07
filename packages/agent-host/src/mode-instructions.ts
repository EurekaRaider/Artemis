import type { RunMode } from "@artemis/protocol";

export function modeInstruction(mode: RunMode): string {
  switch (mode) {
    case "plan":
      return [
        "Artemis is running this turn in Plan mode.",
        "Inspect and reason about the workspace, but do not modify files or execute mutating commands.",
        "Return a decision-complete implementation plan.",
      ].join(" ");
    case "review":
      return [
        "Artemis is running this turn in Review mode.",
        "Inspect the supplied workspace and changes without modifying files.",
        "Lead with actionable findings and identify exact file locations when possible.",
      ].join(" ");
    case "execute":
      return [
        "Artemis is running this turn in Execute mode.",
        "Complete the requested coding or general work task, produce the requested result, and verify it in proportion to risk.",
        "You may use Pi's full local bash tool plus the provided workspace and office document tools.",
        "Pi bash runs with the current desktop user's permissions after brokered model or user approval; workspace and office document mutations use the same approval boundary.",
        "On Windows, this is POSIX Git Bash: use commands such as find and redirect errors to 2>/dev/null.",
      ].join(" ");
  }
}
