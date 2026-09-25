import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL(".", import.meta.url));
const staging = await mkdtemp(join(tmpdir(), "artemis-issuer-package-"));
const args = process.argv.slice(2);
try {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const desktop = JSON.parse(
    await readFile(join(root, "../desktop/package.json"), "utf8"),
  );
  // A standalone staging directory prevents npm workspace dependencies from
  // being silently collected into this dependency-free signing application.
  await cp(join(root, "dist"), join(staging, "dist"), { recursive: true });
  await writeFile(
    join(staging, "package.json"),
    JSON.stringify({ ...pkg, dependencies: {} }),
  );
  await writeFile(
    join(staging, "builder.json"),
    JSON.stringify({
      ...pkg.build,
      electronVersion: desktop.devDependencies.electron,
      ...(process.platform === "darwin" && !args.includes("--win")
        ? { electronDist: join(root, "../../node_modules/electron/dist") }
        : {}),
      directories: { output: join(root, "release") },
    }),
  );
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        require.resolve("electron-builder/out/cli/cli.js"),
        "--projectDir",
        staging,
        "--config",
        "builder.json",
        ...args,
      ],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Packaging failed: ${code}`)),
    );
  });
} finally {
  await rm(staging, { recursive: true, force: true });
}
