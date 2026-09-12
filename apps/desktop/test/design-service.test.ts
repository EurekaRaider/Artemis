import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { DesignContent, RunMode } from "@artemis/protocol";
import { DesignRepository } from "../src/main/design-repository.js";
import { DesignService } from "../src/main/design-service.js";
import type { DesignPreviewHost } from "../src/main/design-preview-host.js";

const mocks = vi.hoisted(() => ({ dialog: vi.fn(), decode: vi.fn() }));
vi.mock("electron", () => ({
  dialog: { showMessageBox: mocks.dialog },
  nativeImage: { createFromBuffer: mocks.decode },
}));
const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  vi.resetAllMocks();
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "design-service-"));
  const repository = new DesignRepository(root);
  cleanup.push(() => {
    repository.close();
    rmSync(root, { recursive: true, force: true });
  });
  const context = {
    threadId: "t",
    projectId: "p",
    workspaceBinding: root,
    mode: "execute" as RunMode,
  };
  const restore = vi.fn();
  const preview = {
    state: vi.fn(),
    stop: vi.fn(),
    inspect: vi.fn(),
    show: vi.fn(),
    suspendVisibility: vi.fn(() => restore),
  };
  const service = new DesignService(
    repository,
    preview as unknown as DesignPreviewHost,
    async () => ({ ...context }),
    vi.fn(),
  );
  const content: DesignContent = {
    schemaVersion: 1,
    title: "Fixture",
    brief: "",
    basis: [],
    interactionNotes: "",
    variants: [
      {
        id: "v",
        name: "V",
        description: "",
        pages: ["a", "b"].map((id) => ({
          id,
          name: id,
          html: `<span data-design-id="text" data-design-text="static">${id}</span>`,
          parameters: [],
          data: {},
        })),
      },
    ],
  };
  const revision = repository.save(context, {
    operationId: "initial",
    baseRevision: null,
    content,
  });
  const patch = {
    action: "patch" as const,
    documentId: revision.documentId,
    baseRevision: revision.revisionId,
    operationId: "edit",
    variantId: "v",
    pageId: "a",
    patches: [{ type: "text" as const, elementId: "text", text: "edited" }],
  };
  return { context, repository, service, preview, restore, revision, patch };
}

it("rejects Plan and Review writes before preview or mutation and stops existing previews", async () => {
  const f = fixture();
  for (const mode of ["plan", "review"] as const) {
    f.context.mode = mode;
    f.preview.state.mockReturnValue({ status: "running" });
    await f.service.state("t");
    await expect(f.service.action("t", f.patch)).rejects.toThrow(/Execute/);
    await expect(
      f.service.tool(
        "t",
        {
          action: "inspect",
          documentId: f.revision.documentId,
          revisionId: f.revision.revisionId,
          variantId: "v",
          pageId: "a",
        },
        "design",
      ),
    ).rejects.toThrow(/Execute/);
  }
  expect(f.preview.stop).toHaveBeenCalledTimes(2);
  expect(f.preview.inspect).not.toHaveBeenCalled();
  expect(f.repository.history(f.context, f.revision.documentId)).toHaveLength(
    1,
  );
});

it("restricts implementation reads to the selected immutable revision and pages", async () => {
  const f = fixture();
  const ref = {
    documentId: f.revision.documentId,
    revisionId: f.revision.revisionId,
    variantId: "v",
    pageIds: ["a"],
  };
  const input = {
    action: "read" as const,
    documentId: ref.documentId,
    revisionId: ref.revisionId,
  };
  const result = (await f.service.tool("t", input, "code", ref)) as {
    text: string;
  };
  expect(
    JSON.parse(result.text).content.variants[0].pages.map(
      (p: { id: string }) => p.id,
    ),
  ).toEqual(["a"]);
  await expect(
    f.service.tool("t", { ...input, pageId: "b", variantId: "v" }, "code", ref),
  ).rejects.toThrow(/existing/);
  await expect(
    f.service.tool("t", { ...input, revisionId: "other" }, "code", ref),
  ).rejects.toThrow(/immutable/);
  await expect(
    f.service.tool("t", { ...input, visual: true }, "code", ref),
  ).rejects.toThrow(/exact/);
});

it("retains drafts on cancellation or workspace mismatch and restores preview visibility", async () => {
  const f = fixture();
  await f.service.draft("t", "draft", f.patch);
  mocks.dialog.mockResolvedValueOnce({ response: 2 });
  expect(await f.service.confirmLeave("t")).toBe(false);
  expect(f.service.hasDrafts("t")).toBe(true);
  expect(f.restore).toHaveBeenCalledOnce();
  f.context.workspaceBinding += "-other";
  mocks.dialog
    .mockResolvedValueOnce({ response: 0 })
    .mockResolvedValueOnce({ response: 0 });
  expect(await f.service.confirmLeave("t")).toBe(false);
  expect(f.service.hasDrafts("t")).toBe(true);
  expect(f.restore).toHaveBeenCalledTimes(2);
});

it("saves a draft before leaving and refuses implementation while drafts remain", async () => {
  const f = fixture();
  await f.service.draft("t", "draft", f.patch);
  await expect(
    f.service.action("t", {
      action: "implement",
      requestId: "implement",
      ref: {
        documentId: f.revision.documentId,
        revisionId: f.revision.revisionId,
        variantId: "v",
        pageIds: ["a"],
      },
    }),
  ).rejects.toThrow(/drafts/);
  mocks.dialog.mockResolvedValueOnce({ response: 0 });
  expect(await f.service.confirmLeave("t")).toBe(true);
  expect(f.service.hasDrafts("t")).toBe(false);
  expect(
    f.repository.read(f.context, f.revision.documentId).content.variants[0]!
      .pages[0]!.html,
  ).toContain("edited");
});
