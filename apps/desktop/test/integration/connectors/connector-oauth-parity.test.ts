import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const shop =
  process.env.ARTEMIS_PLUGIN_SHOP ?? resolve(root, "../ArtemisPluginShop");
const normalize = (s: string) =>
  s.replaceAll("./connector-oauth.ts", "./connector-oauth.js");
it.skipIf(!existsSync(shop))(
  "uses identical OAuth validation in the host and marketplace",
  () => {
    for (const name of ["connectors.ts", "connector-oauth.ts"]) {
      expect(
        normalize(readFileSync(resolve(shop, "src/shared", name), "utf8")),
      ).toBe(
        normalize(
          readFileSync(resolve(root, "apps/desktop/src/shared", name), "utf8"),
        ),
      );
    }
  },
);
