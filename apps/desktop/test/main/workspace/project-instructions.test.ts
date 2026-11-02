import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProjectInstructions,
  MAX_PROJECT_INSTRUCTIONS_BYTES,
} from "../../../src/main/workspace/project-instructions.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "artemis-project-instructions-"));
  roots.push(root);
  const project = join(root, "project");
  await mkdir(project);
  const service = new ProjectInstructions((id) =>
    id === "project" ? { path: project } : undefined,
  );
  return { root, project, service };
}
describe("manual project AGENTS.md boundary", () => {
  it("reads missing as empty and creates UTF-8 only in the registered local checkout", async () => {
    const { project, service } = await fixture();
    expect(await service.read("project")).toBe("");
    await service.write("project", "# 项目指令\n");
    expect(await readFile(join(project, "AGENTS.md"), "utf8")).toBe(
      "# 项目指令\n",
    );
    expect(await service.read("project")).toBe("# 项目指令\n");
  });
  it.each([
    "../outside",
    "/tmp/outside",
    "project/../outside",
    "missing",
    "",
    null,
  ])("rejects unknown or path-shaped project identity %s", async (id) => {
    const { service } = await fixture();
    await expect(service.read(id)).rejects.toThrow();
    await expect(service.write(id, "escape")).rejects.toThrow();
  });
  it("rejects a link outside the project without changing its target", async () => {
    const { root, project, service } = await fixture();
    const outside = join(root, "outside.md");
    await writeFile(outside, "keep");
    await symlink(outside, join(project, "AGENTS.md"));
    await expect(service.read("project")).rejects.toThrow();
    await expect(service.write("project", "escape")).rejects.toThrow();
    expect(await readFile(outside, "utf8")).toBe("keep");
  });
  it("rejects oversized existing files and writes without truncating", async () => {
    const { project, service } = await fixture();
    const content = "x".repeat(MAX_PROJECT_INSTRUCTIONS_BYTES + 1);
    await expect(service.write("project", content)).rejects.toThrow();
    await writeFile(join(project, "AGENTS.md"), content);
    await expect(service.read("project")).rejects.toThrow();
    await expect(service.write("project", "replace")).rejects.toThrow();
    expect((await readFile(join(project, "AGENTS.md"))).length).toBe(
      content.length,
    );
  });
  it("rejects binary, invalid UTF-8, directories and non-text payloads", async () => {
    const { project, service } = await fixture();
    const file = join(project, "AGENTS.md");
    for (const bytes of [Buffer.from([0]), Buffer.from([0xff, 0xfe])]) {
      await writeFile(file, bytes);
      await expect(service.read("project")).rejects.toThrow();
      await expect(service.write("project", "replace")).rejects.toThrow();
    }
    await rm(file);
    await mkdir(file);
    await expect(service.read("project")).rejects.toThrow();
    await expect(service.write("project", "replace")).rejects.toThrow();
    await expect(service.write("project", null)).rejects.toThrow();
  });
});
