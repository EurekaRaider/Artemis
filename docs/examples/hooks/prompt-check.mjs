let input = "";
for await (const chunk of process.stdin) input += chunk;
const event = JSON.parse(input);
if (/EXAMPLE_SECRET_[A-Za-z0-9]+/.test(event.prompt ?? "")) {
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason: "Remove the example secret before sending this prompt.",
    }),
  );
}
