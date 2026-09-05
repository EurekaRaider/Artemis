import { build } from "esbuild";
import { create } from "tar";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isBuiltin } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export async function packageGateway(destination) {
  const temporary = await mkdtemp(join(tmpdir(), "artemis-gateway-build-"));
  try {
    const result = await build({
      absWorkingDir: root,
      entryPoints: ["packages/gateway/src/cli.ts"],
      outfile: join(temporary, "gateway.mjs"),
      bundle: true,
      platform: "node",
      target: "node24",
      format: "esm",
      minify: true,
      sourcemap: false,
      metafile: true,
      external: ["bufferutil", "utf-8-validate"],
      banner: {
        js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url); const __dirname = import.meta.dirname;',
      },
    });
    const code = await readFile(join(temporary, "gateway.mjs"), "utf8");
    if (
      code.includes("sourceMappingURL") ||
      Object.values(result.metafile.outputs)
        .flatMap((o) => o.imports)
        .some(
          (i) =>
            i.external &&
            !isBuiltin(i.path) &&
            !["bufferutil", "utf-8-validate"].includes(i.path),
        )
    )
      throw new Error(
        "Gateway package contains source maps or an unbundled runtime dependency.",
      );
    await writeFile(
      join(temporary, "README.md"),
      await readFile(join(root, "packages/gateway/DEPLOY.md")),
    );
    const dependencyRoots = new Set(
      Object.keys(result.metafile.inputs).flatMap((path) => {
        const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//u.exec(path);
        return match ? [match[1]] : [];
      }),
    );
    const licenses = [];
    for (const directory of [...dependencyRoots].sort()) {
      const files = (await readdir(join(root, directory))).filter((name) =>
        /^(licen[cs]e|copying|notice)(\.|$)/iu.test(name),
      );
      if (!files.length) {
        const readme = await readFile(
          join(root, directory, "README.md"),
          "utf8",
        );
        const license = /^(?:#+ )?License[^\n]*\n(?:[-=]+\n)?([\s\S]*)/imu.exec(
          readme,
        )?.[1];
        if (!license)
          throw new Error(
            `Bundled dependency has no license text: ${directory}`,
          );
        licenses.push(`${directory}/README.md - License\n${license}`);
      }
      for (const file of files.sort())
        licenses.push(
          `${directory}/${file}\n${await readFile(join(root, directory, file), "utf8")}`,
        );
    }
    await writeFile(
      join(temporary, "THIRD-PARTY-LICENSES.txt"),
      licenses.join("\n\n"),
    );
    await mkdir(dirname(destination), { recursive: true });
    await create(
      { file: destination, gzip: true, cwd: temporary, portable: true },
      ["gateway.mjs", "README.md", "THIRD-PARTY-LICENSES.txt"],
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const destination = resolve(
    root,
    "packages/gateway/dist/artemis-gateway.tar.gz",
  );
  await packageGateway(destination);
  console.log(destination);
}
