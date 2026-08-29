import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TaskSourceImageStore } from "../src/main/task-source-images.js";

describe("task source image store", () => {
  it("persists source images outside the event payload and removes them with the task", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-task-source-images-"));
    const store = new TaskSourceImageStore(root);
    const data = Buffer.from("private image bytes").toString("base64");

    await store.save("thread-1", "source-1", {
      name: "image-1.png",
      mimeType: "image/png",
      data,
    });

    expect(await store.read("thread-1", "source-1")).toBe(data);
    expect(await readFile(join(root, "thread-1", "source-1"), "utf8")).toBe(
      "private image bytes",
    );

    await store.copyThread("thread-1", "thread-2");
    expect(await store.read("thread-2", "source-1")).toBe(data);

    await store.deleteThread("thread-1");
    await expect(store.read("thread-1", "source-1")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await store.read("thread-2", "source-1")).toBe(data);

    await store.copyThread("missing-thread", "thread-3");
    await expect(store.read("thread-3", "source-1")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects path-like task and source identifiers", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-task-source-images-"));
    const store = new TaskSourceImageStore(root);

    await expect(store.read("../thread", "source-1")).rejects.toThrow(
      "thread id is invalid",
    );
    await expect(store.read("thread-1", "../source")).rejects.toThrow(
      "image id is invalid",
    );
  });
});
