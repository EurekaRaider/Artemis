import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type {
  ArtifactOperation,
  CapabilityPackManifest,
} from "@artemis/protocol";
import type {
  OfficeEngine,
  OfficeEngineSnapshot,
} from "./office-session-service.js";

const runFile = promisify(execFile);

export async function verifyOfficeNative(
  directory: string,
  manifest: CapabilityPackManifest,
): Promise<void> {
  if (process.platform === "darwin") {
    const app = join(directory, "ArtemisOfficeRuntime.app");
    await runFile(
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", app],
      { timeout: 60_000 },
    );
    const identity = await runFile(
      "/usr/bin/codesign",
      ["-dv", "--verbose=4", app],
      { timeout: 10_000 },
    );
    if (
      !identity.stderr
        .split(/\r?\n/u)
        .includes(`TeamIdentifier=${manifest.native.signer}`) ||
      !identity.stderr.includes("runtime")
    )
      throw new Error(
        "Office runtime signing identity or Hardened Runtime mismatch",
      );
    await runFile("/usr/sbin/spctl", ["--assess", "--type", "execute", app], {
      timeout: 60_000,
    });
    return;
  }
  if (process.platform !== "win32")
    throw new Error("Office runtime platform is unsupported");
  // Values travel as process environment, never interpolated into PowerShell source.
  const script =
    "$ErrorActionPreference='Stop'; $s=Get-AuthenticodeSignature -LiteralPath $env:ARTEMIS_OFFICE_VERIFY_PATH; if($env:ARTEMIS_OFFICE_VERIFY_SIGNER -eq 'unsigned'){if($s.Status -ne 'NotSigned'){throw 'Office runtime signature mismatch'}} elseif($s.Status -ne 'Valid' -or $s.SignerCertificate.Thumbprint -ne $env:ARTEMIS_OFFICE_VERIFY_SIGNER){throw 'Office runtime signature mismatch'}";
  // Null is an explicit publisher-signed inventory policy for an unsigned EXE.
  // Package signature, every file digest and the final installed path are still verified.
  const binaries =
    manifest.native.windows ??
    [manifest.entrypoint, manifest.officeExecutable].map((path) => ({
      path,
      signer: manifest.native.signer,
    }));
  for (const { path, signer } of binaries) {
    await runFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        timeout: 30_000,
        windowsHide: true,
        env: {
          ...process.env,
          ARTEMIS_OFFICE_VERIFY_PATH: join(directory, path),
          ARTEMIS_OFFICE_VERIFY_SIGNER: signer ?? "unsigned",
        },
      },
    );
  }
}

export class UnoOfficeEngine implements OfficeEngine {
  readonly version: string;
  private bridge: ChildProcessWithoutNullStreams;
  private office: ReturnType<typeof spawn>;
  private pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private closed = false;

  private constructor(
    root: string,
    manifest: CapabilityPackManifest,
    profile: string,
    private readonly release: () => void,
  ) {
    this.version = manifest.version;
    const executable = join(root, manifest.officeExecutable);
    const program = dirname(executable);
    const pipe = `artemis_office_${randomUUID().replaceAll("-", "")}`;
    const bootstrap =
      process.platform === "darwin"
        ? join(program, "..", "Resources", "ure", "etc", "unorc")
        : join(program, "uno.ini");
    // The URE registry alone describes only XInterface. Office proxies also need offapi.
    const officeTypes =
      process.platform === "darwin"
        ? join(program, "..", "Resources", "types", "offapi.rdb")
        : join(program, "types", "offapi.rdb");
    const env: NodeJS.ProcessEnv = {
      PATH:
        process.platform === "win32"
          ? `${program};${process.env.SystemRoot}\\System32`
          : "/usr/bin:/bin",
      HOME: profile,
      TMPDIR: profile,
      TMP: profile,
      TEMP: profile,
      ...(process.platform === "win32"
        ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR }
        : {}),
    };
    this.office = spawn(
      executable,
      [
        "--headless",
        "--nologo",
        "--nodefault",
        "--norestore",
        `-env:UserInstallation=${pathToFileURL(join(profile, "user")).href}`,
        `--accept=pipe,name=${pipe};urp;StarOffice.ComponentContext`,
      ],
      { cwd: profile, env, stdio: "ignore", windowsHide: true },
    );
    this.office.on("error", (error) => this.fail(error));
    this.bridge = spawn(
      join(root, manifest.entrypoint),
      [
        pathToFileURL(bootstrap).href,
        `uno:pipe,name=${pipe};urp;StarOffice.ComponentContext`,
      ],
      {
        cwd: program,
        env: {
          ...env,
          URE_MORE_TYPES: pathToFileURL(officeTypes).href,
          PATH:
            process.platform === "win32" ? `${program};${env.PATH}` : env.PATH,
        },
        stdio: "pipe",
        windowsHide: true,
      },
    );
    let buffer = "";
    this.bridge.stdout.setEncoding("utf8");
    this.bridge.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) {
        this.fail(new Error("Office bridge response exceeds limit"));
        return;
      }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line) as {
            id: string;
            result?: unknown;
            error?: string;
          };
          const pending = this.pending.get(message.id);
          if (!pending) throw new Error("Unexpected Office bridge response");
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          if (typeof message.error === "string")
            pending.reject(new Error(message.error));
          else pending.resolve(message.result);
        } catch (error) {
          this.fail(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
    // Drain diagnostics without copying file contents into the conversation event log.
    this.bridge.stderr.resume();
    this.bridge.on("error", (error) => this.fail(error));
    this.bridge.on("exit", () =>
      this.fail(
        new Error(
          "Office engine exited; recover the session from its operation log",
        ),
      ),
    );
  }

  static async create(
    root: string,
    manifest: CapabilityPackManifest,
    profile: string,
    release: () => void,
  ): Promise<UnoOfficeEngine> {
    await mkdir(profile, { recursive: true, mode: 0o700 });
    return new UnoOfficeEngine(root, manifest, profile, release);
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    if (!this.closed) {
      this.closed = true;
      this.bridge?.kill();
      this.office?.kill();
      this.release();
    }
  }

  private request(
    command: string,
    fields: Record<string, unknown> = {},
  ): Promise<unknown> {
    if (this.closed)
      return Promise.reject(new Error("Office engine is closed"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new Error(`Office ${command} timed out`)),
        30_000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.bridge.stdin.write(
        `${JSON.stringify({ id, command, ...fields })}\n`,
        (error) => {
          if (error) this.fail(error);
        },
      );
    });
  }

  async open(
    path: string,
    format: "word" | "powerpoint" | "excel",
  ): Promise<OfficeEngineSnapshot> {
    return (await this.request("open", {
      path,
      format,
    })) as OfficeEngineSnapshot;
  }
  async apply(change: ArtifactOperation): Promise<void> {
    await this.request("apply", { change });
  }
  async snapshot(): Promise<OfficeEngineSnapshot> {
    return (await this.request("snapshot")) as OfficeEngineSnapshot;
  }
  async render(path: string): Promise<void> {
    await this.request("render", { path });
  }
  async save(path: string): Promise<void> {
    await this.request("save", { path });
  }
  async close(): Promise<void> {
    if (!this.closed) {
      try {
        await this.request("close");
      } catch {
        /* The committed journal remains recoverable. */
      }
      this.fail(new Error("Office engine closed"));
    }
  }
}
