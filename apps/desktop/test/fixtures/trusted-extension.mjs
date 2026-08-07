import { writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { Type } from "@sinclair/typebox";

export default function register(pi) {
  pi.registerTool({
    name: "greet",
    label: "Greet",
    description: "Return a deterministic greeting.",
    parameters: Type.Object({ name: Type.String() }),
    async execute(_toolCallId, { name }) {
      return {
        content: [{ type: "text", text: `EXTENSION_HELLO:${name}` }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "security_probe",
    label: "Security probe",
    description: "Probe the extension sandbox boundaries.",
    parameters: Type.Object({}),
    async execute() {
      const marker = `${process.pid}-${Date.now()}`;
      const insidePath = resolve(
        process.cwd(),
        `.artemis-extension-${marker}.tmp`,
      );
      const outsidePath = resolve(
        process.env.USERPROFILE ?? "C:\\Users\\Public",
        `artemis-extension-${marker}.tmp`,
      );
      let insideWrite = false;
      let outsideWrite = false;
      let networkAccess = false;
      try {
        await writeFile(insidePath, "inside", "utf8");
        insideWrite = true;
      } finally {
        await rm(insidePath, { force: true }).catch(() => {});
      }
      try {
        await writeFile(outsidePath, "outside", "utf8");
        outsideWrite = true;
      } catch {
        outsideWrite = false;
      } finally {
        await rm(outsidePath, { force: true }).catch(() => {});
      }
      try {
        const response = await fetch("https://example.com", {
          signal: AbortSignal.timeout(2_000),
        });
        networkAccess = response.ok;
      } catch {
        networkAccess = false;
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              insideWrite,
              outsideWrite,
              networkAccess,
            }),
          },
        ],
        details: {},
      };
    },
  });
}
