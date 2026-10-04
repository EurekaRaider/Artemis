import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const argument = (name) => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith("--"))
    throw new Error(
      `Required argument: ${name}. Close Artemis before running migration or rollback.`,
    );
  return resolve(args[index + 1]);
};
const userData = argument("--user-data");
const skillsRoot = argument("--skills-root");
const stage = await mkdtemp(join(tmpdir(), "artemis-plugin-migration-cli-"));
try {
  const outfile = join(stage, "migration.mjs");
  await build({
    entryPoints: [
      resolve(
        import.meta.dirname,
        "../../apps/desktop/src/main/plugins/plugin-data-migration.ts",
      ),
    ],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
  });
  const migration = await import(pathToFileURL(outfile).href);
  if (args.includes("--rollback")) {
    await migration.rollbackPluginUserData(userData, skillsRoot);
    console.log(
      "Restored pre-migration plugin data. Credential vaults were unchanged.",
    );
  } else {
    const result = await migration.migratePluginUserData(userData, skillsRoot);
    console.log(JSON.stringify(result));
  }
} finally {
  await rm(stage, { recursive: true, force: true });
}
