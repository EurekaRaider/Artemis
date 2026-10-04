const { execFile } = require("node:child_process");
const { join } = require("node:path");
const { promisify } = require("node:util");

const applyPackagePermissions = require("./apply-package-permissions.cjs");

const execFileAsync = promisify(execFile);

exports.default = async function applyEngineeringPackagePermissions(context) {
  await applyPackagePermissions.default(context);
  if (context.electronPlatformName !== "darwin") return;

  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  await execFileAsync(
    "/usr/bin/codesign",
    ["--force", "--deep", "--sign", "-", appPath],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  await execFileAsync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", appPath],
    { maxBuffer: 16 * 1024 * 1024 },
  );
};
