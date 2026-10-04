import { mkdtemp, mkdir, open, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceVideoPreview } from "../../../src/main/workspace/workspace-video-preview.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "artemis-video-"));
  roots.push(root);
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  await writeFile(join(workspace, "视频.mp4"), "0123456789");
  let active = true;
  let currentWorkspace = workspace;
  const service = new WorkspaceVideoPreview(async () => {
    if (!active) throw new Error("Inactive task");
    return currentWorkspace;
  });
  return {
    root,
    workspace,
    service,
    archive: () => {
      active = false;
    },
    move: (path: string) => {
      currentWorkspace = path;
    },
  };
}
describe("private workspace video streaming", () => {
  it.each(["mp3", "m4a", "wav", "ogg", "flac", "aac", "opus"])(
    "streams %s audio through the same private, revocable channel",
    async (extension) => {
      const f = await fixture();
      await writeFile(join(f.workspace, `sound.${extension}`), "0123456789");
      const audio = await f.service.open("task", `sound.${extension}`);
      expect(audio.mimeType).toMatch(/^audio\//u);
      const response = await f.service.respond(
        new Request(audio.url, { headers: { Range: "bytes=2-5" } }),
      );
      expect(response.status).toBe(206);
      expect(await response.text()).toBe("2345");
      f.service.release("task", audio.url);
      expect((await f.service.respond(new Request(audio.url))).status).toBe(
        404,
      );
    },
  );
  it("does not issue a late lease after the renderer closes", async () => {
    const f = await fixture();
    let finish!: (workspace: string) => void;
    const service = new WorkspaceVideoPreview(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = service.open("task", "视频.mp4");
    service.clear();
    finish(f.workspace);
    await expect(pending).rejects.toThrow("session closed");
  });
  it("rejects traversal, outside symlinks, unsupported files and unissued URLs", async () => {
    const f = await fixture();
    const outside = join(f.root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "outside.mp4"), "secret");
    // Windows runners can create junctions without symlink privileges.
    await symlink(
      outside,
      join(f.workspace, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeFile(join(f.workspace, "file.txt"), "text");
    for (const path of [
      "../outside/outside.mp4",
      "escape/outside.mp4",
      "file.txt",
    ])
      await expect(f.service.open("task", path)).rejects.toThrow();
    expect(
      (await f.service.respond(new Request("artemis-media://video/unknown")))
        .status,
    ).toBe(404);
  });
  it.each([
    [undefined, 200, "0123456789", null],
    ["bytes=2-5", 206, "2345", "bytes 2-5/10"],
    ["bytes=7-", 206, "789", "bytes 7-9/10"],
    ["bytes=-3", 206, "789", "bytes 7-9/10"],
    ["bytes=8-99", 206, "89", "bytes 8-9/10"],
    ["bytes=0-1,4-5", 200, "0123456789", null],
  ])(
    "serves %s without reading the entire file",
    async (range, status, body, contentRange) => {
      const { service } = await fixture();
      const video = await service.open("task", "视频.mp4");
      expect(video.url).not.toContain("视频");
      const response = await service.respond(
        new Request(video.url, { headers: range ? { Range: range } : {} }),
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("Content-Range")).toBe(contentRange);
      expect(response.headers.get("Content-Length")).toBe(String(body.length));
      expect(response.headers.get("Accept-Ranges")).toBe("bytes");
      expect(await response.text()).toBe(body);
    },
  );
  it("handles HEAD, invalid ranges, disallowed methods and release", async () => {
    const { service } = await fixture();
    const { url } = await service.open("task", "视频.mp4");
    const head = await service.respond(new Request(url, { method: "HEAD" }));
    expect(head.headers.get("Content-Length")).toBe("10");
    expect(await head.text()).toBe("");
    for (const range of [
      "bytes=20-",
      "bytes=6-2",
      "bytes=-0",
      "bytes=no",
      "bytes=9007199254740993-",
    ]) {
      const response = await service.respond(
        new Request(url, { headers: { Range: range } }),
      );
      expect(response.status).toBe(416);
      expect(response.headers.get("Content-Range")).toBe("bytes */10");
    }
    expect(
      (await service.respond(new Request(url, { method: "POST" }))).status,
    ).toBe(405);
    service.release("other-task", url);
    expect(
      (await service.respond(new Request(url, { method: "HEAD" }))).status,
    ).toBe(200);
    service.release("task", url);
    expect((await service.respond(new Request(url))).status).toBe(404);
  });
  it("rechecks task, workspace and file version on each request", async () => {
    const f = await fixture();
    const first = await f.service.open("task", "视频.mp4");
    await writeFile(join(f.workspace, "视频.mp4"), "replacement");
    expect((await f.service.respond(new Request(first.url))).status).toBe(409);
    const next = await f.service.open("task", "视频.mp4");
    f.move(f.root);
    expect((await f.service.respond(new Request(next.url))).status).toBe(404);
    f.move(f.workspace);
    const last = await f.service.open("task", "视频.mp4");
    f.archive();
    expect((await f.service.respond(new Request(last.url))).status).toBe(404);
  });
  it("streams a small range from a file over 100 MiB and accepts cancellation", async () => {
    const f = await fixture();
    const file = await open(join(f.workspace, "large.mp4"), "w");
    await file.truncate(128 * 1024 * 1024);
    await file.close();
    const { url } = await f.service.open("task", "large.mp4");
    const part = await f.service.respond(
      new Request(url, { headers: { Range: "bytes=100000000-100000003" } }),
    );
    expect((await part.arrayBuffer()).byteLength).toBe(4);
    const response = await f.service.respond(new Request(url));
    await response.body!.cancel();
    f.service.release("task", url);
  });
});
