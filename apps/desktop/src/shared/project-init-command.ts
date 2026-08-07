const PROJECT_INIT_PROMPT = [
  "Inspect the repository before editing.",
  "Create or update AGENTS.md at the project root with concise, actionable instructions for future coding agents.",
  "Document only verified project-specific commands, tests, architecture constraints, code style, and working conventions.",
  "If AGENTS.md already exists, preserve valid user-authored instructions and make only the changes needed to improve it.",
  "Do not create AGENTS.md outside the project root or modify unrelated files.",
].join(" ");

export function expandProjectInitCommand(text: string): string {
  return /^\s*\/init\s*$/iu.test(text) ? PROJECT_INIT_PROMPT : text;
}
