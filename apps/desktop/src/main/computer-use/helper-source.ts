import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import type { ComputerHelperLease } from "./native-driver.js";

/** Development and signed hosts have different native parent trust requirements. */
export function computerHelperSource(
  host: { isPackaged: boolean; appPath: string; platform: NodeJS.Platform },
  released: () => Promise<ComputerHelperLease>,
): () => Promise<ComputerHelperLease> {
  if (host.isPackaged) return released;
  return async () => {
    const root = join(host.appPath, "build", "computer-use", "development");
    const path = join(
      root,
      host.platform === "win32"
        ? "artemis-computer-use.exe"
        : "artemis-computer-use",
    );
    const previewPath = join(root, "artemis-computer-preview.node");
    try {
      await access(path, constants.X_OK);
      await access(previewPath, constants.R_OK);
    } catch (cause) {
      throw new Error(
        "Computer Use development helper or preview is missing. Rebuild with npm run build:electron -w @artemis/desktop, then restart the development app.",
        { cause },
      );
    }
    return { path, previewPath, release() {} };
  };
}
