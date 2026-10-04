import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { runRemoteShell } from "../../../src/main/im/im-sandbox.js";
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
it("terminates the Windows desktop-user process tree on revocation", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const child = Object.assign(new EventEmitter(), {
    pid: 1234,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
  const killer = new EventEmitter();
  vi.mocked(spawn)
    .mockReturnValueOnce(child as never)
    .mockReturnValueOnce(killer as never);
  try {
    Object.defineProperty(process, "platform", { value: "win32" });
    const controller = new AbortController();
    const result = runRemoteShell(
      {
        executable: "powershell.exe",
        args: ["-Command", "long-running-command"],
        cwd: "C:/work",
        implementation: "desktop-user",
      },
      controller.signal,
      5,
    );
    controller.abort();
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("taskkill.exe"),
      ["/pid", "1234", "/T", "/F"],
      { windowsHide: true, stdio: "ignore" },
    );
    killer.emit("exit", 0);
    child.emit("close", null);
    expect(await result).toMatchObject({ cancelled: true });
  } finally {
    Object.defineProperty(process, "platform", platform);
    vi.clearAllMocks();
  }
});
