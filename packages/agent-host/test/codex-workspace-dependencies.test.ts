import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveCodexWorkspaceDependencies } from "../src/codex-workspace-dependencies.js";

const temporaryRoots: string[] = [];

async function runtimeFixture(options?: {
  currentWindowsLayout?: boolean;
  includeLibreOffice?: boolean;
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "artemis-codex-runtime-"));
  temporaryRoots.push(root);
  const dependencies = join(root, "dependencies");
  const currentWindowsLayout =
    process.platform === "win32" && options?.currentWindowsLayout;
  const nodeExecutable = currentWindowsLayout
    ? join(dependencies, "node", "bin", "node.exe")
    : join(
        dependencies,
        "node",
        process.platform === "win32" ? "node.exe" : "bin/node",
      );
  const pythonExecutable =
    process.platform === "win32"
      ? join(dependencies, "python", "python.exe")
      : join(dependencies, "python", "bin", "python3");
  const fallback = join(dependencies, "bin", "fallback");
  const override = join(dependencies, "bin", "override");
  const gitExecutable = currentWindowsLayout
    ? join(dependencies, "native", "git", "cmd", "git.exe")
    : join(fallback, process.platform === "win32" ? "git.exe" : "git");
  const paths = [
    nodeExecutable,
    pythonExecutable,
    gitExecutable,
    join(fallback, process.platform === "win32" ? "pnpm.cmd" : "pnpm"),
    join(
      override,
      currentWindowsLayout
        ? "pdfinfo.cmd"
        : process.platform === "win32"
          ? "pdfinfo.exe"
          : "pdfinfo",
    ),
    join(
      override,
      currentWindowsLayout
        ? "pdftoppm.cmd"
        : process.platform === "win32"
          ? "pdftoppm.exe"
          : "pdftoppm",
    ),
    join(
      dependencies,
      "node",
      "node_modules",
      "@oai",
      "artifact-tool",
      "package.json",
    ),
  ];
  if (options?.includeLibreOffice !== false) {
    paths.push(
      join(override, process.platform === "win32" ? "soffice.exe" : "soffice"),
    );
  }
  await Promise.all(
    paths.map((path) => mkdir(dirname(path), { recursive: true })),
  );
  await mkdir(override, { recursive: true });
  await Promise.all(paths.map((path) => writeFile(path, "")));
  await writeFile(
    join(root, "runtime.json"),
    JSON.stringify({
      bundleVersion: "26.731.11130",
      targetArch: process.arch,
      targetPlatform: process.platform,
    }),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Codex workspace dependencies", () => {
  it("returns only a complete same-platform primary runtime", async () => {
    const root = await runtimeFixture();
    const canonicalRoot = await realpath(root);

    const dependencies = await resolveCodexWorkspaceDependencies(root);

    expect(dependencies).toMatchObject({
      bundleVersion: "26.731.11130",
      nodeModules: join(canonicalRoot, "dependencies", "node", "node_modules"),
      pythonPackages: join(canonicalRoot, "dependencies", "python"),
    });
    expect(dependencies?.nodeExecutable).toContain("node");
    expect(dependencies?.pythonExecutable).toContain("python");
    expect(dependencies?.libreOfficeExecutable).toContain("soffice");
    expect(dependencies?.pdfRendererExecutable).toContain("pdftoppm");
  });

  it("hides an incompatible runtime", async () => {
    const root = await runtimeFixture();
    await writeFile(
      join(root, "runtime.json"),
      JSON.stringify({
        bundleVersion: "26.731.11130",
        targetArch: process.arch === "arm64" ? "x64" : "arm64",
        targetPlatform: process.platform,
      }),
    );

    await expect(
      resolveCodexWorkspaceDependencies(root),
    ).resolves.toBeUndefined();
  });

  it.runIf(process.platform === "win32")(
    "accepts the current Windows runtime layout without optional LibreOffice",
    async () => {
      const root = await runtimeFixture({
        currentWindowsLayout: true,
        includeLibreOffice: false,
      });

      const dependencies = await resolveCodexWorkspaceDependencies(root);

      expect(dependencies?.gitExecutable).toContain(
        join("native", "git", "cmd", "git.exe"),
      );
      expect(dependencies?.nodeExecutable).toContain(
        join("node", "bin", "node.exe"),
      );
      expect(dependencies?.pdfInfoExecutable).toContain(
        join("bin", "override", "pdfinfo.cmd"),
      );
      expect(dependencies?.libreOfficeExecutable).toBeUndefined();
    },
  );
});
