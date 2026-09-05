import { build } from "esbuild";
import { create } from "tar";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
        js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
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
            !i.path.startsWith("node:") &&
            ![
              "bufferutil",
              "utf-8-validate",
              "events",
              "http",
              "https",
              "net",
              "tls",
              "crypto",
              "stream",
              "url",
              "zlib",
              "buffer",
              "util",
            ].includes(i.path),
        )
    )
      throw new Error(
        "Gateway package contains source maps or an unbundled runtime dependency.",
      );
    await writeFile(
      join(temporary, "README.md"),
      await readFile(join(root, "packages/gateway/DEPLOY.md")),
    );
    await writeFile(
      join(temporary, "THIRD-PARTY-LICENSES.txt"),
      (
        await Promise.all([
          readFile(join(root, "node_modules/ws/LICENSE"), "utf8"),
          readFile(join(root, "node_modules/zod/LICENSE"), "utf8"),
        ])
      ).join("\n\n"),
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
