import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runSlackCli } from "../../../src/main/im/slack-cli-runner.js";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;

function childProcess() {
  return Object.assign(new EventEmitter(), {
    pid: 4242,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
}
function command(signal = new AbortController().signal) {
  return {
    runtime: {
      executable: "slack.exe",
      hook: "hook.cjs",
      nodeExecutable: "Artemis.exe",
    },
    directory: "/temporary/slack-session",
    args: ["manifest", "info", "--source", "local"],
    signal,
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  spawn.mockReset();
  Object.defineProperty(process, "platform", { value: "win32" });
});
afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("gives the Windows CLI its own console while retaining captured output and arguments", async () => {
  const child = childProcess();
  spawn.mockReturnValue(child);
  const result = runSlackCli(command());
  child.stdout.write("manifest ");
  child.stderr.write("diagnostic");
  child.emit("close", 7);
  await expect(result).resolves.toEqual({
    code: 7,
    output: "manifest diagnostic",
  });
  expect(spawn).toHaveBeenCalledWith(
    "slack.exe",
    [
      "manifest",
      "info",
      "--source",
      "local",
      "--skip-update",
      "--no-color",
      "--config-dir",
      expect.stringMatching(/config$/u),
    ],
    expect.objectContaining({
      detached: true,
      windowsHide: false,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: expect.stringMatching(/project$/u),
    }),
  );
});

it.each(["abort", "timeout", "output-limit"])(
  "kills the entire Windows CLI tree on %s even with an independent console",
  async (reason) => {
    const child = childProcess(),
      killer = childProcess();
    spawn.mockReturnValueOnce(child).mockReturnValue(killer);
    const controller = new AbortController();
    const result = runSlackCli(command(controller.signal));
    const rejection = expect(result).rejects.toThrow(
      reason === "abort" ? "cancelled" : "network",
    );
    if (reason === "abort") controller.abort();
    else if (reason === "timeout") vi.advanceTimersByTime(60000);
    else child.stdout.write("x".repeat(256 * 1024 + 1));
    expect(spawn).toHaveBeenLastCalledWith(
      expect.stringMatching(/taskkill\.exe$/u),
      ["/pid", "4242", "/T", "/F"],
      { windowsHide: true, stdio: "ignore" },
    );
    child.emit("close", 1);
    await rejection;
    const calls = spawn.mock.calls.length;
    vi.advanceTimersByTime(60000);
    controller.abort();
    expect(spawn).toHaveBeenCalledTimes(calls);
  },
);

it("keeps the direct-kill fallback if Windows tree termination cannot start", async () => {
  const child = childProcess(),
    killer = childProcess();
  spawn.mockReturnValueOnce(child).mockReturnValue(killer);
  const controller = new AbortController();
  const result = runSlackCli(command(controller.signal));
  const rejection = expect(result).rejects.toThrow("cancelled");
  controller.abort();
  killer.emit("error", new Error("unavailable"));
  expect(child.kill).toHaveBeenCalledOnce();
  child.emit("close", 1);
  await rejection;
});

it("does not launch a cancelled command", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(runSlackCli(command(controller.signal))).rejects.toThrow();
  expect(spawn).not.toHaveBeenCalled();
});

it("preserves macOS process-group launch and cleanup", async () => {
  Object.defineProperty(process, "platform", { value: "darwin" });
  const child = childProcess();
  spawn.mockReturnValue(child);
  const kill = vi.spyOn(process, "kill").mockReturnValue(true);
  const controller = new AbortController();
  const result = runSlackCli(command(controller.signal));
  const rejection = expect(result).rejects.toThrow("cancelled");
  expect(spawn.mock.calls[0][2]).toMatchObject({
    detached: true,
    windowsHide: true,
  });
  controller.abort();
  expect(kill).toHaveBeenCalledWith(-4242, "SIGKILL");
  child.emit("close", 1);
  await rejection;
});
