import { beforeEach, expect, it, vi } from "vitest";
import { join } from "node:path";
const run = vi.hoisted(() => vi.fn());
const write = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFileSync: run }));
vi.mock("node:fs/promises", () => ({ writeFile: write }));
import { withMacSigningKeychain } from "./macos-capability-signing.mjs";
const credentials = {
  APPLE_TEAM_ID: "TEAM",
  CSC_LINK: Buffer.from("certificate").toString("base64"),
  CSC_KEY_PASSWORD: "fixture-secret",
};
beforeEach(() => {
  run.mockReset();
  write.mockReset();
  run.mockImplementation((_command, args) =>
    args[0] === "find-identity"
      ? '1) ABC "Developer ID Application: Fixture (TEAM)"'
      : '"original.keychain-db"',
  );
});
it("restores the user's keychains and deletes the private keychain after a failed signing callback", async () => {
  await expect(
    withMacSigningKeychain("/private/tmp/fixture", credentials, async () => {
      throw new Error("signing failed");
    }),
  ).rejects.toThrow("signing failed");
  expect(write).toHaveBeenCalledWith(
    join("/private/tmp/fixture", "certificate.p12"),
    Buffer.from("certificate"),
    { mode: 0o600 },
  );
  expect(run.mock.calls.slice(-2).map(([, args]) => args)).toEqual([
    ["list-keychains", "-d", "user", "-s", "original.keychain-db"],
    ["delete-keychain", join("/private/tmp/fixture", "signing.keychain-db")],
  ]);
});
it("redacts credential-bearing security errors and still cleans up the temporary keychain", async () => {
  run.mockImplementation((_command, args) => {
    if (args[0] === "import")
      throw new Error("security import -P fixture-secret failed");
    return '"original.keychain-db"';
  });
  const callback = vi.fn();
  await expect(
    withMacSigningKeychain("/private/tmp/fixture", credentials, callback),
  ).rejects.toThrow("macOS signing keychain operation failed");
  expect(callback).not.toHaveBeenCalled();
  expect(run.mock.calls.at(-1)?.[1]).toEqual([
    "delete-keychain",
    join("/private/tmp/fixture", "signing.keychain-db"),
  ]);
});
it("refuses an identity from another team before signing any payload", async () => {
  run.mockImplementation((_command, args) =>
    args[0] === "find-identity"
      ? '"Developer ID Application: Fixture (OTHER)"'
      : '"original.keychain-db"',
  );
  const callback = vi.fn();
  await expect(
    withMacSigningKeychain("/private/tmp/fixture", credentials, callback),
  ).rejects.toThrow("does not match APPLE_TEAM_ID");
  expect(callback).not.toHaveBeenCalled();
});
