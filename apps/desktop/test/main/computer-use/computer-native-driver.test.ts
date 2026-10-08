import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { ComputerNativeDriver } from "../../../src/main/computer-use/native-driver.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
function fixture(os = "darwin", hello = { helperProtocol: 1, platform: os }) {
  Object.defineProperty(process, "platform", { value: os });
  const stdin = new PassThrough(),
    stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdio: [stdin, stdout, null],
    kill: vi.fn(() => {
      child.emit("close", 0);
      return true;
    }),
  });
  vi.mocked(spawn).mockReturnValue(
    child as unknown as ReturnType<typeof spawn>,
  );
  const requests: Array<{ id: string; method: string }> = [];
  const reply = (id: string, result: unknown) =>
    stdout.write(JSON.stringify({ id, result }) + "\n");
  stdin.on("data", (chunk) => {
    const request = JSON.parse(String(chunk));
    if (request.method === "hello") reply(request.id, hello);
    else requests.push(request);
  });
  const paused = vi.fn(),
    release = vi.fn();
  const driver = new ComputerNativeDriver(
    async () => ({ path: "fixture-helper", release }),
    paused,
  );
  return { child, stdout, requests, paused, driver, release, reply };
}
it.each(["darwin", "win32"])(
  "handshakes on %s over private standard pipes",
  async (os) => {
    const f = fixture(os);
    const pending = f.driver.permissions();
    await settle();
    expect(f.requests[0]?.method).toBe("status");
    f.reply(f.requests[0]!.id, { accessibility: true, screenRecording: true });
    expect(await pending).toMatchObject({ accessibility: true });
    expect(vi.mocked(spawn).mock.calls.at(-1)?.[2]).toMatchObject({
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    await f.driver.close();
    expect(f.release).toHaveBeenCalledOnce();
  },
);
it("rejects incompatible helpers before any operation", async () => {
  const f = fixture("win32", { helperProtocol: 2, platform: "win32" });
  await expect(f.driver.permissions()).rejects.toThrow(/mismatch/);
  expect(f.requests).toHaveLength(0);
  expect(f.release).toHaveBeenCalledOnce();
});
it("preserves the native stop reason", async () => {
  const f = fixture();
  const pending = f.driver.permissions();
  await settle();
  f.reply(f.requests[0]!.id, { accessibility: true, screenRecording: true });
  await pending;
  f.stdout.write(
    JSON.stringify({
      event: "takeover",
      reason: "Native Stop button pressed",
    }) + "\n",
  );
  expect(f.paused).toHaveBeenCalledWith("Native Stop button pressed");
  f.driver.dispose();
});
it("identifies helper exit separately from user input", async () => {
  const f = fixture();
  const rejected = expect(f.driver.permissions()).rejects.toThrow(
    /helper stopped/,
  );
  await settle();
  f.child.emit("exit", 1);
  await rejected;
  expect(f.paused).toHaveBeenCalledWith("Native helper exited unexpectedly");
});
it("identifies a stalled helper and rejects the pending call", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const rejected = expect(f.driver.permissions()).rejects.toThrow(/timed out/);
  await settle();
  await vi.advanceTimersByTimeAsync(20000);
  await rejected;
  expect(f.paused).toHaveBeenCalledWith(
    "Native helper status request timed out after 20 seconds",
  );
});
it("rejects an oversized unterminated message and releases the process lease", async () => {
  const f = fixture();
  const rejected = expect(f.driver.permissions()).rejects.toThrow();
  await settle();
  f.stdout.write(Buffer.alloc(2 * 1024 * 1024 + 1));
  await rejected;
  expect(f.release).toHaveBeenCalledOnce();
});
it("holds the runtime lease until the process has actually closed", async () => {
  const f = fixture();
  const rejected = expect(f.driver.permissions()).rejects.toThrow();
  await settle();
  f.child.kill.mockImplementation(() => true);
  f.driver.dispose();
  await rejected;
  expect(f.release).not.toHaveBeenCalled();
  f.child.emit("close", 0);
  expect(f.release).toHaveBeenCalledOnce();
});
it("keeps diagnostics opt-in and ignores callbacks from retired helpers", async () => {
  const f = fixture();
  const rejected = expect(f.driver.permissions()).rejects.toThrow();
  await settle();
  expect(
    (vi.mocked(spawn).mock.calls.at(-1)?.[2] as { env: Record<string, string> })
      .env,
  ).not.toHaveProperty("ARTEMIS_COMPUTER_DIAGNOSTICS");
  f.driver.dispose();
  await rejected;
  f.stdout.write(
    JSON.stringify({ event: "takeover", reason: "Old helper input" }) + "\n",
  );
  expect(f.paused).not.toHaveBeenCalled();
});
it("does not spawn after cancellation while acquiring a downloaded helper", async () => {
  const release = vi.fn();
  let resolve!: (lease: { path: string; release(): void }) => void;
  const driver = new ComputerNativeDriver(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
    vi.fn(),
  );
  vi.mocked(spawn).mockClear();
  const signal = new AbortController();
  const rejected = expect(
    driver.permissions(false, signal.signal),
  ).rejects.toThrow(/cancelled/);
  signal.abort();
  resolve({ path: "fixture", release });
  await rejected;
  expect(spawn).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});

it("waits for retired children after cancellation before allowing a runtime switch", async () => {
  const f = fixture();
  const rejected = expect(f.driver.permissions()).rejects.toThrow();
  await settle();
  f.child.kill.mockImplementation(() => true);
  f.driver.dispose();
  await rejected;
  let closed = false;
  const waiting = f.driver.close().then(() => {
    closed = true;
  });
  await settle();
  expect(closed).toBe(false);
  expect(f.release).not.toHaveBeenCalled();
  f.child.emit("close", 0);
  await waiting;
  expect(f.release).toHaveBeenCalledOnce();
});
