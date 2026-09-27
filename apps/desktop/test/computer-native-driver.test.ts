import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { ComputerNativeDriver } from "../src/main/computer-use/native-driver.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function fixture() {
  Object.defineProperty(process, "platform", { value: "darwin" });
  const child = Object.assign(new EventEmitter(), {
    stdio: [null, null, null, new PassThrough(), new PassThrough()],
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(
    child as unknown as ReturnType<typeof spawn>,
  );
  const paused = vi.fn();
  const driver = new ComputerNativeDriver("fixture-helper", paused);
  return { child, paused, driver };
}

it("preserves the native stop reason instead of guessing user takeover", async () => {
  const { child, driver, paused } = fixture();
  const pending = driver.permissions();
  const request = JSON.parse(String(child.stdio[3]!.read()));
  child.stdio[4]!.write(
    `${JSON.stringify({ id: request.id, result: { accessibility: true, screenRecording: true } })}\n`,
  );
  await pending;
  child.stdio[4]!.write(
    `${JSON.stringify({ event: "takeover", reason: "Native Stop button pressed" })}\n`,
  );
  expect(paused).toHaveBeenCalledWith("Native Stop button pressed");
  driver.dispose();
});

it("identifies helper exit separately from user input", async () => {
  const { child, driver, paused } = fixture();
  const rejected = expect(driver.permissions()).rejects.toThrow(
    /helper stopped/,
  );
  child.emit("exit", 1);
  await rejected;
  expect(paused).toHaveBeenCalledWith("Native helper exited unexpectedly");
});

it("identifies a stalled helper and rejects the pending call", async () => {
  vi.useFakeTimers();
  const { driver, paused } = fixture();
  const rejected = expect(driver.permissions()).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(20000);
  await rejected;
  expect(paused).toHaveBeenCalledWith(
    "Native helper status request timed out after 20 seconds",
  );
});

it("keeps diagnostics opt-in and discards callbacks from a retired helper", async () => {
  const { child, driver, paused } = fixture();
  const rejected = expect(driver.permissions()).rejects.toThrow();
  expect(vi.mocked(spawn).mock.calls.at(-1)?.[2]).toMatchObject({
    env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
  });
  expect(
    (vi.mocked(spawn).mock.calls.at(-1)?.[2] as { env: Record<string, string> })
      .env,
  ).not.toHaveProperty("ARTEMIS_COMPUTER_DIAGNOSTICS");
  driver.dispose();
  await rejected;
  child.stdio[4]!.write(
    `${JSON.stringify({ event: "takeover", reason: "Old helper input" })}\n`,
  );
  expect(paused).not.toHaveBeenCalled();
});
