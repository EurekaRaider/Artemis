import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("node:child_process", () => ({
  execFile: Object.assign(() => {}, {
    [Symbol.for("nodejs.util.promisify.custom")]: run,
  }),
}));
import { verifyOfficeMacSignature } from "../../../src/main/office/office-macos-signature.js";

let elapsed = 0;
beforeEach(() => {
  elapsed = 0;
  run.mockReset();
  vi.spyOn(performance, "now").mockImplementation(() => elapsed);
});
afterEach(() => vi.restoreAllMocks());

function timeout() {
  elapsed += 60_000;
  throw Object.assign(new Error("Command failed: codesign"), {
    code: null,
    killed: true,
    signal: "SIGTERM",
  });
}

it("retries one timed-out verification with the same strict checks and deadline", async () => {
  run.mockImplementationOnce(timeout).mockResolvedValue({});
  await verifyOfficeMacSignature("/pack/Office.app");
  expect(run.mock.calls).toEqual([
    [
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", "/pack/Office.app"],
      { timeout: 60_000 },
    ],
    [
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", "/pack/Office.app"],
      { timeout: 60_000 },
    ],
  ]);
});

it("rejects persistent timeouts and preserves process diagnostics", async () => {
  run.mockImplementation(timeout);
  await expect(verifyOfficeMacSignature("/pack/Office.app")).rejects.toThrow(
    "signal=SIGTERM killed=true elapsedMs=60000",
  );
  expect(run).toHaveBeenCalledTimes(2);
});

it("rejects an invalid signature reported by the retry", async () => {
  run.mockImplementationOnce(timeout).mockRejectedValue(
    Object.assign(new Error("codesign failed"), {
      code: 1,
      stderr: "a sealed resource is missing or invalid",
    }),
  );
  await expect(verifyOfficeMacSignature("/pack/Office.app")).rejects.toThrow(
    "a sealed resource is missing or invalid",
  );
  expect(run).toHaveBeenCalledTimes(2);
});

it.each([
  { code: 1, stderr: "code object is not signed at all" },
  {
    code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    killed: true,
    signal: "SIGTERM",
  },
  { code: null, killed: true, signal: "SIGKILL" },
  { code: null, killed: true, signal: "SIGTERM" },
])(
  "rejects invalid signatures and non-timeout failures without retry: %j",
  async (details) => {
    run.mockRejectedValue(Object.assign(new Error("codesign failed"), details));
    await expect(verifyOfficeMacSignature("/pack/Office.app")).rejects.toThrow(
      details.stderr ?? "codesign failed",
    );
    expect(run).toHaveBeenCalledTimes(1);
  },
);
