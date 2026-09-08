import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { dirname, join, win32 } from "node:path";
import { tmpdir } from "node:os";
import { IM_PROTECTED_COMPONENT, type ImDataScope } from "@artemis/protocol";
import { buildWindowsAppContainerLaunch } from "@artemis/platform";
import { authorizeImPath, imContentHash } from "./im-policy.js";
import { runRemoteShell } from "./im-sandbox.js";

export interface ImFileSnapshotEntry {
  path: string;
  directory: boolean;
  data?: string | null;
}
interface Change {
  path: string;
  directory?: boolean;
  delete?: boolean;
  expected?: string;
  data?: string | null;
}
interface NativeResult {
  entries?: ImFileSnapshotEntry[];
  data?: string;
  applied?: boolean;
}

/** A fixed host-owned broker. No model commands or file bytes appear in argv. */
export class WindowsImFiles {
  readonly helper: string;
  constructor(sandboxHelper: string) {
    this.helper = join(dirname(sandboxHelper), "windows-im-files.ps1");
  }
  available() {
    return (
      existsSync(this.helper) &&
      existsSync(join(dirname(this.helper), "windows-im-files.cs"))
    );
  }

  private async request(
    workspace: string,
    scope: ImDataScope,
    operation: Record<string, unknown>,
    assertCurrent: () => void = () => {},
    signal?: AbortSignal,
  ): Promise<NativeResult> {
    assertCurrent();
    // Windows TEMP and user profiles often use an 8.3 spelling. Canonicalize
    // the host-selected root; relative names still undergo strict alias checks.
    workspace = await realpath(workspace);
    assertCurrent();
    if (signal?.aborted)
      return Promise.reject(new Error("IM operation cancelled."));
    if (!this.available())
      return Promise.reject(
        new Error("Windows IM 文件组件缺失，请更新 Artemis。"),
      );
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const child = spawn(
      win32.join(
        systemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        this.helper,
      ],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          SystemRoot: systemRoot,
          PATH: win32.join(systemRoot, "System32"),
          TEMP: tmpdir(),
          TMP: tmpdir(),
        },
      },
    );
    return new Promise((resolve, reject) => {
      let output = "",
        error = "",
        size = 0,
        failure: Error | undefined;
      const stop = (reason: Error) => {
        failure ??= reason;
        child.kill();
      };
      const abort = () => stop(new Error("IM operation cancelled."));
      const timer = setTimeout(
        () => stop(new Error("Windows IM file operation timed out.")),
        60000,
      );
      signal?.addEventListener("abort", abort, { once: true });
      child.stdin.on("error", () => {}); // Process failure is reported once, below.
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        size += Buffer.byteLength(chunk);
        if (size > 145 * 1024 * 1024) {
          stop(new Error("IM snapshot exceeds its memory limit."));
          return;
        }
        output += chunk;
        if (
          output.startsWith('{"ready":true}\r\n') ||
          output.startsWith('{"ready":true}\n')
        ) {
          output = output.slice(output.indexOf("\n") + 1);
          try {
            assertCurrent();
            if (signal?.aborted) throw new Error("IM operation cancelled.");
            child.stdin.end("commit\n");
          } catch (e) {
            stop(e instanceof Error ? e : new Error(String(e)));
          }
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (error.length < 4096)
          error += chunk.toString("utf8").slice(0, 4096 - error.length);
      });
      child.on("error", (e) => {
        failure = e;
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (failure || code !== 0) {
          reject(
            failure ?? new Error(error || "Windows IM file operation failed."),
          );
          return;
        }
        try {
          assertCurrent();
          resolve(JSON.parse(output));
        } catch (e) {
          reject(e);
        }
      });
      child.stdin.write(
        JSON.stringify({
          workspace,
          scope: { ...scope, filePaths: scope.filePaths ?? [] },
          protection: IM_PROTECTED_COMPONENT.source,
          ...operation,
        }) + "\n",
      );
      if (operation.action !== "apply") child.stdin.end();
      if (signal?.aborted) abort();
    });
  }
  async read(
    workspace: string,
    path: string,
    scope: ImDataScope,
    assertCurrent?: () => void,
  ) {
    authorizeImPath(scope, path);
    const result = await this.request(
      workspace,
      scope,
      { action: "read", path },
      assertCurrent,
    );
    if (typeof result.data !== "string")
      throw new Error("Invalid native file result.");
    return Buffer.from(result.data, "base64");
  }
  async list(
    workspace: string,
    path: string,
    scope: ImDataScope,
    assertCurrent?: () => void,
  ) {
    authorizeImPath(scope, path);
    const result = await this.request(
      workspace,
      scope,
      { action: "list", path },
      assertCurrent,
    );
    return (result.entries ?? []).map((entry) => ({
      path: authorizeImPath(scope, entry.path),
      directory: entry.directory,
    }));
  }
  async write(
    workspace: string,
    path: string,
    content: string,
    scope: ImDataScope,
    assertCurrent: () => void,
  ) {
    await this.apply(
      workspace,
      scope,
      [{ path, data: Buffer.from(content).toString("base64") }],
      assertCurrent,
    );
  }
  async snapshot(
    workspace: string,
    scope: ImDataScope,
    assertCurrent: () => void,
    signal?: AbortSignal,
  ) {
    const result = await this.request(
      workspace,
      scope,
      { action: "snapshot" },
      assertCurrent,
      signal,
    );
    for (const entry of result.entries ?? [])
      authorizeImPath(scope, entry.path);
    return result.entries ?? [];
  }
  async apply(
    workspace: string,
    scope: ImDataScope,
    changes: Change[],
    assertCurrent: () => void,
    signal?: AbortSignal,
  ) {
    for (const change of changes) authorizeImPath(scope, change.path, true);
    if (!changes.length) return;
    await this.request(
      workspace,
      scope,
      {
        action: "apply",
        changes: changes.map((c) => ({
          directory: false,
          delete: false,
          expected: null,
          data: null,
          ...c,
        })),
      },
      assertCurrent,
      signal,
    );
  }
}

/** Validate the entire diff before any original file is opened for modification. */
export function imSnapshotChanges(
  before: ImFileSnapshotEntry[],
  after: ImFileSnapshotEntry[],
  scope: ImDataScope,
): Change[] {
  const old = new Map(before.map((entry) => [entry.path, entry]));
  const next = new Map(after.map((entry) => [entry.path, entry]));
  const changes: Change[] = [];
  for (const entry of after) {
    authorizeImPath(scope, entry.path);
    const previous = old.get(entry.path);
    if (
      previous?.directory !== undefined &&
      previous.directory !== entry.directory
    )
      throw new Error("Shell changed a file's type; changes were not applied.");
    if (entry.directory) {
      if (!previous) {
        authorizeImPath(scope, entry.path, true);
        changes.push({ path: entry.path, directory: true });
      }
      continue;
    }
    if (typeof entry.data !== "string")
      throw new Error("Invalid native snapshot bytes.");
    if (previous?.data === entry.data) continue;
    authorizeImPath(scope, entry.path, true);
    changes.push({
      path: entry.path,
      data: entry.data,
      expected:
        previous?.data != null
          ? imContentHash(Buffer.from(previous.data, "base64"))
          : "absent",
    });
  }
  for (const entry of before)
    if (!entry.directory && !next.has(entry.path)) {
      authorizeImPath(scope, entry.path, true);
      changes.push({
        path: entry.path,
        delete: true,
        expected: imContentHash(Buffer.from(entry.data!, "base64")),
      });
    }
  return changes;
}

export async function runWindowsImShell(input: {
  workspace: string;
  helper: string;
  scope: ImDataScope;
  command: string;
  network: boolean;
  signal: AbortSignal;
  timeoutSeconds: number;
  assertCurrent: () => void;
}) {
  const files = new WindowsImFiles(input.helper);
  input.assertCurrent();
  const before = await files.snapshot(
    input.workspace,
    input.scope,
    input.assertCurrent,
    input.signal,
  );
  const prepared = [...before];
  const originalPaths = new Set(before.map((entry) => entry.path));
  const stage = await realpath(
    await mkdtemp(join(tmpdir(), "artemis-im-exec-")),
  );
  try {
    for (const entry of before) {
      const path = join(stage, authorizeImPath(input.scope, entry.path));
      await mkdir(entry.directory ? path : dirname(path), { recursive: true });
      if (!entry.directory)
        await writeFile(path, Buffer.from(entry.data!, "base64"), {
          flag: "wx",
        });
    }
    // Missing explicit file roots get a parent, never a directory with the file name.
    for (const path of input.scope.writePaths) {
      const full = join(stage, path);
      if (input.scope.filePaths?.includes(path)) {
        await mkdir(dirname(full), { recursive: true });
        if (!existsSync(full)) {
          await writeFile(full, "", { flag: "wx" });
          prepared.push({ path, directory: false, data: "" });
        }
      } else if (!existsSync(full)) {
        await mkdir(full, { recursive: true });
        prepared.push({ path, directory: true });
      }
    }
    input.assertCurrent();
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const powerShellHome = win32.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
    );
    const command = [
      "Import-Module Microsoft.PowerShell.Management,Microsoft.PowerShell.Utility -ErrorAction Stop",
      input.command,
    ].join("\n");
    const launch = buildWindowsAppContainerLaunch(
      {
        executable: win32.join(powerShellHome, "powershell.exe"),
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(command, "utf16le").toString("base64"),
        ],
        cwd: stage,
        env: {
          SystemRoot: systemRoot,
          WINDIR: systemRoot,
          ComSpec: win32.join(systemRoot, "System32", "cmd.exe"),
          PATH: win32.join(systemRoot, "System32"),
          // Only Windows' built-in modules are available; never inherit user modules.
          PSModulePath: win32.join(powerShellHome, "Modules"),
          USERPROFILE: stage,
          APPDATA: stage,
          LOCALAPPDATA: stage,
          TEMP: stage,
          TMP: stage,
        },
      },
      {
        workspacePath: stage,
        workspaceAccess: "read",
        mode: "execute",
        network: input.network ? "allow" : "deny",
        // Built-in module manifests are runtime code, outside the copied data.
        readOnlyPaths: [stage, powerShellHome],
        writablePaths: input.scope.writePaths.map((p) => join(stage, p)),
      },
      {
        helperPath: input.helper,
        hostTempPath: tmpdir(),
        runtimePath: stage,
        hostAccessPath: stage,
        identity: `Artemis.Im.${randomUUID()}`,
      },
    );
    const result = await runRemoteShell(
      launch,
      input.signal,
      input.timeoutSeconds,
    );
    input.assertCurrent();
    if (result.cancelled || input.signal.aborted)
      return { ...result, cancelled: true };
    const after = await files.snapshot(
      stage,
      input.scope,
      input.assertCurrent,
      input.signal,
    );
    await files.apply(
      input.workspace,
      input.scope,
      imSnapshotChanges(prepared, after, input.scope)
        .filter((change) => !change.delete || originalPaths.has(change.path))
        .map((change) =>
          change.expected && !originalPaths.has(change.path)
            ? { ...change, expected: "absent" }
            : change,
        ),
      input.assertCurrent,
      input.signal,
    );
    return result;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
