import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const publisher = fileURLToPath(
  new URL(
    "../../../scripts/office/publish-office-catalog.mjs",
    import.meta.url,
  ),
);
const mac = { platform: "darwin", arch: "arm64", version: "1.0.0" };
const previous = { publicKeys: { release: "trusted-key" }, manifests: [mac] };
const next = {
  ...previous,
  manifests: [mac, { platform: "win32", arch: "x64", version: "1.0.1" }],
};

function publish(before: unknown, after: unknown, mismatch = false) {
  const directory = mkdtempSync(join(tmpdir(), "office-catalog-publisher-"));
  const input = join(directory, "catalog.json");
  const requests = join(directory, "requests.json");
  const mock = join(directory, "mock #.mjs");
  writeFileSync(input, JSON.stringify(after));
  writeFileSync(requests, "[]");
  writeFileSync(
    mock,
    `import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
let stored=${JSON.stringify(before)};
const requests=[];
globalThis.fetch=async (url, options)=>{
  assert.equal(url,'https://api.github.com/repos/EurekaRaider/ArtemisRelease/contents/office-runtime/catalog.json');
  assert.equal(options.headers.Authorization,'Bearer fixture-token');
  requests.push(options.method);
  writeFileSync(${JSON.stringify(requests)},JSON.stringify(requests));
  if(options.method==='PUT'){
    const body=JSON.parse(options.body);
    assert.equal(body.sha,'current-sha');
    assert.equal(body.branch,'main');
    stored=JSON.parse(Buffer.from(body.content,'base64').toString());
    return new Response('{}');
  }
  if(options.headers.Accept==='application/vnd.github.raw+json')
    return new Response(JSON.stringify(${mismatch} && requests.includes('PUT') ? {} : stored));
  return new Response(JSON.stringify({sha:'current-sha'}));
};`,
  );
  try {
    let output = "";
    let error: unknown;
    try {
      output = execFileSync(
        process.execPath,
        ["--import", pathToFileURL(mock).href, publisher, input],
        {
          env: { ...process.env, GH_TOKEN: "fixture-token" },
          encoding: "utf8",
          stdio: "pipe",
        },
      );
    } catch (caught) {
      error = caught;
    }
    return {
      output,
      error: String(error ?? ""),
      requests: JSON.parse(readFileSync(requests, "utf8")) as string[],
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("Office catalog publisher", () => {
  it("publishes through HTTPS with optimistic concurrency and verifies readback", () => {
    const result = publish(previous, next);
    expect(result.error).toBe("");
    expect(result.requests).toEqual(["GET", "GET", "PUT", "GET"]);
    expect(result.output).toContain("macOS entry retained");
    expect(publish(next, next).requests).toEqual(["GET", "GET"]);
  });

  it("rejects changed trust roots or removed platforms before writing", () => {
    for (const invalid of [
      { ...next, publicKeys: { release: "different-key" } },
      { ...next, manifests: [next.manifests[1]] },
    ]) {
      const result = publish(previous, invalid);
      expect(result.error).toMatch(/trust roots|existing platform/);
      expect(result.requests).toEqual(["GET", "GET"]);
    }
  });

  it("rejects a mismatched published readback", () => {
    expect(publish(previous, next, true).error).toContain("readback mismatch");
  });
});
