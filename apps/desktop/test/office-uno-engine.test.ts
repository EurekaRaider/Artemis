import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { CapabilityPackManifest } from "@artemis/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnoOfficeEngine } from "../src/main/office-uno-engine.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));

const roots: string[] = [];
const streams: PassThrough[] = [];

function child() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  streams.push(stdin, stdout, stderr);
  return Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    kill: vi.fn(() => true),
  });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "artemis-office-startup-"));
  roots.push(root);
  const office = child();
  const bridge = child();
  vi.mocked(spawn)
    .mockReturnValueOnce(office as unknown as ReturnType<typeof spawn>)
    .mockReturnValueOnce(bridge as unknown as ReturnType<typeof spawn>);
  const release = vi.fn();
  const engine = await UnoOfficeEngine.create(
    root,
    {
      version: "1.0.0",
      entrypoint: "office-bridge",
      officeExecutable: "runtime/program/soffice",
    } as CapabilityPackManifest,
    join(root, "profile"),
    release,
  );
  vi.useFakeTimers();
  return { engine, office, bridge, release };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.clearAllMocks();
  for (const stream of streams.splice(0)) stream.destroy();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("UnoOfficeEngine startup", () => {
  it("allows a slow first response while retaining the operation deadline afterwards", async () => {
    const { engine, bridge, office, release } = await fixture();
    const settled = vi.fn();
    const opening = engine.open("fixture.docx", "word");
    void opening.then(settled, settled);
    const request = JSON.parse(bridge.stdin.read().toString());
    await vi.advanceTimersByTimeAsync(45_000);
    expect(settled).not.toHaveBeenCalled();
    expect(bridge.kill).not.toHaveBeenCalled();
    bridge.stdout.write(`${JSON.stringify({ id: request.id, result: {} })}\n`);
    await expect(opening).resolves.toEqual({});

    const timedOut = expect(engine.snapshot()).rejects.toThrow(
      "Office snapshot timed out",
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await timedOut;
    expect(bridge.kill).toHaveBeenCalledOnce();
    expect(office.kill).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("still bounds an engine that never responds during startup", async () => {
    const { engine, bridge, office, release } = await fixture();
    const timedOut = expect(
      engine.open("fixture.docx", "word"),
    ).rejects.toThrow("Office open timed out");
    await vi.advanceTimersByTimeAsync(89_999);
    expect(bridge.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await timedOut;
    expect(bridge.kill).toHaveBeenCalledOnce();
    expect(office.kill).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("fails immediately when the bridge exits before startup completes", async () => {
    const { engine, bridge, release } = await fixture();
    const failed = expect(engine.open("fixture.docx", "word")).rejects.toThrow(
      "Office engine exited",
    );
    bridge.emit("exit", 1, null);
    await failed;
    await engine.close();
    expect(release).toHaveBeenCalledOnce();
  });
});
