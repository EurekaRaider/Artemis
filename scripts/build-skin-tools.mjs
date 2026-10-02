import { build } from "esbuild";
import { chmod, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url)),
  version = "1.0.0";
const directory = join(
  root,
  "artifacts",
  "skin-tools",
  `artemis-skin-tools-${version}`,
);
await mkdir(directory, { recursive: true });
await build({
  entryPoints: [join(root, "scripts/skin-tools.ts")],
  outfile: join(directory, "cli.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  banner: { js: "#!/usr/bin/env node" },
});
await chmod(join(directory, "cli.mjs"), 0o755);
await writeFile(
  join(directory, "package.json"),
  JSON.stringify(
    {
      name: "artemis-skin-tools",
      version,
      private: true,
      type: "module",
      bin: { "artemis-skin": "./cli.mjs" },
      engines: { node: ">=24" },
    },
    null,
    2,
  ) + "\n",
);
await cp(
  join(root, "packages/theme-contract/dist/schema"),
  join(directory, "schema"),
  { recursive: true },
);
await writeFile(
  join(directory, "THIRD_PARTY_NOTICES.txt"),
  (
    await Promise.all(
      ["parse5", "entities"].map(
        async (name) =>
          `${name}\n\n${await readFile(join(root, "node_modules", name, "LICENSE"), "utf8")}`,
      ),
    )
  ).join("\n\n"),
);
await writeFile(
  join(directory, "README.md"),
  `# Artemis Skin Tools ${version}\n\nRequires Node.js 24 or newer. No installation or network access is needed.\n\nRun \`node cli.mjs --help\` to see init, validate, build, preview and convert-icons commands.\n\nThis is a standalone downloadable tool bundle. The Artemis workspace packages are private and are not a published npm SDK.\n`,
);
execFileSync("tar", [
  "-czf",
  `${directory}.tar.gz`,
  "-C",
  join(root, "artifacts", "skin-tools"),
  `artemis-skin-tools-${version}`,
]);
console.log(directory);
