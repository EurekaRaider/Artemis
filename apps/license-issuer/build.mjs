import { build } from "esbuild";
import { mkdir, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL(".", import.meta.url));
await mkdir(join(root, "dist"), { recursive: true });
for (const name of ["main", "preload"])
  await build({
    entryPoints: [join(root, "src", `${name}.ts`)],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    external: ["electron"],
    outfile: join(root, "dist", `${name}.cjs`),
  });
for (const name of ["index.html", "ui.js", "issuer.css"])
  await cp(join(root, "src", name), join(root, "dist", name));
await cp(
  join(root, "../desktop/src/license/ui/style.css"),
  join(root, "dist/style.css"),
);
