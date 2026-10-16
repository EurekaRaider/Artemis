import { generateKeyPairSync, sign } from "node:crypto";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { canonicalUpdatePayload } from "../../apps/desktop/src/main/updates/signed-update-index.ts";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  read: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFileSync: mocks.run }));
vi.mock("node:fs/promises", () => ({
  readFile: mocks.read,
  mkdtemp: vi.fn(async () => "/channel-readback"),
  rm: mocks.remove,
}));

const originalArgv = process.argv;
let historyFailure: Error | undefined;
let previousSequence: number;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.argv = [process.execPath, "publish-windows-update-channel.mjs", "/verified"];
  historyFailure = undefined;
  previousSequence = 122;
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const assets = [{ name: "Artemis-Windows-x64-1.7.17.exe", size: 42, sha256: "a".repeat(64) }];
  const index = (sequence: number) => {
    const payload = {
      version: "1.7.17", platform: "win32", arch: "x64", distribution: "nsis",
      sequence, minUpdaterVersion: 1, assets,
    };
    return Buffer.from(JSON.stringify({
      schemaVersion: 1, keyId: "fixture", payload,
      signature: sign(null, Buffer.from(canonicalUpdatePayload(payload)), privateKey).toString("base64"),
    }));
  };
  let uploaded = false;
  mocks.read.mockImplementation(async (path) => {
    if (path instanceof URL)
      return JSON.stringify({ fixture: publicKey.export({ type: "spki", format: "pem" }) });
    return index(path === join("/verified", "windows-x64-update.json") || uploaded ? 123 : previousSequence);
  });
  mocks.run.mockImplementation((_command, args) => {
    if (args[0] === "api" && args[1].includes("?per_page=")) {
      if (historyFailure) throw historyFailure;
      // An unfiltered release history with large asset metadata exceeds execFileSync's default buffer.
      if (!args.includes("--paginate") || args[args.indexOf("--jq") + 1] !== ".[].tag_name")
        throw Object.assign(new Error("spawnSync gh ENOBUFS"), { code: "ENOBUFS" });
      return [...Array.from({ length: 101 }, (_, i) => `v1.0.${i}`), "windows-x64-stable"].join("\n");
    }
    if (args[0] === "api") return JSON.stringify({ draft: false, assets: assets.map((asset) => ({ ...asset, digest: `sha256:${asset.sha256}` })) });
    if (args[1] === "upload") uploaded = true;
    return "";
  });
});

afterEach(() => { process.argv = originalArgv; });

it("publishes and reads back the signed index with a large paginated release history", async () => {
  await import("./publish-windows-update-channel.mjs");
  expect(mocks.run.mock.calls.some(([, args]) => args[1] === "upload")).toBe(true);
  expect(mocks.run.mock.calls.some(([, args]) => args[1] === "create")).toBe(false);
});

it("does not reset or overwrite the channel when history retrieval fails", async () => {
  historyFailure = new Error("GitHub unavailable");
  await expect(import("./publish-windows-update-channel.mjs")).rejects.toThrow("GitHub unavailable");
  expect(mocks.run.mock.calls.some(([, args]) => ["create", "upload"].includes(args[1]))).toBe(false);
});

it("still rejects an older signed update sequence before upload", async () => {
  previousSequence = 124;
  await expect(import("./publish-windows-update-channel.mjs")).rejects.toThrow("Refusing update channel replay");
  expect(mocks.run.mock.calls.some(([, args]) => args[1] === "upload")).toBe(false);
});

it("does not upload an identical already published channel", async () => {
  previousSequence = 123;
  await import("./publish-windows-update-channel.mjs");
  expect(
    mocks.run.mock.calls.some(([, args]) =>
      ["create", "upload"].includes(args[1]),
    ),
  ).toBe(false);
  expect(
    mocks.run.mock.calls.filter(([, args]) => args[1] === "download"),
  ).toHaveLength(2);
});

it("rejects different bytes with the same sequence and version", async () => {
  previousSequence = 123;
  const read = mocks.read.getMockImplementation()!;
  mocks.read.mockImplementation(async (path) => {
    const bytes = await read(path);
    return path === join("/channel-readback", "windows-x64-update.json")
      ? Buffer.concat([bytes, Buffer.from("\n")])
      : bytes;
  });
  await expect(import("./publish-windows-update-channel.mjs")).rejects.toThrow(
    "Refusing update channel replay",
  );
  expect(mocks.run.mock.calls.some(([, args]) => args[1] === "upload")).toBe(
    false,
  );
});
