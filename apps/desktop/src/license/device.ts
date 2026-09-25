import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { deviceCode } from "./codec.js";

const exec = promisify(execFile);
export async function readDeviceCode(): Promise<string> {
  if (process.platform === "darwin") {
    const { stdout } = await exec(
      "/usr/sbin/ioreg",
      ["-rd1", "-c", "IOPlatformExpertDevice"],
      { timeout: 10_000, maxBuffer: 1024 * 1024 },
    );
    const uuid = /"IOPlatformUUID"\s*=\s*"([a-fA-F0-9-]+)"/.exec(stdout)?.[1];
    return deviceCode("darwin", uuid ?? "");
  }
  if (process.platform === "win32") {
    const { stdout } = await exec(
      `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\reg.exe`,
      [
        "query",
        "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
        "/v",
        "MachineGuid",
        "/reg:64",
      ],
      { timeout: 10_000, windowsHide: true },
    );
    const uuid = /MachineGuid\s+REG_SZ\s+([a-fA-F0-9-]+)/i.exec(stdout)?.[1];
    const { stdout: hardware } = await exec(
      `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID",
      ],
      { timeout: 15_000, windowsHide: true },
    );
    return deviceCode("win32", `${uuid ?? ""}:${hardware.trim()}`);
  }
  throw new Error("device_unavailable");
}
