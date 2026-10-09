import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { buildComputerUse } from "../../scripts/build/build-computer-use.mjs";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => ["main.swift"]),
  copyFileSync: vi.fn(),
}));
vi.mock("../../scripts/build/build-computer-preview.mjs", () => ({
  buildComputerPreview: vi.fn(),
}));
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  vi.clearAllMocks();
});
it.each([true, false])(
  "builds the Windows helper with development=%s in its own output directory",
  (development) => {
    Object.defineProperty(process, "platform", { value: "win32" });
    buildComputerUse("x64", development);
    expect(execFileSync).toHaveBeenCalledWith(
      "cmake",
      expect.arrayContaining([
        "--config",
        development ? "Debug" : "Release",
        "--target",
        "artemis-computer-use",
      ]),
      expect.anything(),
    );
    expect(copyFileSync).toHaveBeenCalledWith(
      expect.stringContaining(development ? "Debug" : "Release"),
      expect.stringContaining(development ? "development" : "x64"),
    );
  },
);
it("does not compile DEBUG parent trust into the macOS release helper", () => {
  Object.defineProperty(process, "platform", { value: "darwin" });
  buildComputerUse("arm64", false);
  const args = vi.mocked(execFileSync).mock.calls[0]![1] as string[];
  expect(args).not.toContain("DEBUG");
  expect(args.join(" ")).not.toContain("/development/");
});

it("limits Windows development parent trust to Debug despite the static release CRT", async () => {
  const cmake = await readFile(
    new URL(
      "../../native/computer-use/windows/CMakeLists.txt",
      import.meta.url,
    ),
    "utf8",
  );
  expect(cmake).toContain('MSVC_RUNTIME_LIBRARY "MultiThreaded"');
  expect(cmake).toContain("$<$<CONFIG:Debug>:_DEBUG>");
});
