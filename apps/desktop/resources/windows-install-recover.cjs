const { spawn } = require("node:child_process");
const { join } = require("node:path");

// Keep this detached Node process alive until PowerShell finishes. PowerShell
// cannot run -File reliably in detached mode, while a non-detached child of
// Artemis would be killed by its Windows job when the application quits.
// The host runs from a copied runtime outside the installation directory.
const [helper, statePath] = process.argv.slice(2);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  ),
  [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    helper,
    "-StatePath",
    statePath,
  ],
  { windowsHide: true, stdio: "inherit", env },
);
child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
