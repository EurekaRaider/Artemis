import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComputerObservation } from "@artemis/protocol";

const mocks = vi.hoisted(() => ({
  dialog: vi.fn(),
  act: vi.fn(),
  permissions: vi.fn(),
  open: vi.fn(),
}));
vi.mock("electron", () => ({
  dialog: { showMessageBox: mocks.dialog },
  nativeTheme: { shouldUseDarkColors: false },
  webContents: {},
}));
vi.mock("../../../src/main/computer-use/native-driver.js", () => ({
  ComputerNativeDriver: class {
    open = mocks.open;
    observe = async () => ({
      revision: "one",
      width: 800,
      height: 600,
      elements: [{ id: "button", role: "button", label: "Draft" }],
    });
    act = mocks.act;
    permissions = mocks.permissions;
    release = async () => {};
    dispose() {}
  },
}));
import { ComputerUseHost } from "../../../src/main/computer-use/host.js";

const context = { threadId: "task", turnId: "turn", mode: "work" as const };
const action = (observation: ComputerObservation, foreground = false) => ({
  targetId: observation.target.id,
  observationId: observation.observationId,
  actions: foreground
    ? [{ type: "key" as const, key: "Tab" as const }]
    : [{ type: "click" as const, elementId: "button" }],
});
let directory: string;
let host: ComputerUseHost;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.open
    .mockReset()
    .mockImplementation(async ({ target }: { target: string }) => ({
      id: "desktop:" + target,
      kind: "desktop",
      name: target,
      bundleId: target,
    }));
  mocks.act.mockReset().mockResolvedValue(undefined);
  mocks.dialog.mockResolvedValue({ response: 1, checkboxChecked: true });
  mocks.permissions.mockResolvedValue({
    accessibility: true,
    screenRecording: true,
  });
  directory = await mkdtemp(join(tmpdir(), "computer-grants-"));
  host = new ComputerUseHost({
    helperPath: "unused",
    permissionsPath: join(directory, "permissions.json"),
    window: () =>
      ({ isDestroyed: () => false, webContents: { send() {} } }) as never,
    locale: () => "en",
  });
});
afterEach(async () => {
  host.dispose();
  await rm(directory, { recursive: true, force: true });
});

describe("Computer Use task permissions", () => {
  it("expires a turn-only choice and never persists task or foreground permission", async () => {
    mocks.dialog.mockResolvedValue({ response: 0, checkboxChecked: true });
    const opened = await host.service.open({ target: "com.test.app" }, context);
    expect(
      host.taskApproval("computer_act", action(opened), context),
    ).toBeUndefined();
    await host.service.act(action(opened, true), context);
    expect((await host.permissions())[0]).toMatchObject({
      scope: "turn",
      foreground: true,
    });
    host.endTurn(context.threadId);
    expect(await host.permissions()).toEqual([]);
    await host.service.open(
      { target: "com.test.app" },
      { ...context, turnId: "next" },
    );
    expect(mocks.dialog).toHaveBeenCalledTimes(2);
    const { readFile } = await import("node:fs/promises");
    await expect(
      readFile(join(directory, "permissions.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cancels an executing batch on revocation before its next input", async () => {
    const opened = await host.service.open({ target: "com.test.app" }, context);
    const id = host.taskApproval("computer_act", action(opened), context)!;
    mocks.act.mockImplementationOnce(
      (_target, _action, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const running = host.service.act(
      {
        ...action(opened),
        actions: [
          { type: "click", elementId: "button" },
          { type: "key", key: "Tab" },
        ],
      },
      context,
    );
    const rejected = expect(running).rejects.toThrow(/revoked/);
    await vi.waitFor(() => expect(mocks.act).toHaveBeenCalledOnce());
    await host.revoke(id);
    await rejected;
    expect(mocks.act).toHaveBeenCalledOnce();
    expect(await host.permissions()).toEqual([]);
    await expect(
      host.service.open({ target: "com.test.app" }, context),
    ).rejects.toThrow(/paused/);
  });

  it("does not open a second dialog while the same target is awaiting consent", async () => {
    let finish!: (value: {
      response: number;
      checkboxChecked: boolean;
    }) => void;
    mocks.dialog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = host.service.open({ target: "com.test.app" }, context);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await expect(
      host.service.open({ target: "com.test.app" }, context),
    ).rejects.toThrow(/already opening/);
    finish({ response: 1, checkboxChecked: false });
    await first;
    expect(mocks.dialog).toHaveBeenCalledOnce();
  });

  it("reuses task access and foreground consent across turns but requires a fresh lease and observation", async () => {
    const first = await host.service.open({ target: "com.test.app" }, context);
    expect(
      host.taskApproval("computer_act", action(first), context),
    ).toBeTruthy();
    await host.service.act(action(first, true), context);
    host.endTurn(context.threadId);
    const next = { ...context, turnId: "next" };
    expect(
      host.taskApproval("computer_act", action(first), next),
    ).toBeUndefined();
    const second = await host.service.open({ target: "com.test.app" }, next);
    await expect(host.service.act(action(first), next)).rejects.toThrow(
      /observation/i,
    );
    await host.service.act(action(second, true), next);
    expect(mocks.dialog).toHaveBeenCalledTimes(1);
    expect(mocks.act).toHaveBeenLastCalledWith(
      second.target,
      { type: "key", key: "Tab" },
      expect.any(AbortSignal),
      true,
    );
  });

  it("keeps background-only task consent from being promoted by model actions", async () => {
    mocks.dialog.mockResolvedValue({ response: 1, checkboxChecked: false });
    const opened = await host.service.open({ target: "com.test.app" }, context);
    expect((await host.service.act(action(opened, true), context)).status).toBe(
      "blocked",
    );
    expect(mocks.dialog).toHaveBeenCalledTimes(1);
    expect(mocks.act).not.toHaveBeenCalled();
    expect(
      host.taskApproval("computer_act", action(opened), {
        ...context,
        mode: "plan",
      }),
    ).toBeUndefined();
    expect(
      host.taskApproval("computer_act", action(opened), {
        ...context,
        threadId: "other",
      }),
    ).toBeUndefined();
    expect(
      host.taskApproval(
        "computer_act",
        { ...action(opened), targetId: "desktop:other" },
        context,
      ),
    ).toBeUndefined();
    expect(
      host.taskApproval("other_tool", action(opened), context),
    ).toBeUndefined();
  });

  it("does not turn legacy persistent access into task approval or foreground access", async () => {
    await writeFile(
      join(directory, "permissions.json"),
      JSON.stringify({ version: 1, grants: { "desktop:com.test.app": "App" } }),
    );
    mocks.dialog.mockResolvedValue({ response: 0, checkboxChecked: false });
    const opened = await host.service.open({ target: "com.test.app" }, context);
    expect(
      host.taskApproval("computer_act", action(opened), context),
    ).toBeUndefined();
    host.endTurn(context.threadId);
    const next = await host.service.open(
      { target: "com.test.app" },
      { ...context, turnId: "next" },
    );
    expect(
      host.taskApproval("computer_act", action(next), {
        ...context,
        turnId: "next",
      }),
    ).toBeUndefined();
    expect(mocks.dialog).not.toHaveBeenCalled();
    expect(
      (
        await host.service.act(action(next, true), {
          ...context,
          turnId: "next",
        })
      ).status,
    ).toBe("blocked");
  });

  it("deduplicates denied access for a turn and cancels a pending grant on task invalidation", async () => {
    mocks.dialog.mockResolvedValueOnce({ response: 3, checkboxChecked: false });
    await expect(
      host.service.open({ target: "com.test.app" }, context),
    ).rejects.toThrow(/denied/);
    await expect(
      host.service.open({ target: "com.test.app" }, context),
    ).rejects.toThrow(/denied/);
    expect(mocks.dialog).toHaveBeenCalledTimes(1);
    let finish!: (value: {
      response: number;
      checkboxChecked: boolean;
    }) => void;
    mocks.dialog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const opening = host.service.open({ target: "com.test.other" }, context);
    const rejected = expect(opening).rejects.toThrow(
      /revoked|archived|aborted/i,
    );
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    host.clearTask(context.threadId, "Task archived");
    finish({ response: 1, checkboxChecked: true });
    await rejected;
    expect(
      (await host.permissions()).filter((p) => p.scope === "task"),
    ).toHaveLength(0);
  });

  it("Stop retains permission while revocation removes only the selected task grant", async () => {
    const opened = await host.service.open({ target: "com.test.app" }, context);
    const id = host.taskApproval("computer_act", action(opened), context)!;
    host.service.stopThread(context.threadId);
    expect(
      host.taskApproval("computer_act", action(opened), context),
    ).toBeUndefined();
    expect((await host.permissions()).some((p) => p.id === id)).toBe(true);
    host.service.resumeThread(context.threadId);
    const reopened = await host.service.open(
      { target: "com.test.app" },
      context,
    );
    expect(host.taskApproval("computer_act", action(reopened), context)).toBe(
      id,
    );
    host.endTurn(context.threadId);
    const otherContext = { ...context, threadId: "other" };
    const other = await host.service.open(
      { target: "com.test.app" },
      otherContext,
    );
    await host.revoke(id);
    expect(
      host.taskApproval("computer_act", action(other), otherContext),
    ).toBeTruthy();
    host.disable("Plugin disabled");
    expect(await host.permissions()).toEqual([]);
    expect(
      host.taskApproval("computer_act", action(other), otherContext),
    ).toBeUndefined();
  });
});

it("keeps Windows remembered grants separate for apps with the same display name", async () => {
  mocks.open.mockImplementation(async ({ target }: { target: string }) => ({
    id: "desktop:" + target,
    kind: "desktop",
    name: "Shared name",
    appId: target,
  }));
  mocks.dialog.mockResolvedValue({ response: 2, checkboxChecked: false });
  await host.service.open({ target: "win-app-a" }, context);
  host.endTurn(context.threadId);
  await host.service.open(
    { target: "win-app-b" },
    { ...context, turnId: "next" },
  );
  expect(mocks.dialog).toHaveBeenCalledTimes(2);
  expect(
    (await host.permissions()).filter(
      (permission) => permission.scope === "persistent",
    ),
  ).toHaveLength(2);
});

it("rejects native targets without stable application identity before granting access", async () => {
  mocks.open.mockResolvedValue({
    id: "desktop:window-42",
    kind: "desktop",
    name: "Application",
  });
  await expect(
    host.service.open({ target: "window-42" }, context),
  ).rejects.toThrow(/identity/);
  expect(mocks.dialog).not.toHaveBeenCalled();
});

it("remembers explicit foreground consent across tasks and host restarts without repeated dialogs", async () => {
  mocks.dialog.mockResolvedValue({ response: 2, checkboxChecked: true });
  let opened = await host.service.open({ target: "com.test.app" }, context);
  opened = await host.service.act(action(opened, true), context);
  await host.service.act(action(opened), context);
  host.clearTask(context.threadId);
  const second = { ...context, threadId: "second", turnId: "second-turn" };
  opened = await host.service.open({ target: "com.test.app" }, second);
  await host.service.act(action(opened, true), second);
  host.dispose();
  host = new ComputerUseHost({
    helperPath: "unused",
    permissionsPath: join(directory, "permissions.json"),
    window: () =>
      ({ isDestroyed: () => false, webContents: { send() {} } }) as never,
    locale: () => "en",
  });
  opened = await host.service.open({ target: "com.test.app" }, second);
  await host.service.act(action(opened, true), second);
  expect(mocks.dialog).toHaveBeenCalledOnce();
  expect(
    (await host.permissions()).find((p) => p.scope === "persistent"),
  ).toMatchObject({ foreground: true });
  expect(mocks.act).toHaveBeenLastCalledWith(
    opened.target,
    { type: "key", key: "Tab" },
    expect.any(AbortSignal),
    true,
  );
  expect(
    host.taskApproval("computer_act", action(opened), second),
  ).toBeUndefined();
  await host.revoke("desktop:com.test.app");
  expect(await host.permissions()).toEqual([]);
});

it("reuses remembered background access without silently expanding it to foreground", async () => {
  mocks.dialog.mockResolvedValue({ response: 2, checkboxChecked: false });
  await host.service.open({ target: "com.test.app" }, context);
  host.clearTask(context.threadId);
  const next = { ...context, threadId: "another" };
  const opened = await host.service.open({ target: "com.test.app" }, next);
  expect((await host.service.act(action(opened, true), next)).status).toBe(
    "blocked",
  );
  expect(mocks.dialog).toHaveBeenCalledOnce();
  expect(mocks.act).not.toHaveBeenCalled();
});
