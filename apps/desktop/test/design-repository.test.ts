import { mkdtempSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DesignRepository } from "../src/main/design-repository.js";
import {
  normalizeDesignContent,
  patchDesignPage,
  renderDesignPage,
  designSourceMap,
} from "../src/main/design-document-source.js";
import { exportStaticDesign } from "../src/main/design-export.js";
// These tests use real SQLite commits and filesystem persistence.
// Windows CI disk latency varies across the entire suite.
if (process.platform === "win32") vi.setConfig({ testTimeout: 30_000 });

const context = {
  projectId: "p",
  threadId: "t",
  workspaceBinding: "/workspace",
  mode: "execute" as const,
};
const content = () =>
  normalizeDesignContent({
    schemaVersion: 1,
    title: "Prototype",
    brief: "Example",
    basis: [],
    interactionNotes: "Simulated",
    variants: [
      {
        id: "a",
        name: "A",
        description: "",
        pages: [
          {
            id: "one",
            name: "One",
            html: '<main data-design-id="root" data-design-container><span data-design-id="title" data-design-text="static">Hello</span><span data-design-id="bound" data-design-bind="name"></span></main><aside data-design-id="aside" data-design-container></aside>',
            parameters: [
              { name: "--design-gap", min: 0, max: 20, value: 4, unit: "px" },
            ],
            data: { name: "World" },
          },
        ],
      },
    ],
  });
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "design-repository-"));
  let repository = new DesignRepository(root);
  cleanup.push(() => {
    repository.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    get repository() {
      return repository;
    },
    restart() {
      repository.close();
      repository = new DesignRepository(root);
    },
  };
}
it("persists immutable CAS revisions and retains conflicting branches with idempotent operations", () => {
  const f = fixture();
  const first = f.repository.save(context, {
    operationId: "one",
    baseRevision: null,
    content: content(),
  });
  const input = {
    operationId: "two",
    documentId: first.documentId,
    baseRevision: first.revisionId,
    content: { ...content(), title: "Updated" },
  };
  const second = f.repository.save(context, input);
  expect(f.repository.save(context, input)).toEqual(second);
  const conflict = f.repository.save(context, {
    ...input,
    operationId: "three",
    content: content(),
  });
  expect(conflict.conflict).toBe(true);
  expect(f.repository.read(context, first.documentId).revisionId).toBe(
    second.revisionId,
  );
  expect(() =>
    f.repository.save(context, { ...input, content: content() }),
  ).toThrow(/Operation ID/);
  f.restart();
  expect(
    f.repository.read(context, first.documentId, conflict.revisionId),
  ).toEqual(conflict);
  expect(() =>
    f.repository.read(
      { ...context, workspaceBinding: "/other" },
      first.documentId,
    ),
  ).toThrow(/workspace/);
  expect(() =>
    f.repository.save(
      { ...context, mode: "plan" },
      { operationId: "denied", baseRevision: null, content: content() },
    ),
  ).toThrow(/Execute/);
});
it("keeps dispatch uncertain after restart and requires an explicit new request identity", () => {
  const f = fixture();
  const request = f.repository.enqueue(context, {
    requestId: "one",
    workflow: "design",
    text: "Explore",
  });
  expect(f.repository.claim(context)?.turnId).toBe(request.turnId);
  f.repository.enqueue(context, {
    requestId: "two",
    workflow: "code",
    text: "Continue",
  });
  expect(f.repository.claim(context)).toBeUndefined();
  f.restart();
  expect(f.repository.requests("t")[0]?.status).toBe("needs-reconciliation");
  expect(f.repository.claim(context)).toBeUndefined();
  const retried = f.repository.retry(context, "one");
  expect(retried.turnId).not.toBe(request.turnId);
  expect(retried.requestId).not.toBe("one");
  expect(f.repository.claim({ ...context, mode: "review" })).toBeUndefined();
  expect(
    f.repository.requests("t").find((item) => item.requestId === "two")?.status,
  ).toBe("paused");
});
it("pins handoff pages and validates references before enqueueing", () => {
  const f = fixture();
  const first = f.repository.save(context, {
    operationId: "one",
    baseRevision: null,
    content: content(),
  });
  const ref = {
    documentId: first.documentId,
    revisionId: first.revisionId,
    variantId: "a",
    pageIds: ["one"],
  };
  f.repository.enqueue(context, {
    requestId: "handoff",
    workflow: "code",
    text: "Implement",
    designRef: ref,
  });
  f.repository.save(context, {
    operationId: "two",
    documentId: first.documentId,
    baseRevision: first.revisionId,
    content: { ...content(), title: "New" },
  });
  expect(f.repository.claim(context)?.designRef).toEqual(ref);
  expect(() =>
    f.repository.enqueue(context, {
      requestId: "bad",
      workflow: "code",
      text: "Implement",
      designRef: { ...ref, pageIds: ["missing"] },
    }),
  ).toThrow(/pages/);
});
it("round-trips P3 data and static structure without persisting runtime DOM", () => {
  const page = content().variants[0]!.pages[0]!;
  const updated = patchDesignPage(page, [
    { type: "text", elementId: "title", text: "<New>" },
    { type: "binding", key: "name", value: "Ada" },
    { type: "parameter", name: "--design-gap", value: 12 },
    { type: "move", elementId: "title", parentId: "aside" },
  ]);
  expect(updated.html).toContain("&lt;New&gt;");
  expect(updated.html).not.toContain("Ada");
  expect(renderDesignPage(updated)).toContain("Ada");
  expect(renderDesignPage(updated)).toContain("--design-gap:12px");
  expect(
    designSourceMap(updated).find((item) => item.id === "title")?.parentId,
  ).toBe("aside");
  expect(() =>
    patchDesignPage(page, [
      { type: "text", elementId: "bound", text: "Wrong" },
    ]),
  ).toThrow(/static/);
  expect(() =>
    patchDesignPage(page, [
      { type: "move", elementId: "root", parentId: "title" },
    ]),
  ).toThrow(/static/);
  expect(() =>
    patchDesignPage(page, [
      {
        type: "style",
        elementId: "title",
        property: "color",
        value: "url(https://example.com)",
      },
    ]),
  ).toThrow(/style/);
  expect(() =>
    patchDesignPage(page, [
      { type: "parameter", name: "--design-gap", value: 21 },
    ]),
  ).toThrow(/range/);
});
it("rejects malformed IDs and exports a sandboxed static document", () => {
  const input = content();
  input.variants[0]!.pages[0]!.html =
    '<div data-design-id="a"></div><div data-design-id="a"></div>';
  expect(() => normalizeDesignContent(input)).toThrow(/unique/);
  const html = exportStaticDesign(
    '<script>alert(1)</script><button onclick="alert(2)">Submit</button><iframe src="https://example.com"></iframe>',
  );
  expect(html).not.toContain("alert(");
  expect(html).not.toContain("https://example.com");
  expect(html).toContain('sandbox=""');
  expect(html).toContain("script-src 'none'");
});

it("preserves goal continuation identity through restart and explicit retry", () => {
  const f = fixture();
  const request = f.repository.enqueue(context, {
    requestId: "goal-request",
    workflow: "design",
    text: "Continue the active goal",
    source: "goal-continuation",
    expectedGoalId: "goal-one",
  });
  f.restart();
  expect(f.repository.claim(context)).toMatchObject({
    source: "goal-continuation",
    expectedGoalId: "goal-one",
  });
  f.repository.settle(request.turnId, "failed", "Stopped");
  const retry = f.repository.retry(context, request.requestId);
  expect(retry).toMatchObject({
    source: "goal-continuation",
    expectedGoalId: "goal-one",
    status: "pending",
  });
  expect(retry.requestId).not.toBe(request.requestId);
});

it("rejects tampered or missing immutable content", () => {
  const f = fixture();
  const saved = f.repository.save(context, {
    operationId: "one",
    baseRevision: null,
    content: content(),
  });
  const file = join(f.root, "blobs", saved.digest);
  writeFileSync(file, "{}");
  expect(() => f.repository.read(context, saved.documentId)).toThrow(
    /integrity|hash|corrupt/i,
  );
  rmSync(file);
  expect(() => f.repository.read(context, saved.documentId)).toThrow();
});

it("keeps the previous head and permits an identical retry after a blob write failure", () => {
  const f = fixture();
  const saved = f.repository.save(context, {
    operationId: "one",
    baseRevision: null,
    content: content(),
  });
  const next = {
    operationId: "retry",
    documentId: saved.documentId,
    baseRevision: saved.revisionId,
    content: { ...content(), title: "Next" },
  };
  renameSync(join(f.root, "blobs"), join(f.root, "unavailable-blobs"));
  expect(() => f.repository.save(context, next)).toThrow();
  renameSync(join(f.root, "unavailable-blobs"), join(f.root, "blobs"));
  expect(f.repository.read(context, saved.documentId)).toEqual(saved);
  expect(f.repository.history(context, saved.documentId)).toHaveLength(1);
  expect(f.repository.save(context, next).content.title).toBe("Next");
});

it("enforces the revision cap without losing the last saved version", () => {
  const f = fixture();
  let saved = f.repository.save(context, {
    operationId: "0",
    baseRevision: null,
    content: content(),
  });
  for (let index = 1; index < 50; index++)
    saved = f.repository.save(context, {
      operationId: String(index),
      documentId: saved.documentId,
      baseRevision: saved.revisionId,
      content: { ...content(), title: String(index) },
    });
  expect(() =>
    f.repository.save(context, {
      operationId: "overflow",
      documentId: saved.documentId,
      baseRevision: saved.revisionId,
      content: content(),
    }),
  ).toThrow(/history limit/);
  expect(f.repository.read(context, saved.documentId)).toEqual(saved);
  expect(f.repository.history(context, saved.documentId)).toHaveLength(50);
});

it("injects the trusted bridge ahead of page scripts even when head has attributes", () => {
  const page = content().variants[0]!.pages[0]!;
  page.html =
    '<html><head data-label="a > b"><script>window.pageScript=true</script></head><body></body></html>';
  const rendered = renderDesignPage(
    page,
    "<script>window.trustedBridge=true</script>",
  );
  expect(rendered.indexOf("window.trustedBridge")).toBeLessThan(
    rendered.indexOf("window.pageScript"),
  );
  expect(page.html).not.toContain("window.trustedBridge");
});

it("retains edited prompts across delayed duplicate delivery and restart", () => {
  const f = fixture();
  const input = {
    requestId: "edited",
    workflow: "design" as const,
    text: "Original",
  };
  const original = f.repository.enqueue(context, input);
  f.repository.edit(context, input.requestId, "Edited");
  f.restart();
  const replay = f.repository.enqueue(context, input);
  expect(replay.text).toBe("Edited");
  expect(replay.turnId).toBe(original.turnId);
  expect(f.repository.requests(context.threadId)).toHaveLength(1);
  expect(() =>
    f.repository.enqueue(context, { ...input, text: "Different" }),
  ).toThrow(/reused/);
  expect(f.repository.claim(context)?.text).toBe("Edited");
});
