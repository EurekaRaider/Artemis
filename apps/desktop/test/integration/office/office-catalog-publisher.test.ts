import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const publisher = fileURLToPath(
  new URL(
    "../../../../../scripts/office/publish-office-catalog.mjs",
    import.meta.url,
  ),
);
const mac = { platform: "darwin", arch: "arm64", version: "1.0.0" };
const previous = { publicKeys: { release: "trusted-key" }, manifests: [mac] };
const next = {
  ...previous,
  manifests: [mac, { platform: "win32", arch: "x64", version: "1.0.1" }],
};

function publish(
  before: unknown,
  after: unknown,
  mismatch = false,
  large = false,
) {
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
  assert.equal(options.headers.Authorization,'Bearer fixture-token');
  const method=options.method ?? 'GET';
  const endpoint=new URL(url).pathname.split('/Artemis/')[1];
  requests.push(method);
  writeFileSync(${JSON.stringify(requests)},JSON.stringify(requests));
  if(endpoint.startsWith('git/matching-refs/')) return Response.json([]);
  if(endpoint==='git/ref/heads/main') return Response.json({object:{sha:'main-sha'}});
  if(endpoint==='git/refs') {
    assert.equal(method,'POST');
    assert.ok(JSON.parse(options.body).ref.startsWith('refs/heads/codex/catalog-'));
    return Response.json({});
  }
  if(endpoint==='pulls') return Response.json(method==='POST' ? {html_url:'https://github.com/EurekaRaider/Artemis/pull/123'} : []);
  assert.equal(endpoint,'contents/apps/desktop/resources/office-runtime/catalog.json');
  if(method==='PUT'){
    const body=JSON.parse(options.body);
    assert.equal(body.sha,'current-sha');
    assert.ok(body.branch.startsWith('codex/catalog-'));
    stored=JSON.parse(Buffer.from(body.content,'base64').toString());
    return Response.json({});
  }
  if(options.headers.Accept==='application/vnd.github.raw+json') return Response.json(${mismatch} && requests.includes('PUT') ? {} : stored);
  if(${large}) return Response.json({sha:'current-sha',content:'',encoding:'none'});
  return Response.json({sha:'current-sha',content:Buffer.from(JSON.stringify(${mismatch} && requests.includes('PUT') ? {} : stored)).toString('base64')});
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
  it("proposes a branch PR with optimistic concurrency and verifies readback", () => {
    const result = publish(previous, next);
    expect(result.error).toBe("");
    expect(result.requests).toEqual([
      "GET",
      "GET",
      "GET",
      "GET",
      "POST",
      "GET",
      "PUT",
      "GET",
      "GET",
      "POST",
    ]);
    expect(result.output).toContain("Catalog review:");
    expect(publish(next, next).requests).toEqual(["GET", "GET"]);
  });

  it("publishes a catalog whose Contents API response omits inline content", () => {
    expect(publish(previous, next, false, true).error).toBe("");
    expect(publish(previous, next, true, true).error).toContain(
      "readback mismatch",
    );
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
