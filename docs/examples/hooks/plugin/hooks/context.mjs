let input = "";
for await (const chunk of process.stdin) input += chunk;
JSON.parse(input);
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext:
        "Use focused tests and report concrete verification evidence.",
    },
  }),
);
