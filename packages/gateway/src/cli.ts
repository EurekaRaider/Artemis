import { mkdirSync, chmodSync, existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve, dirname } from "node:path";
import { ArtemisGateway } from "./server.js";

const envFile = resolve(".env.gateway");
if (
  !process.env.ARTEMIS_GATEWAY_ADMIN_TOKEN &&
  !process.env.ARTEMIS_GATEWAY_ENCRYPTION_KEY
) {
  if (!existsSync(envFile)) {
    writeFileSync(
      envFile,
      [
        `ARTEMIS_GATEWAY_ADMIN_TOKEN=${randomBytes(32).toString("hex")}`,
        `ARTEMIS_GATEWAY_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`,
        "ARTEMIS_GATEWAY_DATABASE=./data/gateway.sqlite",
        "ARTEMIS_GATEWAY_HOST=127.0.0.1",
        "ARTEMIS_GATEWAY_PORT=8787",
        "",
      ].join("\n"),
      { flag: "wx", mode: 0o600 },
    );
    console.log(
      "Created .env.gateway. Read its administrator token to register Artemis; keep this file private.",
    );
  }
  process.loadEnvFile(envFile);
}

const databasePath = resolve(
  process.env.ARTEMIS_GATEWAY_DATABASE ?? "./data/gateway.sqlite",
);
mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
const gateway = new ArtemisGateway({
  databasePath,
  encryptionKey: process.env.ARTEMIS_GATEWAY_ENCRYPTION_KEY ?? "",
  adminToken: process.env.ARTEMIS_GATEWAY_ADMIN_TOKEN ?? "",
});
chmodSync(databasePath, 0o600);
const port = await gateway.listen(
  Number(process.env.ARTEMIS_GATEWAY_PORT ?? 8787),
  process.env.ARTEMIS_GATEWAY_HOST ?? "127.0.0.1",
);
console.log(
  `Artemis Gateway listening on port ${port}. Put TLS in front of non-loopback access.`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void gateway.close().then(() => process.exit(0));
  });
