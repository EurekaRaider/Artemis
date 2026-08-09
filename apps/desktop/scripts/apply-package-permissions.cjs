const { execFile } = require("node:child_process");
const { join } = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

exports.default = async function applyPackagePermissions(context) {
  const { verifyPackagedSourcePrivacy } =
    await import("./verify-packaged-source-privacy.mjs");
  await verifyPackagedSourcePrivacy(context);

  if (context.electronPlatformName === "darwin") {
    const { ensureNodePtySpawnHelpersExecutable } =
      await import("./node-pty-permissions.mjs");
    const appPath = join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
    );
    await ensureNodePtySpawnHelpersExecutable(
      join(
        appPath,
        "Contents",
        "Resources",
        "app.asar.unpacked",
        "node_modules",
        "node-pty",
      ),
    );
    return;
  }

  if (context.electronPlatformName !== "win32") {
    return;
  }

  if (
    process.platform !== "win32" &&
    process.env.ARTEMIS_ALLOW_CROSS_WINDOWS_ZIP === "1"
  ) {
    return;
  }

  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (!systemRoot) {
    throw new Error("Windows system directory is unavailable.");
  }

  await execFileAsync(
    join(systemRoot, "System32", "icacls.exe"),
    [
      context.appOutDir,
      "/grant",
      "*S-1-15-2-1:(OI)(CI)(RX)",
      "*S-1-15-2-2:(OI)(CI)(RX)",
      "/T",
      "/C",
      "/Q",
    ],
    { windowsHide: true },
  );
};
