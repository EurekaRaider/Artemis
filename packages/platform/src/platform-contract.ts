export interface PlatformContract {
  platform: "win32" | "darwin" | "other";
  arch: string;
  supported: boolean;
  shell: string;
  sandbox: {
    available: boolean;
    implementation: string;
    releaseBlockingReason?: string;
  };
}

export function getPlatformContract(
  platform = process.platform,
  arch = process.arch,
): PlatformContract {
  if (platform === "win32") {
    return {
      platform,
      arch,
      supported: arch === "x64",
      shell: "powershell.exe",
      sandbox: {
        available: true,
        implementation:
          "Windows AppContainer + low integrity + Job Object executor",
      },
    };
  }

  if (platform === "darwin") {
    return {
      platform,
      arch,
      supported: arch === "arm64" || arch === "x64",
      shell: process.env.SHELL || "/bin/zsh",
      sandbox: {
        available: true,
        implementation: "macOS Seatbelt sandbox-exec profile",
        releaseBlockingReason:
          "Seatbelt must pass native macOS arm64 and x64 validation before public beta.",
      },
    };
  }

  return {
    platform: "other",
    arch,
    supported: false,
    shell: process.env.SHELL || "sh",
    sandbox: {
      available: false,
      implementation: "unsupported",
      releaseBlockingReason: "Artemis beta supports Windows and macOS only.",
    },
  };
}
