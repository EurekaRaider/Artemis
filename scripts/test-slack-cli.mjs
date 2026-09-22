import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertSlackBinary,
  assertSlackLock,
  downloadSlackAsset,
  fetchLatestSlackRelease,
  fetchSlackBytes,
  latestStableRelease,
  sha256,
  slackBinaryIdentity,
  slackReleaseAssets,
} from "./slack-cli-release.mjs";

const digest = "a".repeat(64);
function release(version = "4.8.0", extra = {}) {
  return {
    id: 123,
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: ["macOS_arm64.zip", "macOS_amd64.zip", "windows_64-bit.zip"].map(
      (suffix) => ({
        name: `slack_cli_${version}_${suffix}`,
        browser_download_url: `https://github.com/slackapi/slack-cli/releases/download/v${version}/slack_cli_${version}_${suffix}`,
        digest: `sha256:${digest}`,
        size: 123,
      }),
    ),
    ...extra,
  };
}
function lock(upstream = release()) {
  return {
    schemaVersion: 1,
    repository: "slackapi/slack-cli",
    version: upstream.tag_name.slice(1),
    releaseId: upstream.id,
    targets: Object.fromEntries(
      Object.entries(slackReleaseAssets(upstream)).map(([key, asset]) => [
        key,
        {
          ...asset,
          binarySha256: digest,
          contentSha256: digest,
          binaryBytes: 123,
        },
      ]),
    ),
  };
}
const response = (value, status = 200) =>
  new Response(typeof value === "string" ? value : JSON.stringify(value), {
    status,
  });
const noSleep = async () => {};

test("the identical latest stable release passes without mutating the lock", () => {
  const pinned = lock(),
    before = JSON.stringify(pinned);
  assertSlackLock(pinned, release());
  assert.equal(JSON.stringify(pinned), before);
});
for (const version of ["4.8.1", "4.9.0", "5.0.0"]) {
  test(`a new stable ${version} blocks the old lock`, () =>
    assert.throws(
      () => assertSlackLock(lock(), release(version)),
      /not the latest stable/u,
    ));
}
test("draft, prerelease and development releases never become the stable fact", () => {
  assert.equal(
    latestStableRelease([
      release("5.0.0", { draft: true }),
      release("5.0.0", { prerelease: true }),
      release("5.0.0-rc.1"),
      release("dev"),
      release("4.8.0"),
      release("4.7.9"),
    ]).tag_name,
    "v4.8.0",
  );
  assert.throws(
    () => latestStableRelease([release("5.0.0", { prerelease: true })]),
    /no official stable/u,
  );
});
test("missing assets, changed URLs and mismatched official digests fail", () => {
  for (const mutate of [
    (r) => r.assets.pop(),
    (r) => {
      r.assets[0].digest = `sha256:${"b".repeat(64)}`;
    },
    (r) => {
      r.assets[0].browser_download_url = "https://example.com/cli.zip";
    },
  ]) {
    const upstream = release();
    mutate(upstream);
    assert.throws(() => assertSlackLock(lock(), upstream), /asset|match/u);
  }
});
test("archive bytes are checked, not just GitHub metadata", async () => {
  const bytes = Buffer.from("correct archive"),
    asset = {
      url: "https://github.com/archive",
      archiveBytes: bytes.length,
      sha256: sha256(bytes),
    };
  await downloadSlackAsset(asset, {
    fetchImpl: async () => response("correct archive"),
  });
  await assert.rejects(
    downloadSlackAsset(asset, {
      fetchImpl: async () => response("corrupt archive"),
    }),
    /SHA-256/u,
  );
});
test("network failures and GitHub rate limits fail closed after bounded retries", async () => {
  for (const status of [undefined, 403, 429, 503]) {
    let calls = 0;
    await assert.rejects(
      fetchSlackBytes("https://api.github.com/test", {
        sleep: noSleep,
        fetchImpl: async (_url, options) => {
          calls++;
          assert.equal(options.cache, "no-store");
          assert.ok(options.signal);
          if (!status) throw new Error("offline");
          return response("failure", status);
        },
      }),
      /blocked/u,
    );
    assert.equal(calls, 3);
  }
});
test("a successful retry must still verify a fresh response", async () => {
  let calls = 0;
  assert.equal(
    (
      await fetchSlackBytes("https://api.github.com/test", {
        sleep: noSleep,
        fetchImpl: async () =>
          ++calls === 1 ? response("slow down", 429) : response("fresh"),
      })
    ).toString(),
    "fresh",
  );
  assert.equal(calls, 2);
});
test("final release check detects a stable version published during the build", async () => {
  let upstream = release();
  const options = {
    fetchImpl: async (url) =>
      response(
        url.endsWith("/latest")
          ? upstream
          : [upstream, release("9.0.0", { prerelease: true })],
      ),
  };
  const pinned = lock();
  assertSlackLock(pinned, await fetchLatestSlackRelease(options));
  upstream = release("4.8.1", { id: 124 });
  assert.throws(() => assertSlackLock(pinned, upstream), /not the latest/u);
  await assert.rejects(
    (async () =>
      assertSlackLock(pinned, await fetchLatestSlackRelease(options)))(),
    /not the latest/u,
  );
});
test("inconsistent official latest release cannot pass", async () => {
  await assert.rejects(
    fetchLatestSlackRelease({
      fetchImpl: async (url) =>
        response(url.endsWith("/latest") ? release() : [release("4.8.1")]),
    }),
    /disagree/u,
  );
});

function macho(cpu = 0x100000c, code = 0x41) {
  const bytes = Buffer.alloc(512);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(cpu, 4);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(72, 20);
  bytes.writeUInt32LE(0x19, 32);
  bytes.writeUInt32LE(72, 36);
  bytes.write("__LINKEDIT", 40);
  bytes.writeBigUInt64LE(4096n, 64);
  bytes.writeBigUInt64LE(256n, 72);
  bytes.writeBigUInt64LE(256n, 80);
  bytes.fill(code, 256, 512);
  return bytes;
}
test("a wrong architecture or old/corrupted executable fails despite correct packaged metadata", () => {
  const bytes = macho(),
    pinned = lock();
  pinned.targets["darwin-arm64"].contentSha256 =
    slackBinaryIdentity(bytes).contentSha256;
  assertSlackBinary(bytes, "darwin-arm64", pinned);
  assert.throws(
    () => assertSlackBinary(macho(0x1000007), "darwin-arm64", pinned),
    /architecture/u,
  );
  assert.throws(
    () => assertSlackBinary(macho(0x100000c, 0x42), "darwin-arm64", pinned),
    /content/u,
  );
});
test("signing changes are allowed while the executable payload stays authenticated", () => {
  const original = macho(),
    signed = Buffer.concat([original, Buffer.alloc(128, 0x22)]);
  signed.writeUInt32LE(2, 16);
  signed.writeUInt32LE(88, 20);
  signed.writeUInt32LE(0x1d, 104);
  signed.writeUInt32LE(16, 108);
  signed.writeUInt32LE(512, 112);
  signed.writeUInt32LE(128, 116);
  signed.writeBigUInt64LE(384n, 80);
  assert.equal(
    slackBinaryIdentity(original).contentSha256,
    slackBinaryIdentity(signed).contentSha256,
  );
  signed[300] ^= 1;
  assert.notEqual(
    slackBinaryIdentity(original).contentSha256,
    slackBinaryIdentity(signed).contentSha256,
  );
});
test("CI, both package entry points and final publication enforce the gate", async () => {
  const read = async (path) =>
    readFile(new URL(`../${path}`, import.meta.url), "utf8");
  assert.match(await read("scripts/verify-ci.mjs"), /"verify:slack-cli"/u);
  assert.match(await read("scripts/verify-pre-push.mjs"), /verify:ci/u);
  for (const platform of ["mac", "windows"])
    assert.equal(
      (await read(`apps/desktop/scripts/package-${platform}-lite.mjs`)).match(
        /await verifySlackCliRelease\(\)/gu,
      ).length,
      2,
    );
  const workflow = await read(".github/workflows/release.yml");
  assert.match(
    workflow,
    /node scripts\/verify-slack-cli.mjs\s+gh release create/u,
  );
  assert.doesNotMatch(workflow, /Node.js 24|node-version: 24/u);
  const manifest = JSON.parse(await read("apps/desktop/package.json"));
  assert.equal(manifest.build.beforePack, "scripts/prepare-slack-cli.cjs");
  assert.equal(
    manifest.build.mac.extraResources[0].from,
    "../../artifacts/slack-cli/darwin-${arch}",
  );
  assert.equal(
    manifest.build.win.extraResources[0].from,
    "../../artifacts/slack-cli/win32-${arch}",
  );
});
