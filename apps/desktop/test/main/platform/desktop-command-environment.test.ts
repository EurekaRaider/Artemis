import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { desktopCommandEnvironment } from "../../../src/main/platform/desktop-command-environment.js";

afterEach(() => vi.unstubAllEnvs());

it("finds desktop CLI installations with a minimal GUI PATH without changing the app environment", () => {
  const original =
    process.platform === "win32" ? "C:\\Windows" : "/usr/bin:/bin";
  vi.stubEnv("PATH", original);
  const env = desktopCommandEnvironment();
  expect(process.env.PATH).toBe(original);
  if (process.platform === "win32") {
    expect(env.PATH).toBe(original);
    return;
  }
  const paths = env.PATH!.split(delimiter);
  expect(paths.slice(0, 2)).toEqual(["/usr/bin", "/bin"]);
  expect(paths).toContain(join(homedir(), ".local", "bin"));
  expect(paths).toContain("/usr/local/bin");
  if (process.platform === "darwin")
    expect(paths).toContain("/opt/homebrew/bin");
  expect(new Set(paths).size).toBe(paths.length);
});
