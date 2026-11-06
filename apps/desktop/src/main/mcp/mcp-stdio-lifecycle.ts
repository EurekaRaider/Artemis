import { type ChildProcess } from "node:child_process";
import type { SandboxLaunch } from "@artemis/platform";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { appendStderr } from "./mcp-connection-errors.js";
import {
  STDIO_STARTUP_TEARDOWN_TIMEOUT_MS,
  WINDOWS_STDIO_GRACEFUL_EXIT_TIMEOUT_MS,
  STDIO_PROCESS_EXIT_TIMEOUT_MS,
} from "./mcp-connection-limits.js";
export async function connectStdioClient(
  client: Client,
  launch: SandboxLaunch,
  startupTimeoutMs: number,
  startupSignal?: AbortSignal,
): Promise<StdioClientTransport> {
  const transport = new StdioClientTransport({
    command: launch.executable,
    args: launch.args,
    cwd: launch.cwd,
    env: Object.fromEntries(
      Object.entries({
        ...(launch.env ?? {}),
        ARTEMIS_SANDBOX: launch.implementation,
      }).filter((entry) => typeof entry[1] === "string"),
    ) as Record<string, string>,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr = appendStderr(stderr, chunk);
  });
  const connectionPromise = client.connect(transport, {
    // The manager owns the earlier whole-startup deadline. Keep the SDK's
    // auto-close timeout behind the graceful sandbox teardown window so it
    // cannot clear the child handle and force-kill the helper first.
    timeout: startupTimeoutMs + STDIO_STARTUP_TEARDOWN_TIMEOUT_MS,
  });
  // The SDK clears its process reference before its final force-kill settles.
  // Retain the PID while the transport still exposes it so failed startup can
  // confirm that the child has actually exited before returning.
  const processId = transport.pid;
  let removeAbortListener: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    if (!startupSignal) return;
    const rejectWithReason = () =>
      reject(
        startupSignal.reason instanceof Error
          ? startupSignal.reason
          : new Error("stdio MCP startup was cancelled"),
      );
    if (startupSignal.aborted) {
      rejectWithReason();
      return;
    }
    startupSignal.addEventListener("abort", rejectWithReason, { once: true });
    removeAbortListener = () =>
      startupSignal.removeEventListener("abort", rejectWithReason);
  });
  try {
    await Promise.race([connectionPromise, aborted]);
    return transport;
  } catch (error) {
    let teardownError: unknown;
    try {
      await closeStdioClient(
        client,
        transport,
        launch.implementation === "windows-appcontainer",
        processId,
      );
    } catch (closeError) {
      teardownError = closeError;
    }
    await connectionPromise.catch(() => undefined);
    const cause = teardownError
      ? new AggregateError(
          [error, teardownError],
          "stdio MCP startup and teardown both failed",
        )
      : error;
    throw Object.assign(
      new Error(
        [
          error instanceof Error ? error.message : String(error),
          ...(teardownError
            ? [
                `Failed to stop stdio wrapper: ${teardownError instanceof Error ? teardownError.message : String(teardownError)}`,
              ]
            : []),
        ].join("\n"),
        { cause },
      ),
      { stderr },
    );
  } finally {
    removeAbortListener();
  }
}

export function processIsRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

export async function waitForProcessExit(
  processId: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processIsRunning(processId)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  return true;
}

export function endStdioInput(transport: StdioClientTransport): boolean {
  // The SDK exposes the PID but no way to end stdin before its four-second
  // force-kill path. Guard its runtime child-process field so the Windows
  // helper can finish job, ACL, and AppContainer cleanup first.
  const childProcess = (transport as unknown as { _process?: ChildProcess })
    ._process;
  if (!childProcess?.stdin) return false;
  try {
    childProcess.stdin.end();
    return true;
  } catch {
    return false;
  }
}

export async function closeStdioClient(
  client: Client,
  transport: StdioClientTransport,
  waitForWindowsSandboxTeardown: boolean,
  retainedProcessId: number | null = transport.pid,
): Promise<void> {
  const processId = retainedProcessId;
  if (
    waitForWindowsSandboxTeardown &&
    processId !== null &&
    endStdioInput(transport)
  ) {
    await waitForProcessExit(processId, WINDOWS_STDIO_GRACEFUL_EXIT_TIMEOUT_MS);
  }
  let closeError: unknown;
  try {
    await client.close();
  } catch (error) {
    closeError = error;
  }
  if (
    processId === null ||
    (await waitForProcessExit(processId, STDIO_PROCESS_EXIT_TIMEOUT_MS))
  ) {
    if (closeError) throw closeError;
    return;
  }
  try {
    process.kill(processId, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  if (!(await waitForProcessExit(processId, STDIO_PROCESS_EXIT_TIMEOUT_MS))) {
    throw new Error(
      `stdio MCP wrapper ${processId} did not exit after SIGKILL`,
    );
  }
  if (closeError) throw closeError;
}
