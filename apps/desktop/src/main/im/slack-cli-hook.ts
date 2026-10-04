import { readFileSync } from "node:fs";
import { createConnection } from "node:net";

// This entry point runs once under bundled Electron's Node mode. Credentials
// travel over authenticated loopback IPC, never stdout, argv or a token file.
if (process.argv[2] === "manifest") {
  process.stdout.write(readFileSync("manifest.json"));
} else if (process.argv[2] === "deploy") {
  const port = Number(process.env.ARTEMIS_SLACK_HANDOFF_PORT);
  const secret = process.env.ARTEMIS_SLACK_HANDOFF_SECRET;
  const appToken = process.env.SLACK_APP_TOKEN,
    botToken = process.env.SLACK_BOT_TOKEN;
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !secret ||
    !appToken?.startsWith("xapp-") ||
    !botToken?.startsWith("xoxb-")
  )
    process.exit(1);
  const socket = createConnection({ host: "127.0.0.1", port });
  socket.setTimeout(10000);
  socket.on("connect", () =>
    socket.end(JSON.stringify({ secret, appToken, botToken })),
  );
  let acknowledgement = "";
  socket.on("data", (data) => {
    acknowledgement += data.toString();
    if (acknowledgement.length > 16) socket.destroy();
  });
  socket.on("end", () => process.exit(acknowledgement === "ok" ? 0 : 1));
  socket.on("error", () => process.exit(1));
  socket.on("timeout", () => process.exit(1));
} else process.exit(1);
