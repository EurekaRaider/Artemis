import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { WorkspaceHtmlPreview } from "../src/main/workspace-html-preview.js";

const roots: string[] = [];

it("allows bundled formula fonts without enabling inline scripts or arbitrary frames in the app", async () => {
  const html = await readFile(
    new URL("../index.html", import.meta.url),
    "utf8",
  );
  expect(html).toContain("font-src 'self' data:");
  expect(html).toContain("script-src 'self';");
  expect(html).not.toContain("script-src 'self' 'unsafe-inline'");
  expect(html).toContain("frame-src artemis-preview:");
});
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "artemis-html-"));
  roots.push(root);
  const workspace = join(root, "workspace");
  await mkdir(join(workspace, "site"), { recursive: true });
  await writeFile(
    join(workspace, "site/index.html"),
    '<button onclick="this.textContent=\'OK\'">Click</button><script src="app.js"></script>',
  );
  await writeFile(join(workspace, "site/app.js"), "window.ready=true");
  await writeFile(join(workspace, "site/secret.json"), "secret");
  let active = true;
  const service = new WorkspaceHtmlPreview(async () => {
    if (!active) throw new Error("archived");
    return workspace;
  });
  return {
    root,
    workspace,
    service,
    archive: () => {
      active = false;
    },
  };
}
it("serves interactive HTML with an opaque sandbox and no network or application access", async () => {
  const f = await fixture();
  const { url } = await f.service.open("task", "site/index.html");
  const response = await f.service.respond(new Request(url));
  expect(response.status).toBe(200);
  const policy = response.headers.get("Content-Security-Policy")!;
  expect(policy).toContain("sandbox allow-scripts");
  expect(policy).not.toContain("allow-same-origin");
  expect(policy).toContain("connect-src 'none'");
  expect(policy).toContain("form-action 'none'");
  expect(policy).toContain("frame-src 'none'");
  const document = await response.text();
  expect(document).toContain("onclick");
  expect(document).toContain("ResizeObserver");
  expect(document).toContain("MutationObserver");
  expect(document).toContain("artemis:html-size");
  expect(document).toContain("postMessage");
  const asset = await f.service.respond(new Request(new URL("app.js", url)));
  expect(await asset.text()).toBe("window.ready=true");
  expect(f.service.allowsNavigation(url)).toBe(true);
  expect(f.service.allowsNavigation(new URL("app.js", url).href)).toBe(false);
});
it("blocks unissued URLs, secrets, traversal, symlinks and unsupported methods", async () => {
  const f = await fixture();
  await mkdir(join(f.root, "outside"));
  await writeFile(join(f.root, "outside/private.js"), "secret");
  await symlink(
    join(f.root, "outside"),
    join(f.workspace, "site/escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const { url } = await f.service.open("task", "site/index.html");
  for (const path of [
    "secret.json",
    "escape/private.js",
    "../private.js",
    "%2e%2e%2fprivate.js",
  ])
    expect(
      (await f.service.respond(new Request(new URL(path, url)))).status,
    ).toBe(404);
  expect(
    (
      await f.service.respond(
        new Request("artemis-preview://unknown/index.html"),
      )
    ).status,
  ).toBe(404);
  expect(
    (await f.service.respond(new Request(url, { method: "POST" }))).status,
  ).toBe(405);
  f.service.release("other", url);
  expect((await f.service.respond(new Request(url))).status).toBe(200);
  f.service.release("task", url);
  expect((await f.service.respond(new Request(url))).status).toBe(404);
});
it("revokes access when a task is archived or the renderer closes", async () => {
  const f = await fixture();
  const { url } = await f.service.open("task", "site/index.html");
  f.archive();
  expect((await f.service.respond(new Request(url))).status).toBe(404);
  f.service.clear();
  expect(f.service.allowsNavigation(url)).toBe(false);
});
