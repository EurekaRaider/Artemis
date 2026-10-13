import { beforeEach, expect, it, vi } from "vitest";

const { run, wait } = vi.hoisted(() => ({ run: vi.fn(), wait: vi.fn() }));
vi.mock("node:child_process", () => ({
  execFile: Object.assign(() => {}, {
    [Symbol.for("nodejs.util.promisify.custom")]: run,
  }),
}));
vi.mock("node:timers/promises", () => ({ setTimeout: wait }));
import { validateMacTicket } from "../../../src/main/capabilities/macos-ticket.js";

beforeEach(() => {
  run.mockReset();
  wait.mockReset().mockResolvedValue(undefined);
});

it("retries dropped Apple connections before accepting a successful validation", async () => {
  const error = Object.assign(new Error("stapler failed"), {
    stdout: "NSURLErrorDomain Code=-1005: The network connection was lost.",
  });
  run
    .mockRejectedValueOnce(error)
    .mockRejectedValueOnce(error)
    .mockResolvedValue({});
  await validateMacTicket("/pack/Runtime.app");
  expect(run).toHaveBeenCalledTimes(3);
  expect(run).toHaveBeenLastCalledWith(
    "/usr/bin/xcrun",
    ["stapler", "validate", "/pack/Runtime.app"],
    { timeout: 60_000 },
  );
  expect(wait.mock.calls).toEqual([[15_000], [30_000]]);
});

it.each(["The ticket is invalid", "Could not validate ticket", "ETIMEDOUT"])(
  "does not retry or accept an unclassified failure: %s",
  async (diagnostic) => {
    run.mockRejectedValue(
      Object.assign(new Error("stapler failed"), { stdout: diagnostic }),
    );
    await expect(validateMacTicket("/pack/Runtime.app")).rejects.toThrow(
      diagnostic,
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  },
);

it("fails after three dropped connections and preserves the diagnostic", async () => {
  run.mockRejectedValue(
    Object.assign(new Error("stapler failed"), {
      stderr: "NSURLErrorDomain Code=-1005: The network connection was lost.",
    }),
  );
  await expect(validateMacTicket("/pack/Runtime.app")).rejects.toThrow(
    "NSURLErrorDomain Code=-1005",
  );
  expect(run).toHaveBeenCalledTimes(3);
  expect(wait).toHaveBeenCalledTimes(2);
});
