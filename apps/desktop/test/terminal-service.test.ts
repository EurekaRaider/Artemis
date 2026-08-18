import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TerminalService,
  type PtyFactory,
  type PtyProcess,
} from "../src/main/terminal-service.js";

const terminalServiceSource = readFileSync(
  new URL("../src/main/terminal-service.ts", import.meta.url),
  "utf8",
);
const mainSource = readFileSync(
  new URL("../src/main/main.ts", import.meta.url),
  "utf8",
);
const mcpClientManagerSource = readFileSync(
  new URL("../src/main/mcp-client-manager.ts", import.meta.url),
  "utf8",
);
const trustedExtensionManagerSource = readFileSync(
  new URL("../src/main/trusted-extension-manager.ts", import.meta.url),
  "utf8",
);

class FakePty implements PtyProcess {
  readonly write = vi.fn();
  readonly resize = vi.fn();
  readonly kill = vi.fn();
  private dataListener?: (data: string) => void;
  private exitListener?: (event: { exitCode: number; signal?: number }) => void;

  onData(listener: (data: string) => void) {
    this.dataListener = listener;
    return { dispose: vi.fn() };
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
    this.exitListener = listener;
    return { dispose: vi.fn() };
  }

  emitData(data: string) {
    this.dataListener?.(data);
  }

  emitExit(exitCode: number) {
    this.exitListener?.({ exitCode });
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TerminalService", () => {
  it("starts Windows PTY directly as the desktop user with inherited cwd and network environment", () => {
    const fake = new FakePty();
    const factory = vi.fn(() => fake) as PtyFactory;
    const onData = vi.fn();
    const onExit = vi.fn();
    const shell =
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    vi.stubEnv("ARTEMIS_NETWORK", "desktop-network");
    vi.stubEnv("ARTEMIS_SANDBOX", "desktop-user");
    vi.stubEnv("ARTEMIS_TERMINAL_INHERITANCE_TEST", "inherited");
    const service = new TerminalService(
      "win32",
      { onData, onExit },
      factory,
      () => ({
        kind: "powershell",
        executable: shell,
        edition: "Desktop",
        version: "5.1",
      }),
    );

    const descriptor = service.open({
      threadId: "thread-1",
      workspacePath: "C:\\repo",
      shell: "powershell.exe",
      cols: 80,
      rows: 24,
    });

    const [executable, args, options] = factory.mock.calls[0]!;
    expect(executable).toBe(shell);
    expect(args).toEqual(
      expect.arrayContaining(["-NoLogo", "-NoExit", "-EncodedCommand"]),
    );
    expect(`${executable}\0${args.join("\0")}`).not.toMatch(
      /windows-sandbox|appcontainer|runas|start-process.*-verb\s+runas/iu,
    );
    expect(options.cwd).toBe("C:\\repo");
    expect(options.env.ARTEMIS_NETWORK).toBe("desktop-network");
    expect(options.env.ARTEMIS_SANDBOX).toBe("desktop-user");
    expect(options.env.ARTEMIS_TERMINAL_INHERITANCE_TEST).toBe("inherited");
    expect(options.env.TERM).toBe("xterm-256color");
    expect(descriptor.sandboxImplementation).not.toBe("windows-appcontainer");
    service.write(descriptor.terminalId, "Get-Location\r");
    expect(fake.write).toHaveBeenCalledWith("Get-Location\r");
    fake.emitData("C:\\repo");
    expect(onData).toHaveBeenCalledWith(descriptor.terminalId, "C:\\repo");
  });

  it("loads the interactive PowerShell profile while disabling persistent history", () => {
    const fake = new FakePty();
    const factory = vi.fn(() => fake) as PtyFactory;
    const service = new TerminalService(
      "win32",
      { onData: vi.fn(), onExit: vi.fn() },
      factory,
      () => ({
        kind: "powershell",
        executable:
          "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        edition: "Desktop",
        version: "5.1",
      }),
    );

    const descriptor = service.open({
      threadId: "thread-history",
      workspacePath: "C:\\repo",
      shell: "powershell.exe",
      cols: 80,
      rows: 24,
    });

    const shellArguments = factory.mock.calls[0]?.[1] ?? [];

    expect(
      shellArguments.includes("-File"),
      "interactive PowerShell must not be launched through a helper script",
    ).toBe(false);
    expect(shellArguments).toEqual(
      expect.arrayContaining(["-NoLogo", "-NoExit", "-EncodedCommand"]),
    );
    expect(shellArguments).not.toContain("-ArgumentsBase64");
    expect(shellArguments).not.toContain("-File");
    expect(shellArguments).not.toContain("-NoProfile");
    const bootstrapIndex = shellArguments.indexOf("-EncodedCommand");
    const bootstrap = Buffer.from(
      shellArguments[bootstrapIndex + 1] ?? "",
      "base64",
    ).toString("utf16le");
    expect(bootstrap).toContain(
      "(Get-Location).Path -ne $env:ARTEMIS_WORKSPACE",
    );
    expect(bootstrap).toContain(
      "Set-PSReadLineOption -HistorySaveStyle SaveNothing",
    );
    expect(factory.mock.calls[0]?.[2].env).toMatchObject({
      ARTEMIS_WORKSPACE: "C:\\repo",
    });

    service.write(descriptor.terminalId, "Get-Location\r");
    expect(fake.write).toHaveBeenCalledWith("Get-Location\r");
  });

  it("starts the macOS login shell directly with inherited desktop access", () => {
    const fake = new FakePty();
    const factory = vi.fn(() => fake) as PtyFactory;
    vi.stubEnv("ARTEMIS_NETWORK", "desktop-network");
    const service = new TerminalService(
      "darwin",
      { onData: vi.fn(), onExit: vi.fn() },
      factory,
    );

    service.open({
      threadId: "thread-plan",
      workspacePath: "/Users/test/repo",
      shell: "/bin/zsh",
      cols: 80,
      rows: 24,
    });

    const [executable, args, options] = factory.mock.calls[0]!;
    expect(executable).toBe("/bin/zsh");
    expect(args).toEqual(["-l"]);
    expect(options.cwd).toBe("/Users/test/repo");
    expect(options.env.ARTEMIS_NETWORK).toBe("desktop-network");
    expect(options.env.TERM).toBe("xterm-256color");
  });

  it("keeps Terminal and stdio MCP direct while preserving extension sandboxing", () => {
    expect(
      terminalServiceSource.includes("buildWindowsAppContainerLaunch"),
      "TerminalService must not call the Windows AppContainer builder",
    ).toBe(false);
    expect(
      terminalServiceSource.includes("buildSeatbeltLaunch"),
      "TerminalService must not call the macOS Seatbelt builder",
    ).toBe(false);
    expect(
      /terminalService\.open\(\{[\s\S]*?helperPath:\s*windowsSandboxHelperPath\(\)[\s\S]*?\}\)/u.test(
        mainSource,
      ),
      "main must not pass the Windows sandbox helper to TerminalService",
    ).toBe(false);

    expect(mcpClientManagerSource).toContain("buildDesktopUserLaunch");
    expect(mcpClientManagerSource).not.toContain(
      "buildWindowsAppContainerLaunch",
    );
    expect(mcpClientManagerSource).not.toContain("buildSeatbeltLaunch");
    expect(trustedExtensionManagerSource).toContain(
      "buildWindowsAppContainerLaunch",
    );
    expect(trustedExtensionManagerSource).toContain("buildSeatbeltLaunch");
  });

  it("closes only the terminal owned by a deleted thread", () => {
    const first = new FakePty();
    const second = new FakePty();
    const factory = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second) as PtyFactory;
    const service = new TerminalService(
      "darwin",
      { onData: vi.fn(), onExit: vi.fn() },
      factory,
    );
    const firstDescriptor = service.open({
      threadId: "thread-1",
      workspacePath: "/Users/test/thread-1",
      shell: "/bin/zsh",
      cols: 80,
      rows: 24,
    });
    const secondDescriptor = service.open({
      threadId: "thread-2",
      workspacePath: "/Users/test/thread-2",
      shell: "/bin/zsh",
      cols: 80,
      rows: 24,
    });

    service.closeThread("thread-1");

    expect(first.kill).toHaveBeenCalledOnce();
    expect(second.kill).not.toHaveBeenCalled();
    expect(() => service.write(firstDescriptor.terminalId, "closed")).toThrow(
      "no longer active",
    );
    service.write(secondDescriptor.terminalId, "open");
    expect(second.write).toHaveBeenCalledWith("open");
  });

  it("clamps resize requests and kills every session on dispose", () => {
    const fake = new FakePty();
    const service = new TerminalService(
      "darwin",
      { onData: vi.fn(), onExit: vi.fn() },
      () => fake,
    );
    const descriptor = service.open({
      threadId: "thread-1",
      workspacePath: "/Users/test/repo",
      shell: "/bin/zsh",
      cols: 80,
      rows: 24,
    });

    service.resize(descriptor.terminalId, 2, 9_999);
    expect(fake.resize).toHaveBeenCalledWith(20, 200);
    service.dispose();
    expect(fake.kill).toHaveBeenCalledOnce();
  });
});
