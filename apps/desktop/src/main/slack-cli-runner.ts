import { spawn } from "node:child_process";
import { join } from "node:path";

export interface SlackCliRuntime {
  executable: string;
  hook: string;
  nodeExecutable: string;
}
export interface SlackCliCommand {
  runtime: SlackCliRuntime;
  directory: string;
  args: string[];
  signal: AbortSignal;
  handoff?: { port: number; secret: string };
}
export interface SlackCliResult {
  code: number;
  output: string;
}

// Exclude inherited credentials and runtime injection variables. Hooks use only
// Artemis's bundled Electron runtime and the CLI's platform shell.
export function slackCliEnvironment(
  command: SlackCliCommand,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    HOME: command.directory,
    USERPROFILE: command.directory,
    ELECTRON_RUN_AS_NODE: "1",
    SLACK_AUTO_REQUEST_AAA: "true",
    SLACK_DISABLE_TELEMETRY: "true",
    NO_COLOR: "1",
  };
  for (const key of [
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
  ])
    if (process.env[key]) environment[key] = process.env[key];
  environment.PATH =
    process.platform === "win32"
      ? `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0`
      : "/usr/bin:/bin";
  if (process.platform !== "win32") environment.SHELL = "/bin/sh";
  if (command.handoff) {
    environment.ARTEMIS_SLACK_HANDOFF_PORT = String(command.handoff.port);
    environment.ARTEMIS_SLACK_HANDOFF_SECRET = command.handoff.secret;
  }
  return environment;
}

export function slackHookCommand(
  runtime: SlackCliRuntime,
  operation: "manifest" | "deploy",
): string {
  const quote = (text: string) =>
    process.platform === "win32"
      ? `'${text.replaceAll("'", "''")}'`
      : `'${text.replaceAll("'", "'\\''")}'`;
  return `${process.platform === "win32" ? "& " : ""}${quote(runtime.nodeExecutable)} ${quote(runtime.hook)} ${operation}`;
}

export async function runSlackCli(
  command: SlackCliCommand,
): Promise<SlackCliResult> {
  command.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(
      command.runtime.executable,
      [
        ...command.args,
        "--skip-update",
        "--no-color",
        "--config-dir",
        join(command.directory, "config"),
      ],
      {
        cwd: join(command.directory, "project"),
        env: slackCliEnvironment(command),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      },
    );
    let output = "",
      failure = false;
    const stop = () => {
      failure = true;
      if (!child.pid) return;
      if (process.platform === "win32") {
        const killer = spawn(
          join(
            process.env.SystemRoot ?? "C:\\Windows",
            "System32",
            "taskkill.exe",
          ),
          ["/pid", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.on("error", () => child.kill());
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    const timer = setTimeout(stop, 60000);
    command.signal.addEventListener("abort", stop, { once: true });
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 256 * 1024) stop();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const cleanup = () => {
      clearTimeout(timer);
      command.signal.removeEventListener("abort", stop);
    };
    child.once("error", () => {
      cleanup();
      reject(new Error("cli-unavailable"));
    });
    child.once("close", (code) => {
      cleanup();
      if (failure)
        reject(new Error(command.signal.aborted ? "cancelled" : "network"));
      else resolve({ code: code ?? 1, output });
    });
    if (command.signal.aborted) stop();
  });
}
