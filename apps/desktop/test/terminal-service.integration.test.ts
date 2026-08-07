import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TerminalService } from "../src/main/terminal-service.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryPath = resolve(testDirectory, "..", "..", "..");

describe("TerminalService Windows integration", () => {
  it.runIf(process.platform === "win32")(
    "runs an interactive PTY with the current desktop user's filesystem and network access",
    async () => {
      const workspacePath = await mkdtemp(
        join(repositoryPath, ".artemis-pty-workspace-"),
      );
      const outsideWorkspacePath = join(
        repositoryPath,
        ".artemis-pty-outside.tmp",
      );
      await rm(outsideWorkspacePath, { force: true });
      let output = "";
      let resolveExit: ((exitCode: number) => void) | undefined;
      const exited = new Promise<number>((resolvePromise) => {
        resolveExit = resolvePromise;
      });
      let timeoutHandle: NodeJS.Timeout | undefined;
      const service = new TerminalService("win32", {
        onData: (_terminalId, data) => {
          output += data;
        },
        onExit: ({ exitCode }) => {
          resolveExit?.(exitCode);
        },
      });

      try {
        const terminal = service.open({
          threadId: "native-pty",
          workspacePath,
          shell: "powershell.exe",
          cols: 100,
          rows: 30,
        });
        const script = [
          "$ErrorActionPreference='Stop'",
          'Write-Output "LOCATION_$((Get-Location).Path)"',
          "$inside=Join-Path (Get-Location) '.artemis-pty-inside.tmp'",
          'Write-Output "HISTORY_$((Get-PSReadLineOption).HistorySaveStyle)"',
          "try { Set-Content -LiteralPath $inside -Value 'ok'; Write-Output 'INSIDE_WRITE_OK' } catch { Write-Output 'INSIDE_WRITE_DENIED' }",
          `$outsideWorkspace='${outsideWorkspacePath}'`,
          "try { Set-Content -LiteralPath $outsideWorkspace -Value 'escape'; Write-Output 'OUTSIDE_WORKSPACE_WRITE_ALLOWED' } catch { Write-Output 'OUTSIDE_WORKSPACE_WRITE_DENIED' }",
          "$outside=Join-Path $env:USERPROFILE '.artemis-pty-escape.tmp'",
          "try { Set-Content -LiteralPath $outside -Value 'escape'; Remove-Item -LiteralPath $outside -Force; Write-Output 'OUTSIDE_WRITE_ALLOWED' } catch { Write-Output 'OUTSIDE_WRITE_DENIED' }",
          "try { Invoke-WebRequest -Uri 'https://example.com' -UseBasicParsing -TimeoutSec 5 | Out-Null; Write-Output 'NETWORK_ALLOWED' } catch { Write-Output 'NETWORK_DENIED' }",
          "Remove-Item -LiteralPath $inside -Force -ErrorAction SilentlyContinue",
          "Write-Output 'ARTEMIS_PTY_DONE'",
          "exit",
        ].join("; ");
        service.write(terminal.terminalId, `${script}\r`);

        const timeout = new Promise<never>((_resolve, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`PTY timed out. Output:\n${output}`)),
            60_000,
          );
        });
        expect(await Promise.race([exited, timeout]), output).toBe(0);
        expect(output).toContain(`LOCATION_${workspacePath}`);
        expect(output).toContain("HISTORY_SaveNothing");
        expect(output).not.toContain("ConsoleHost_history.txt");
        expect(output).toContain("INSIDE_WRITE_OK");
        expect(output).toContain("OUTSIDE_WORKSPACE_WRITE_ALLOWED");
        expect(output).toContain("OUTSIDE_WRITE_ALLOWED");
        expect(output).toContain("NETWORK_ALLOWED");
        expect(output).toContain("ARTEMIS_PTY_DONE");
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        service.dispose();
        await rm(outsideWorkspacePath, { force: true });
        await rm(workspacePath, { recursive: true, force: true });
      }
    },
    90_000,
  );
});
