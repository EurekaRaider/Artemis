import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
const files = vi.hoisted(() => ({
  copyFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  rm: vi.fn(),
  symlink: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFileSync: run }));
vi.mock("node:fs/promises", () => files);
const originalArgs = process.argv;
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  Object.defineProperty(process, "platform", { value: "darwin" });
});
afterEach(() => {
  process.argv = originalArgs;
  Object.defineProperty(process, "platform", originalPlatform);
});
it("builds with an SDK tool whose Mach-O header cannot grow in a long workspace path", async () => {
  const root = resolve("artifacts/office", "long-workspace-path-".repeat(8));
  const framework = join(root, "LibreOffice.app", "Contents", "Frameworks");
  const dependencies = [
    "libunoidllo.dylib",
    "libuno_salhelpergcc3.dylib.3",
    "libuno_sal.dylib.3",
    "libreglo.dylib",
  ];
  files.readdir.mockResolvedValue(dependencies);
  run.mockImplementation((command, args: string[]) => {
    if (command === "install_name_tool") {
      for (let index = 0; index < args.length - 1; index += 3) {
        if (
          Buffer.byteLength(args[index + 2]!) >
          Buffer.byteLength(args[index + 1]!)
        )
          throw new Error("larger updated load commands do not fit");
      }
    }
  });
  process.argv = [
    process.execPath,
    "build-bridge.mjs",
    "--sdk",
    join(root, "sdk"),
    "--office",
    join(root, "LibreOffice.app", "Contents", "MacOS", "soffice"),
    "--json",
    join(root, "json.hpp"),
    "--out",
    join(root, "build"),
  ];
  await import("./build-bridge.mjs");
  expect(files.symlink.mock.calls).toEqual(
    dependencies.map((name) => [
      join(framework, name),
      join(root, "build", "sdk-tools", name),
    ]),
  );
  expect(run.mock.calls.some(([command]) => command === "clang++")).toBe(true);
});
