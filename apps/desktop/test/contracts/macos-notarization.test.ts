import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  notarizeExistingMacApp,
  retryNotarizationOperation,
  // @ts-expect-error Build scripts are exercised directly.
} from "../../scripts/release/notarize-macos-app.mjs";
it("records the submission before waiting and resumes the same signed app without resubmitting", async () => {
  const root = await mkdtemp(join(tmpdir(), "artemis-notary-"));
  try {
    await mkdir(join(root, "mac-arm64"));
    const app = join(root, "mac-arm64", "Artemis.app");
    let waitFails = true;
    const execute = vi.fn(async (command: string, args: string[]) => {
      if (command.endsWith("codesign"))
        return {
          stdout: "",
          stderr:
            "Authority=Developer ID Application: Fixture\nCDHash=fixture\n",
        };
      if (command.endsWith("PlistBuddy"))
        return { stdout: "1.6.0", stderr: "" };
      if (args[1] === "submit")
        return {
          stdout: JSON.stringify({
            id: "12345678-1234-1234-1234-123456789abc",
          }),
        };
      if (args[1] === "wait") {
        if (waitFails) throw new Error("secret-password");
        return { stdout: JSON.stringify({ status: "Accepted" }) };
      }
      return { stdout: "", stderr: "" };
    });
    await expect(
      notarizeExistingMacApp(
        app,
        "1.6.0",
        { APPLE_KEYCHAIN_PROFILE: "fixture" },
        execute,
        async () => {},
      ),
    ).rejects.toThrow("12345678-1234");
    expect(
      JSON.parse(
        await readFile(join(root, "notarization-mac-arm64.json"), "utf8"),
      ).status,
    ).toBe("In Progress");
    expect(
      execute.mock.calls.filter(([, args]) => args[1] === "wait"),
    ).toHaveLength(3);
    waitFails = false;
    await notarizeExistingMacApp(
      app,
      "1.6.0",
      { APPLE_KEYCHAIN_PROFILE: "fixture" },
      execute,
      async () => {},
    );
    expect(
      execute.mock.calls.filter(([, args]) => args[1] === "submit"),
    ).toHaveLength(1);
    expect(
      JSON.parse(
        await readFile(join(root, "notarization-mac-arm64.json"), "utf8"),
      ).status,
    ).toBe("Accepted");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("bounds repeatable operation retries and backs off without exposing command errors", async () => {
  const operation = vi.fn().mockRejectedValue(new Error("secret-password"));
  const wait = vi.fn().mockResolvedValue(undefined);
  await expect(retryNotarizationOperation(operation, wait)).rejects.toThrow(
    "after 3 attempts",
  );
  expect(operation).toHaveBeenCalledTimes(3);
  expect(wait.mock.calls).toEqual([[15000], [30000]]);
  operation
    .mockReset()
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValue("ok");
  expect(await retryNotarizationOperation(operation, wait)).toBe("ok");
  expect(operation).toHaveBeenCalledTimes(2);
});

it("does not retry or resubmit an explicit Apple rejection", async () => {
  const root = await mkdtemp(join(tmpdir(), "artemis-notary-rejected-"));
  await mkdir(join(root, "mac-arm64"));
  const app = join(root, "mac-arm64", "Artemis.app");
  const execute = vi.fn(async (command: string, args: string[]) => {
    if (command.endsWith("codesign"))
      return {
        stderr:
          "Authority=Developer ID Application: Fixture\nCDHash=rejected\n",
      };
    if (command.endsWith("PlistBuddy")) return { stdout: "1.6.1" };
    if (args[1] === "submit")
      return {
        stdout: JSON.stringify({ id: "12345678-1234-1234-1234-123456789abc" }),
      };
    if (args[1] === "wait")
      throw Object.assign(new Error("secret-password"), {
        stdout: JSON.stringify({ status: "Invalid" }),
      });
    return { stdout: "" };
  });
  const wait = vi.fn();
  try {
    await expect(
      notarizeExistingMacApp(
        app,
        "1.6.1",
        { APPLE_KEYCHAIN_PROFILE: "fixture" },
        execute,
        wait,
      ),
    ).rejects.toThrow("did not accept");
    await expect(
      notarizeExistingMacApp(
        app,
        "1.6.1",
        { APPLE_KEYCHAIN_PROFILE: "fixture" },
        execute,
        wait,
      ),
    ).rejects.toThrow("Apple rejected");
    expect(
      execute.mock.calls.filter(([, args]) => args[1] === "submit"),
    ).toHaveLength(1);
    expect(
      execute.mock.calls.filter(([, args]) => args[1] === "wait"),
    ).toHaveLength(1);
    expect(wait).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
