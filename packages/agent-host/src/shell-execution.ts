import { execFile, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

import type { BashOperations } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_SHELL_RUNTIME_CONFIGURATION,
  shellRuntimeConfigurationSchema,
  type ShellProfileMode,
  type ShellRuntimeConfiguration,
} from "@artemis/protocol";
import {
  resolveShellRuntime,
  type ResolvedShellRuntime,
} from "@artemis/platform";

const PROFILE_CAPTURE_TIMEOUT_MILLISECONDS = 5_000;
const PROFILE_CAPTURE_MAX_BYTES = 2 * 1024 * 1024;
const SHELL_ENVIRONMENT_SCOPE = "ARTEMIS_SHELL_ENVIRONMENT_SCOPE";
const POSIX_ENVIRONMENT_MARKER = Buffer.from("\0ARTEMIS_ENVIRONMENT\0");
const POWERSHELL_ENVIRONMENT_MARKER = "ARTEMIS_ENVIRONMENT:";
const SECRET_ENVIRONMENT_NAME =
  /(?:^|_)(?:ACCESS_?KEY|API_?KEY|AUTH|CREDENTIAL|PASSWORD|PASSWD|PAT|PRIVATE_?KEY|SECRET|TOKEN)(?:_|$)/iu;

export interface ShellExecutionRuntimeOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  resolveShell?: (
    configuration: ShellRuntimeConfiguration,
  ) => ResolvedShellRuntime;
}

export interface ShellExecutionMetadata {
  shell: ResolvedShellRuntime;
  profileMode: ShellProfileMode;
  environmentSource: "inherited" | "profile" | "full-profile";
  environmentWarning?: string;
}

function definedEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function powershellAgentProfile(environment: NodeJS.ProcessEnv): string {
  const localAppData = environment.LOCALAPPDATA;
  return localAppData
    ? join(localAppData, "Artemis", "agent-profile.ps1")
    : join(homedir(), "AppData", "Local", "Artemis", "agent-profile.ps1");
}

function posixAgentProfile(
  shell: ResolvedShellRuntime,
  environment: NodeJS.ProcessEnv,
  homeDirectory?: string,
): string {
  const home = homeDirectory ?? environment.HOME ?? homedir();
  const extension = shell.kind === "zsh" ? "zsh" : "bash";
  return join(home, ".config", "artemis", `agent-profile.${extension}`);
}

const windowsEnvironmentRefresh = [
  "$artemisMachine = [Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]::Machine)",
  "$artemisUser = [Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]::User)",
  "$artemisProcessPath = $env:Path",
  "foreach ($artemisEntry in $artemisMachine.GetEnumerator()) { if ($artemisEntry.Key -ne 'Path') { $artemisValue = [Environment]::ExpandEnvironmentVariables([string]$artemisEntry.Value); [Environment]::SetEnvironmentVariable([string]$artemisEntry.Key, $artemisValue, [EnvironmentVariableTarget]::Process) } }",
  "foreach ($artemisEntry in $artemisUser.GetEnumerator()) { if ($artemisEntry.Key -ne 'Path') { $artemisValue = [Environment]::ExpandEnvironmentVariables([string]$artemisEntry.Value); [Environment]::SetEnvironmentVariable([string]$artemisEntry.Key, $artemisValue, [EnvironmentVariableTarget]::Process) } }",
  "$artemisMachinePath = [Environment]::ExpandEnvironmentVariables([string]$artemisMachine['Path'])",
  "$artemisUserPath = [Environment]::ExpandEnvironmentVariables([string]$artemisUser['Path'])",
  "$env:Path = (@($artemisMachinePath, $artemisUserPath, $artemisProcessPath) | Where-Object { $_ }) -join ';'",
].join("; ");

function windowsProfileBootstrap(agentProfile: string): string {
  const escapedAgentProfile = agentProfile.replaceAll("'", "''");
  return [
    windowsEnvironmentRefresh,
    "$artemisProfiles = @($PROFILE.CurrentUserAllHosts, $PROFILE.CurrentUserCurrentHost) | Select-Object -Unique",
    "foreach ($artemisProfile in $artemisProfiles) { if ($artemisProfile -and (Test-Path -LiteralPath $artemisProfile)) { try { . $artemisProfile } catch { [Console]::Error.WriteLine(('Artemis could not load PowerShell profile {0}: {1}' -f $artemisProfile, $_.Exception.Message)) } } }",
    `$artemisAgentProfile = '${escapedAgentProfile}'`,
    "if (Test-Path -LiteralPath $artemisAgentProfile) { try { . $artemisAgentProfile } catch { [Console]::Error.WriteLine(('Artemis could not load agent profile {0}: {1}' -f $artemisAgentProfile, $_.Exception.Message)) } }",
  ].join("; ");
}

function powershellCommandScript(
  command: string,
  profileBootstrap?: string,
): string {
  return [
    profileBootstrap,
    "[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)",
    "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)",
    "$OutputEncoding = [Console]::OutputEncoding",
    "$global:LASTEXITCODE = 0",
    "$artemisNativeExit = 0",
    "try {",
    `  & {\n${command}\n  }`,
    "  $artemisSucceeded = $?",
    "  $artemisNativeExit = $LASTEXITCODE",
    "  if (-not $artemisSucceeded) {",
    "    if ($null -ne $artemisNativeExit -and $artemisNativeExit -ne 0) { exit $artemisNativeExit }",
    "    exit 1",
    "  }",
    "  exit 0",
    "} catch {",
    "  [Console]::Error.WriteLine(($_ | Out-String))",
    "  exit 1",
    "}",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildShellInvocation(
  shell: ResolvedShellRuntime,
  command: string,
  profileMode: ShellProfileMode,
  environment: NodeJS.ProcessEnv,
  homeDirectory?: string,
): { args: string[]; env: Record<string, string> } {
  const env = definedEnvironment(environment);
  if (shell.kind === "powershell") {
    const bootstrap =
      profileMode === "full"
        ? windowsProfileBootstrap(powershellAgentProfile(environment))
        : undefined;
    const script = powershellCommandScript(command, bootstrap);
    return {
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      env,
    };
  }

  if (profileMode === "full") {
    const agentProfile = posixAgentProfile(shell, environment, homeDirectory);
    const script = `[ -f ${shellSingleQuote(agentProfile)} ] && . ${shellSingleQuote(agentProfile)}\n${command}`;
    return { args: ["-ilc", script], env };
  }
  return {
    args:
      shell.kind === "zsh"
        ? ["-f", "-c", command]
        : shell.kind === "bash"
          ? ["--noprofile", "--norc", "-c", command]
          : ["-c", command],
    env,
  };
}

function runFile(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    timeout: number;
  },
): Promise<{ stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        ...options,
        encoding: "buffer",
        maxBuffer: PROFILE_CAPTURE_MAX_BYTES,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) reject(error);
        else {
          resolve({
            stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
            stderr: Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr),
          });
        }
      },
    );
  });
}

function parseNullEnvironment(value: Buffer): Record<string, string> {
  const markerIndex = value.lastIndexOf(POSIX_ENVIRONMENT_MARKER);
  if (markerIndex < 0) {
    throw new Error("The shell profile did not return an environment marker.");
  }
  const body = value.subarray(markerIndex + POSIX_ENVIRONMENT_MARKER.length);
  return Object.fromEntries(
    body
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .flatMap((entry) => {
        const separator = entry.indexOf("=");
        return separator > 0
          ? [[entry.slice(0, separator), entry.slice(separator + 1)]]
          : [];
      }),
  );
}

function parsePowerShellEnvironment(value: Buffer): Record<string, string> {
  const output = value.toString("utf8").replaceAll("\0", "");
  const markerIndex = output.lastIndexOf(POWERSHELL_ENVIRONMENT_MARKER);
  if (markerIndex < 0) {
    throw new Error(
      "The PowerShell profile did not return an environment marker.",
    );
  }
  const encoded = output
    .slice(markerIndex + POWERSHELL_ENVIRONMENT_MARKER.length)
    .trim()
    .split(/\s/u)[0];
  if (!encoded) throw new Error("The PowerShell environment was empty.");
  const parsed = JSON.parse(
    Buffer.from(encoded, "base64").toString("utf8"),
  ) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The PowerShell environment was invalid.");
  }
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function filterImportedEnvironment(
  inherited: Record<string, string>,
  imported: Record<string, string>,
): Record<string, string> {
  const filtered = { ...inherited };
  for (const [name, value] of Object.entries(imported)) {
    if (SECRET_ENVIRONMENT_NAME.test(name) && inherited[name] !== value) {
      continue;
    }
    filtered[name] = value;
  }
  return filtered;
}

function killProcessTree(platform: NodeJS.Platform, pid: number): void {
  if (platform === "win32") {
    const killer = spawn("taskkill.exe", ["/F", "/T", "/PID", String(pid)], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    killer.unref();
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The child has already exited.
    }
  }
}

export class ArtemisShellRuntime implements BashOperations {
  private configuration: ShellRuntimeConfiguration = structuredClone(
    DEFAULT_SHELL_RUNTIME_CONFIGURATION,
  );
  private resolved: ResolvedShellRuntime;
  private readonly importedEnvironments = new Map<
    string,
    Promise<Record<string, string>>
  >();
  private environmentWarning: string | undefined;
  private readonly platform: NodeJS.Platform;
  private readonly inheritedEnvironment: NodeJS.ProcessEnv;
  private readonly homeDirectory: string | undefined;
  private readonly resolveConfiguredShell: (
    configuration: ShellRuntimeConfiguration,
  ) => ResolvedShellRuntime;

  constructor(options: ShellExecutionRuntimeOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.inheritedEnvironment = options.env ?? process.env;
    this.homeDirectory = options.homeDirectory;
    this.resolveConfiguredShell =
      options.resolveShell ??
      ((configuration) =>
        resolveShellRuntime({
          platform: this.platform,
          env: this.inheritedEnvironment,
          windowsPreference: configuration.windowsPreference,
        }));
    this.resolved = this.resolveConfiguredShell(this.configuration);
  }

  configure(configuration?: ShellRuntimeConfiguration): void {
    const next = shellRuntimeConfigurationSchema.parse(
      configuration ?? DEFAULT_SHELL_RUNTIME_CONFIGURATION,
    );
    this.resolved = this.resolveConfiguredShell(next);
    this.configuration = structuredClone(next);
    this.importedEnvironments.clear();
    this.environmentWarning = undefined;
  }

  metadata(): ShellExecutionMetadata {
    return {
      shell: structuredClone(this.resolved),
      profileMode: this.configuration.profileMode,
      environmentSource:
        this.configuration.profileMode === "environment"
          ? "profile"
          : this.configuration.profileMode === "full"
            ? "full-profile"
            : "inherited",
      ...(this.environmentWarning
        ? { environmentWarning: this.environmentWarning }
        : {}),
    };
  }

  toolDescription(): string {
    const shell = this.resolved;
    if (shell.kind === "powershell") {
      return `${shell.edition === "Core" ? "PowerShell" : "Windows PowerShell"} ${shell.version ?? ""}`.trim();
    }
    return shell.kind;
  }

  private async captureEnvironment(): Promise<Record<string, string>> {
    const inherited = definedEnvironment(this.inheritedEnvironment);
    try {
      if (this.resolved.kind === "powershell") {
        const agentProfile = powershellAgentProfile(this.inheritedEnvironment);
        const script = [
          windowsProfileBootstrap(agentProfile),
          "$artemisEnvironment = @{}",
          "Get-ChildItem Env: | ForEach-Object { $artemisEnvironment[$_.Name] = $_.Value }",
          "$artemisJson = ConvertTo-Json -Compress -InputObject $artemisEnvironment",
          `$artemisEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($artemisJson))`,
          `[Console]::Out.Write('${POWERSHELL_ENVIRONMENT_MARKER}' + $artemisEncoded)`,
        ].join("\n");
        const result = await runFile(
          this.resolved.executable,
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            Buffer.from(script, "utf16le").toString("base64"),
          ],
          {
            env: inherited,
            timeout: PROFILE_CAPTURE_TIMEOUT_MILLISECONDS,
          },
        );
        this.environmentWarning =
          result.stderr.toString("utf8").trim() || undefined;
        return filterImportedEnvironment(
          inherited,
          parsePowerShellEnvironment(result.stdout),
        );
      }

      const agentProfile = posixAgentProfile(
        this.resolved,
        this.inheritedEnvironment,
        this.homeDirectory,
      );
      const result = await runFile(
        this.resolved.executable,
        [
          "-ilc",
          'if [ -f "$ARTEMIS_AGENT_PROFILE" ]; then . "$ARTEMIS_AGENT_PROFILE"; fi; printf "\\0ARTEMIS_ENVIRONMENT\\0"; env -0',
        ],
        {
          env: { ...inherited, ARTEMIS_AGENT_PROFILE: agentProfile },
          timeout: PROFILE_CAPTURE_TIMEOUT_MILLISECONDS,
        },
      );
      this.environmentWarning =
        result.stderr.toString("utf8").trim() || undefined;
      return filterImportedEnvironment(
        inherited,
        parseNullEnvironment(result.stdout),
      );
    } catch (error) {
      this.environmentWarning =
        error instanceof Error ? error.message : String(error);
      return inherited;
    }
  }

  releaseEnvironment(scope: string): void {
    this.importedEnvironments.delete(scope);
  }

  private environment(scope: string): Promise<Record<string, string>> {
    if (this.configuration.profileMode !== "environment") {
      return Promise.resolve(definedEnvironment(this.inheritedEnvironment));
    }
    let imported = this.importedEnvironments.get(scope);
    if (!imported) {
      imported = this.captureEnvironment();
      this.importedEnvironments.set(scope, imported);
    }
    return imported;
  }

  async exec(
    command: string,
    cwd: string,
    options: Parameters<BashOperations["exec"]>[2],
  ): Promise<{ exitCode: number | null }> {
    if (options.signal?.aborted) throw new Error("aborted");
    const operationEnvironment = definedEnvironment(options.env ?? {});
    const environmentScope =
      operationEnvironment[SHELL_ENVIRONMENT_SCOPE] ?? "default";
    delete operationEnvironment[SHELL_ENVIRONMENT_SCOPE];
    const environment = {
      ...(await this.environment(environmentScope)),
      ...operationEnvironment,
    };
    const invocation = buildShellInvocation(
      this.resolved,
      command,
      this.configuration.profileMode,
      environment,
      this.homeDirectory,
    );

    return new Promise((resolve, reject) => {
      const child = spawn(this.resolved.executable, invocation.args, {
        cwd,
        detached: this.platform !== "win32",
        env: invocation.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let timedOut = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const terminate = () => {
        if (child.pid) killProcessTree(this.platform, child.pid);
      };
      const abort = () => terminate();

      child.stdout.on("data", options.onData);
      child.stderr.on("data", options.onData);
      child.once("error", reject);
      child.once("close", (exitCode) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        options.signal?.removeEventListener("abort", abort);
        if (options.signal?.aborted) reject(new Error("aborted"));
        else if (timedOut) reject(new Error(`timeout:${options.timeout}`));
        else resolve({ exitCode });
      });
      if (options.signal) {
        options.signal.addEventListener("abort", abort, { once: true });
      }
      if (options.timeout !== undefined) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          terminate();
        }, options.timeout * 1_000);
      }
    });
  }
}
