import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, realpath, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { RunMode } from "@artemis/protocol";
import {
  normalizeImPath,
  isImProtectedPath,
  type ImDataScope,
} from "@artemis/protocol";
import {
  buildSeatbeltLaunch,
  buildWindowsAppContainerLaunch,
  type SandboxLaunch,
} from "@artemis/platform";

export async function checkedRemotePath(
  workspace: string,
  input: string,
): Promise<string> {
  const root = await realpath(workspace),
    path = resolve(root, input),
    part = relative(root, path);
  if (!part || part === ".." || part.startsWith(`..${sep}`) || isAbsolute(part))
    throw new Error("Path must name a file inside the authorized project.");
  let current = root;
  for (const piece of part.split(sep)) {
    current = join(current, piece);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (info.nlink > 1 && info.isFile()))
        throw new Error(
          "Remote access through symbolic or hard links is not allowed.",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return path;
}
export function buildRemoteShellLaunch(
  workspace: string,
  command: string,
  network: boolean,
  platform: NodeJS.Platform = process.platform,
  windowsHelper?: string,
  mode: RunMode = "execute",
): SandboxLaunch {
  const env: Record<string, string> =
    platform === "win32"
      ? {
          SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
          PATH: `${process.env.SystemRoot ?? "C:\\Windows"}\\System32`,
          USERPROFILE: workspace,
          TEMP: workspace,
          TMP: workspace,
        }
      : {
          PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          HOME: workspace,
          TMPDIR: workspace,
          LANG: "en_US.UTF-8",
        };
  const policy = {
    workspacePath: workspace,
    mode,
    network: network ? ("allow" as const) : ("deny" as const),
  };
  if (platform === "darwin") {
    const launch = buildSeatbeltLaunch(
      { executable: "/bin/sh", args: ["-c", command], cwd: workspace, env },
      { ...policy, readOnlyPaths: ["/private/var/select/sh"] },
    );
    // Remote jobs do not need cross-process IPC or service lookups.
    launch.args[1] += "\n(deny mach-lookup)\n(deny ipc-posix-shm)\n";
    return launch;
  }
  if (platform === "win32" && windowsHelper) {
    return buildWindowsAppContainerLaunch(
      {
        executable: join(
          env.SystemRoot!,
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(command, "utf16le").toString("base64"),
        ],
        cwd: workspace,
        env,
      },
      policy,
      {
        helperPath: windowsHelper,
        identity: `Artemis.Remote.${createHash("sha256").update(workspace.toLowerCase()).digest("hex").slice(0, 24)}`,
        runtimePath: workspace,
      },
    );
  }
  throw new Error(
    "Remote Execute requires an available native macOS or Windows sandbox.",
  );
}

/** Strict IM policies never inherit the legacy workspace-wide sandbox grant. */
export async function validateImShellScope(
  workspace: string,
  scope: ImDataScope,
): Promise<void> {
  let remaining = 50000;
  const visit = async (path: string): Promise<void> => {
    if (--remaining < 0)
      throw new Error("命令范围过大，无法验证文件链接；请缩小范围。");
    if (isImProtectedPath(path)) return;
    const full = await checkedRemotePath(workspace, path);
    let info;
    try {
      info = await lstat(full);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (info.isDirectory() && scope.filePaths?.includes(path))
      throw new Error("授权文件已被替换为目录。");
    if (info.isDirectory())
      for (const name of await readdir(full)) await visit(`${path}/${name}`);
  };
  for (const path of new Set(scope.readPaths))
    await visit(normalizeImPath(path));
}

export function buildScopedImShellLaunch(
  workspace: string,
  command: string,
  network: boolean,
  scope: ImDataScope,
  platform: NodeJS.Platform = process.platform,
): SandboxLaunch {
  // Windows' current SandboxSpec only has allow trees; classic AppContainer also
  // inherits directory ACLs. Neither can enforce protection of future credential
  // files beneath an allowed directory. Keep commands closed until supported.
  if (platform !== "darwin")
    throw new Error(
      "此平台尚不能强制执行细粒度 IM 命令范围；可继续使用授权的文件读写。",
    );
  const quote = (s: string) =>
    `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  const roots = (paths: string[]) =>
    paths.map((p) => {
      normalizeImPath(p);
      if (isImProtectedPath(p)) throw new Error("Protected shell scope.");
      return resolve(workspace, p);
    });
  const read = roots(scope.readPaths),
    write = roots(scope.writePaths);
  const rules = (operation: string, paths: string[]) =>
    paths.length
      ? [
          `(allow ${operation} ${paths.map((p) => `(${scope.filePaths?.some((file) => resolve(workspace, file) === p) ? "literal" : "subpath"} ${quote(p)})`).join(" ")})`,
        ]
      : [];
  // ASCII case folding is explicit: Seatbelt regular expressions do not support
  // JavaScript flags/lookarounds. Hidden configuration is conservatively denied.
  const folded = (s: string) =>
    [...s]
      .map((c) => (/[a-z]/u.test(c) ? `[${c}${c.toUpperCase()}]` : c))
      .join("");
  const control = [
    "agents[.]md",
    "skill[.]md",
    "auth[.]json",
    "credentials",
    "credentials[.]json",
    "id_rsa",
    "id_ed25519",
    "mcp[.]json",
    "opencode[.]json",
    "opencode[.]jsonc",
    "claude_desktop_config[.]json",
    "windows-im-files[.]cs",
    "windows-im-files[.]ps1",
    "windows-sandbox[.]ps1",
    "windows-sandbox-setup[.]ps1",
  ]
    .map(folded)
    .join("|");
  const profile = [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    '(allow file-read* (subpath "/System") (subpath "/usr/bin") (subpath "/usr/lib") (subpath "/usr/libexec") (subpath "/usr/share") (subpath "/bin") (subpath "/sbin") (literal "/private/var/select/sh"))',
    '(allow file-read-data (literal "/"))',
    "(allow file-read-metadata)",
    '(allow file-read* file-write* (literal "/dev/null") (subpath "/dev/fd"))',
    ...rules("file-read*", read),
    ...rules("file-write*", write),
    `(deny file-read-data file-write* (regex #"/([.][^/]+|${control})(/|$)"))`,
    `(deny file-read-data file-write* (regex #"/[^/]*[.](${["pem", "key", "p12", "pfx", "keystore"].map(folded).join("|")})$"))`,
    "(deny mach-lookup)",
    "(deny ipc-posix-shm)",
    network ? "(allow network-outbound)" : "(deny network*)",
  ].join("\n");
  return {
    executable: "/usr/bin/sandbox-exec",
    args: ["-p", profile, "/bin/sh", "-c", command],
    cwd: workspace,
    env: {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: workspace,
      TMPDIR: workspace,
      LANG: "en_US.UTF-8",
    },
    implementation: "macos-seatbelt",
  };
}
export function runRemoteShell(
  launch: SandboxLaunch,
  signal: AbortSignal,
  timeoutSeconds: number,
  maxOutputBytes = 1024 * 1024,
): Promise<{ output: string; exitCode: number | null; cancelled: boolean }> {
  return new Promise((resolveResult, reject) => {
    if (signal.aborted) {
      reject(new Error("Remote operation cancelled."));
      return;
    }
    const child = spawn(launch.executable, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let output = "",
      cancelled = false,
      settled = false;
    const stop = () => {
      cancelled = true;
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      } else child.kill("SIGKILL");
    };
    const timer = setTimeout(stop, timeoutSeconds * 1000);
    signal.addEventListener("abort", stop, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
    };
    const data = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output) > maxOutputBytes) {
        output = output.slice(0, 512 * 1024) + "\n[Output limit reached]";
        stop();
      }
    };
    child.stdout.on("data", data);
    child.stderr.on("data", data);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveResult({ output, exitCode, cancelled });
    });
  });
}
export function remoteWriteCommand(
  path: string,
  content: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32")
    return `[System.IO.Directory]::CreateDirectory('${dirname(path).replaceAll("'", "''")}') | Out-Null; [System.IO.File]::WriteAllBytes('${path.replaceAll("'", "''")}',[Convert]::FromBase64String('${Buffer.from(content).toString("base64")}'))`;
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return `umask 077; mkdir -p ${quote(dirname(path))} && printf %s ${quote(Buffer.from(content).toString("base64"))} | /usr/bin/base64 -d > ${quote(path)}`;
}
