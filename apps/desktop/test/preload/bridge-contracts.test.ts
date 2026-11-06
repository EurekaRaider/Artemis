import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import contracts from "../fixtures/preload/bridge-contracts.json";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  exposeInMainWorld: vi.fn(),
  getPathForFile: vi.fn(),
  bindPreviewCanvas: vi.fn(),
  unbindPreviewCanvas: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcRenderer: native,
  contextBridge: { exposeInMainWorld: native.exposeInMainWorld },
  webUtils: { getPathForFile: native.getPathForFile },
}));
vi.mock("../../src/preload/preview-textures.js", () => ({
  bindPreviewCanvas: native.bindPreviewCanvas,
  unbindPreviewCanvas: native.unbindPreviewCanvas,
}));
let api: Record<string, (...args: any[]) => any>;
beforeAll(async () => {
  await import("../../src/preload/preload.js");
  expect(native.exposeInMainWorld).toHaveBeenCalledTimes(1);
  expect(native.exposeInMainWorld.mock.calls[0]![0]).toBe("artemis");
  api = native.exposeInMainWorld.mock.calls[0]![1];
});
beforeEach(() => vi.resetAllMocks());

it("preserves the complete public bridge and its enumeration order", () => {
  expect(Object.keys(api)).toEqual(
    Object.values(contracts)
      .flat()
      .map((c) => c.name),
  );
});
for (const [domain, cases] of Object.entries(contracts))
  describe(domain, () => {
    for (const contract of cases)
      it(contract.name, async () => {
        const method = api[contract.name]!;
        if (contract.kind === "invoke" || contract.kind === "send") {
          const entry = contract as {
            kind: "invoke" | "send";
            channel: string;
            arity: number;
            args: unknown[];
          };
          const args = Array.from(
            { length: entry.arity },
            (_, i) => `argument-${i}`,
          );
          const result = Promise.resolve({ result: contract.name });
          native.invoke.mockReturnValueOnce(result);
          expect(method(...args)).toBe(
            entry.kind === "invoke" ? result : undefined,
          );
          expect(native[entry.kind]).toHaveBeenCalledExactlyOnceWith(
            entry.channel,
            ...entry.args,
          );
          if (entry.kind === "invoke") {
            const failure = Promise.reject(new Error("host rejected"));
            native.invoke.mockReturnValueOnce(failure);
            await expect(method(...args)).rejects.toThrow("host rejected");
          }
        } else if (contract.kind === "event") {
          const entry = contract as { channel: string };
          const listener = vi.fn();
          const dispose = method(listener);
          expect(native.on).toHaveBeenCalledExactlyOnceWith(
            entry.channel,
            expect.any(Function),
          );
          const handler = native.on.mock.calls[0]![1];
          const payload = { domain, name: contract.name };
          handler({ sender: "must stay isolated" }, payload);
          expect(listener).toHaveBeenCalledExactlyOnceWith(
            ...(contract.name === "onWorkspaceTabMenuClosed" ? [] : [payload]),
          );
          dispose();
          expect(native.removeListener).toHaveBeenCalledExactlyOnceWith(
            entry.channel,
            handler,
          );
        } else if (contract.kind === "texture") {
          expect(method).toBe(
            native[
              contract.name as "bindPreviewCanvas" | "unbindPreviewCanvas"
            ],
          );
        } else if (contract.kind === "ready") {
          method();
          expect(native.send).toHaveBeenCalledExactlyOnceWith(
            "artemis:renderer-ready",
            {
              contextIsolated: process.contextIsolated === true,
              sandboxed: process.sandboxed === true,
            },
          );
        } else {
          // Attachment conversion has its own file/image fixtures; the public
          // aggregate preserves the empty-request shape without IPC side effects.
          await expect(method([])).resolves.toEqual({
            attachments: [],
            errors: [],
          });
          expect(native.invoke).not.toHaveBeenCalled();
        }
      });
  });
