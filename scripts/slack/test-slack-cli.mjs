import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { lockedSlackLicense } from "./slack-cli-package.mjs";
import {
  assertSlackBinary,
  assertSlackLock,
  downloadSlackAsset,
  fetchLatestSlackRelease,
  fetchSlackBytes,
  fetchSlackBytesWithCurl,
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

test("locked license survives Windows newline conversion without accepting changed text", async () => {
  const original = await readFile(
    new URL("../../third-party/slack-cli-LICENSE.txt", import.meta.url),
  );
  const expected = JSON.parse(
    await readFile(new URL("../../slack-cli.lock.json", import.meta.url)),
  ).licenseSha256;
  const windows = Buffer.from(
    original.toString("utf8").replaceAll("\n", "\r\n"),
  );
  assert.deepEqual(lockedSlackLicense(windows, expected), original);
  assert.throws(
    () =>
      lockedSlackLicense(
        Buffer.concat([windows, Buffer.from("changed")]),
        expected,
      ),
    /license does not match/u,
  );
});

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
test("Windows curl transport preserves binary bytes, HTTP status and bounded execution", async () => {
  const bytes = Buffer.from([0, 255, 10, 50, 48, 48]);
  const signal = AbortSignal.timeout(1000);
  const actual = await fetchSlackBytesWithCurl(
    "https://api.github.com/test",
    { headers: { "Cache-Control": "no-cache" }, signal, limit: 32 },
    async (command, args, options) => {
      assert.equal(command, "curl.exe");
      assert.ok(args.includes("--http1.1"));
      assert.ok(args.includes("--ipv4"));
      assert.ok(args.includes("Cache-Control: no-cache"));
      assert.equal(options.signal, signal);
      assert.equal(options.maxBuffer, 36);
      return { stdout: Buffer.concat([bytes, Buffer.from("\n429")]) };
    },
  );
  assert.equal(actual.status, 429);
  assert.deepEqual(Buffer.from(await actual.arrayBuffer()), bytes);
});
test("Windows curl network failures still block after three attempts", async () => {
  let calls = 0;
  await assert.rejects(
    fetchSlackBytes("https://api.github.com/test", {
      sleep: noSleep,
      fetchImpl: (url, options) =>
        fetchSlackBytesWithCurl(url, options, async () => {
          calls++;
          throw new Error("connection reset");
        }),
    }),
    /blocked/u,
  );
  assert.equal(calls, 3);
});
test("Windows curl rejects malformed statuses and oversized responses", async () => {
  for (const stdout of [Buffer.from("body\n000"), Buffer.from("body\n200")]) {
    await assert.rejects(
      fetchSlackBytesWithCurl(
        "https://api.github.com/test",
        { headers: {}, signal: AbortSignal.timeout(1000), limit: 3 },
        async () => ({ stdout }),
      ),
      /invalid or oversized/u,
    );
  }
});
test("Windows release requires fresh same-commit CI", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  assert.ok(!workflow.includes("reuse_verified_windows_run_id"));
  assert.ok(workflow.includes("ref: ${{ github.sha }}"));
  assert.match(workflow, /package-windows:[\s\S]*?needs:[\s\S]*?- ci/);
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
    readFile(new URL(`../../${path}`, import.meta.url), "utf8");
  assert.match(await read("scripts/ci/verify-ci.mjs"), /"verify:slack-cli"/u);
  assert.match(await read("scripts/ci/verify-pre-push.mjs"), /verify:ci/u);
  for (const platform of ["mac", "windows"])
    assert.equal(
      (
        await read(
          `apps/desktop/scripts/packaging/package-${platform}-lite.mjs`,
        )
      ).match(/await verifySlackCliRelease\(\)/gu).length,
      2,
    );
  const workflow = await read(".github/workflows/release.yml");
  assert.match(
    workflow,
    /node scripts\/slack\/verify-slack-cli.mjs\s+node --input-type=module <<'NODE'[\s\S]+gh\('release', 'upload'[\s\S]+retry gh release edit/u,
  );
  assert.doesNotMatch(workflow, /Node.js 24|node-version: 24/u);
  const manifest = JSON.parse(await read("apps/desktop/package.json"));
  assert.equal(
    manifest.build.beforePack,
    "scripts/packaging/prepare-slack-cli.cjs",
  );
  assert.equal(
    manifest.build.mac.extraResources[0].from,
    "../../artifacts/slack-cli/darwin-${arch}",
  );
  assert.equal(
    manifest.build.win.extraResources[0].from,
    "../../artifacts/slack-cli/win32-${arch}",
  );
});

test("release uploads resume verified assets without replacing complete files", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const source = workflow
    .match(/node --input-type=module <<'NODE'\n([\s\S]*?)\n {10}NODE/u)[1]
    .replace(/^ {10}/gmu, "")
    .replace(/^import .*;\n/gmu, "");
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction(
    "execFileSync",
    "createHash",
    "readFileSync",
    "readdirSync",
    "setTimeout",
    "process",
    "console",
    source,
  );
  for (const scenario of [
    "missing",
    "existing",
    "lost-response",
    "mismatch",
    "starter",
    "api-retry",
  ]) {
    const bytes = Buffer.from("verified package");
    const expected = {
      id: 17,
      name: "package.zip",
      state: "uploaded",
      size: bytes.length,
      digest: `sha256:${sha256(bytes)}`,
    };
    let assets =
      scenario === "existing" || scenario === "mismatch"
        ? [{ ...expected }]
        : scenario === "starter"
          ? [
              {
                ...expected,
                state: "starter",
                size: bytes.length,
                digest: null,
              },
            ]
          : [];
    if (scenario === "mismatch") assets[0].digest = `sha256:${"0".repeat(64)}`;
    const uploads = [],
      deletes = [];
    let apiFailed = false;
    const execute = async () =>
      run(
        (_command, args) => {
          if (args[0] === "api") {
            if (scenario === "api-retry" && !apiFailed) {
              apiFailed = true;
              throw new Error("temporary API failure");
            }
            if (args[1] === "--method" && args[2] === "DELETE") {
              deletes.push(args[3]);
              assets = [];
              return "";
            }
            return JSON.stringify(
              args[1].includes("/assets?")
                ? assets
                : [{ id: 1, tag_name: "v1.6.15", draft: true }],
            );
          }
          assert.deepEqual(args, [
            "release",
            "upload",
            "v1.6.15",
            "release-assets/package.zip",
            "--repo",
            "EurekaRaider/Artemis",
          ]);
          uploads.push(args);
          assert.equal(assets.length, 0);
          assets = [{ ...expected }];
          if (scenario === "lost-response")
            throw new Error("upload response lost");
          return "";
        },
        createHash,
        () => bytes,
        () => ["package.zip"],
        async () => {},
        { env: { RELEASE_TAG: "v1.6.15" } },
        { log() {}, error() {} },
      );
    if (scenario === "mismatch") {
      await assert.rejects(
        execute,
        /Refusing to replace different existing asset/u,
      );
      assert.equal(uploads.length, 0);
    } else {
      await execute();
      assert.deepEqual(assets, [expected]);
      assert.equal(uploads.length, scenario === "existing" ? 0 : 1);
      assert.equal(deletes.length, scenario === "starter" ? 1 : 0);
    }
  }
});
