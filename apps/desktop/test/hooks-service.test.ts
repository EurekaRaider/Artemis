import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  HooksService,
  interpretHookOutput,
  mergeHookResults,
} from "../src/main/hooks-service.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture(command = "echo invoked") {
  const root = await mkdtemp(join(tmpdir(), "artemis-hooks-"));
  dirs.push(root);
  await mkdir(join(root, ".artemis", "hooks"), { recursive: true });
  const config = join(root, ".artemis", "hooks.json");
  await writeFile(
    config,
    JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command }] }] },
    }),
  );
  const service = new HooksService(join(root, "state"), join(root, "user"));
  const context = {
    projectId: "project",
    workspacePath: root,
    threadId: "thread",
    mode: "work" as const,
    remote: false,
  };
  const input = {
    version: 1 as const,
    hook_event_name: "PreToolUse" as const,
    session_id: "thread",
    turn_id: "turn",
    cwd: root,
    permission_mode: "work",
    tool_name: "write",
  };
  return { root, service, context, input, config };
}
it("does not run discovered hooks until the exact definition is trusted", async () => {
  const f = await fixture();
  expect(await f.service.run(f.context, f.input)).toEqual({});
  expect(f.service.records()).toHaveLength(0);
  const [hook] = await f.service.list(f.context);
  await f.service.trust(
    f.context,
    [{ id: hook!.id, hash: hook!.hash }],
    "project",
  );
  await f.service.run(f.context, f.input);
  expect(f.service.records()[0]?.status).toBe("success");
});
it("never starts a trusted command in Plan or Review, including IM tasks", async () => {
  const f = await fixture();
  const [hook] = await f.service.list(f.context);
  await f.service.trust(
    f.context,
    [{ id: hook!.id, hash: hook!.hash }],
    "project",
  );
  for (const context of [
    { ...f.context, mode: "plan" as const },
    { ...f.context, mode: "plan" as const },
    { ...f.context, mode: "plan" as const, remote: true },
    { ...f.context, mode: "plan" as const, remote: true },
  ])
    await f.service.run(context, f.input);
  expect(f.service.records()).toHaveLength(0);
});
it("invalidates trust when a managed script changes and rejects stale review", async () => {
  const f = await fixture();
  const [hook] = await f.service.list(f.context);
  await f.service.trust(
    f.context,
    [{ id: hook!.id, hash: hook!.hash }],
    "project",
  );
  await writeFile(join(f.root, ".artemis", "hooks", "check.js"), "changed");
  expect((await f.service.list(f.context))[0]?.status).toBe("pending");
  await expect(
    f.service.trust(f.context, [{ id: hook!.id, hash: hook!.hash }], "project"),
  ).rejects.toThrow(/changed/);
  await f.service.run(f.context, f.input);
  expect(f.service.records()).toHaveLength(0);
});
it("persists trust locally and revokes it without modifying repository configuration", async () => {
  const f = await fixture();
  const before = await readFile(f.config, "utf8");
  const [hook] = await f.service.list(f.context);
  await f.service.trust(
    f.context,
    [{ id: hook!.id, hash: hook!.hash }],
    "project",
  );
  const restarted = new HooksService(
    join(f.root, "state"),
    join(f.root, "user"),
  );
  expect((await restarted.list(f.context))[0]?.status).toBe("trusted");
  await restarted.change(f.context, hook!.id, "revoke");
  expect((await restarted.list(f.context))[0]?.status).toBe("pending");
  expect(await readFile(f.config, "utf8")).toBe(before);
});
it("blocks before execution on malformed hook output", async () => {
  const f = await fixture("echo {invalid");
  const [hook] = await f.service.list(f.context);
  await f.service.trust(
    f.context,
    [{ id: hook!.id, hash: hook!.hash }],
    "project",
  );
  expect((await f.service.run(f.context, f.input)).blocked).toBe(true);
});
it("revoking a running hook terminates its process tree", async () => {
  const f = await fixture(
    process.platform === "win32" ? "ping -n 30 127.0.0.1 > nul" : "sleep 30",
  );
  const [hook] = await f.service.list(f.context);
  await f.service.trust(
    f.context,
    [{ id: hook!.id, hash: hook!.hash }],
    "project",
  );
  const run = f.service.run(f.context, f.input);
  for (let count = 0; !f.service.records().length && count < 100; count++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  await f.service.change(f.context, hook!.id, "revoke");
  expect((await run).blocked).toBe(true);
  expect(f.service.records()[0]?.status).toBe("cancelled");
});
it("times out without leaving a successful check", async () => {
  const f = await fixture();
  await writeFile(
    f.config,
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                type: "command",
                command:
                  process.platform === "win32"
                    ? "ping -n 30 127.0.0.1 > nul"
                    : "sleep 30",
                timeout: 0.05,
              },
            ],
          },
        ],
      },
    }),
  );
  const [hook] = await f.service.list(f.context);
  await f.service.trust(
    f.context,
    [{ id: hook!.id, hash: hook!.hash }],
    "project",
  );
  expect((await f.service.run(f.context, f.input)).blocked).toBe(true);
  expect(f.service.records()[0]?.error).toMatch(/timed out/);
});
it("does not grant project hooks access to other projects", async () => {
  const f = await fixture();
  const [hook] = await f.service.list(f.context);
  await expect(
    f.service.trust(f.context, [{ id: hook!.id, hash: hook!.hash }], "all"),
  ).rejects.toThrow(/global/);
  await f.service.trust(
    f.context,
    [{ id: hook!.id, hash: hook!.hash }],
    "project",
  );
  expect(
    (await f.service.list({ ...f.context, projectId: "another" }))[0]?.status,
  ).toBe("pending");
});
it("invalidates an entire file when it contains unsupported handlers", async () => {
  const f = await fixture();
  await writeFile(
    f.config,
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { type: "command", command: "echo allowed" },
              { type: "agent", prompt: "unsupported" },
            ],
          },
        ],
      },
    }),
  );
  expect(await f.service.list(f.context)).toEqual([
    expect.objectContaining({ status: "invalid" }),
  ]);
});
it("loads plugin hooks separately from installation trust and disabling a plugin stops execution", async () => {
  const f = await fixture();
  const root = join(f.root, "plugin");
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "artemis.plugin.json"),
    JSON.stringify({
      hooks: {
        hooks: { Stop: [{ hooks: [{ type: "command", command: "echo." }] }] },
      },
    }),
  );
  const service = new HooksService(
    join(f.root, "other-state"),
    join(f.root, "user"),
    async () => [{ id: "plugin", root, contentHash: "signed-content" }],
  );
  const hook = (await service.list(f.context)).find(
    (h) => h.source === "plugin",
  )!;
  expect(hook.status).toBe("pending");
  await service.trust(f.context, [{ id: hook.id, hash: hook.hash }], "project");
  await service.setPluginEnabled("plugin", false);
  expect(
    (await service.list(f.context)).find((h) => h.id === hook.id)?.status,
  ).toBe("disabled");
});

it("rejects catastrophic matchers without executing commands", async () => {
  const f = await fixture();
  await writeFile(
    f.config,
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "(a|aa)+$",
            hooks: [{ type: "command", command: "echo unsafe" }],
          },
        ],
      },
    }),
  );
  expect((await f.service.list(f.context))[0]?.status).toBe("invalid");
  expect(f.service.records()).toEqual([]);
});
it("shares unchanged project trust with a worktree and invalidates divergent content", async () => {
  const f = await fixture();
  const tree = join(f.root, "worktree");
  await mkdir(join(tree, ".artemis"), { recursive: true });
  await writeFile(
    join(tree, ".artemis", "hooks.json"),
    await readFile(f.config),
  );
  const [hook] = await f.service.list(f.context);
  await f.service.trust(
    f.context,
    [{ id: hook!.id, hash: hook!.hash }],
    "project",
  );
  const context = { ...f.context, workspacePath: tree };
  expect((await f.service.list(context))[0]?.status).toBe("trusted");
  await writeFile(
    join(tree, ".artemis", "hooks.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { hooks: [{ type: "command", command: "echo different" }] },
        ],
      },
    }),
  );
  expect((await f.service.list(context))[0]?.status).toBe("pending");
});
it("allows explicit user-hook trust in a mixed project-scoped review", async () => {
  const f = await fixture();
  await mkdir(join(f.root, "user"));
  await writeFile(join(f.root, "user", "hooks.json"), await readFile(f.config));
  const context = { projectId: "user", workspacePath: f.root };
  const [hook] = await f.service.list(context);
  await f.service.trust(
    context,
    [{ id: hook!.id, hash: hook!.hash }],
    "project",
  );
  expect(
    (await f.service.list(f.context)).find((h) => h.source === "user"),
  ).toMatchObject({ status: "trusted", scope: "all" });
});
it("denies permission mutations at both supported decision nesting levels", () => {
  for (const specific of [
    { updatedInput: {}, decision: { behavior: "allow" } },
    { decision: { behavior: "allow", updatedInput: {} } },
    { decision: { behavior: "allow", updatedPermissions: [] } },
  ]) {
    expect(
      interpretHookOutput(
        "PermissionRequest",
        JSON.stringify({ hookSpecificOutput: specific }),
        0,
        "",
      ).permission,
    ).toBe("deny");
  }
  expect(
    interpretHookOutput(
      "PermissionRequest",
      '{"hookSpecificOutput":{"decision":{"behavior":"allow"}}}',
      0,
      "",
    ).permission,
  ).toBe("allow");
});
it("gives denial, cancellation and conflicting rewrites priority", () => {
  expect(
    mergeHookResults([{ permission: "deny" }, { permission: "allow" }])
      .permission,
  ).toBe("deny");
  expect(mergeHookResults([{ continuation: "again" }, { stop: true }])).toEqual(
    { stop: true },
  );
  expect(
    mergeHookResults([
      { updatedInput: { path: "a" } },
      { updatedInput: { path: "b" } },
    ]).blocked,
  ).toBe(true);
  expect(
    interpretHookOutput("PreToolUse", '{"continue":false}', 0, "").blocked,
  ).toBe(true);
});

it("isolates an invalid plugin source while keeping other hooks reviewable", async () => {
  const f = await fixture();
  const plugin = join(f.root, "plugin");
  await mkdir(plugin, { recursive: true });
  await writeFile(
    join(plugin, "artemis.plugin.json"),
    JSON.stringify({ hooks: "../escape.json" }),
  );
  const service = new HooksService(
    join(f.root, "state"),
    join(f.root, "user"),
    async () => [{ id: "bad-plugin", root: plugin, contentHash: "digest" }],
  );
  const hooks = await service.list(f.context);
  expect(hooks.find((h) => h.source === "plugin")).toMatchObject({
    status: "invalid",
  });
  expect(hooks.find((h) => h.source === "project")).toMatchObject({
    status: "pending",
  });
  expect(service.records()).toEqual([]);
});

it("applies normal trust and revocation rules to IM Execute hooks", async () => {
  const f = await fixture();
  const context = { ...f.context, remote: true };
  expect(await f.service.run(context, f.input)).toEqual({});
  expect(f.service.records()).toHaveLength(0);
  const [hook] = await f.service.list(context);
  await f.service.trust(
    context,
    [{ id: hook!.id, hash: hook!.hash }],
    "project",
  );
  await f.service.run(context, f.input);
  expect(f.service.records()).toHaveLength(1);
  expect(f.service.records()[0]?.status).toBe("success");
  await f.service.change(context, hook!.id, "revoke");
  await f.service.run(context, f.input);
  expect(f.service.records()).toHaveLength(1);
});
