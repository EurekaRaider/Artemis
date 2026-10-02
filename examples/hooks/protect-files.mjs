let input = "";
for await (const chunk of process.stdin) input += chunk;
const event = JSON.parse(input);
const path = event.tool_input?.path ?? event.tool_input?.relative_path ?? "";
if (/(^|[/\\])\.env($|\.)/.test(path)) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "This project hook blocks direct writes to environment files.",
      },
    }),
  );
}
