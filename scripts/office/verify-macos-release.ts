import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createOfficeWorkbench } from "../../apps/desktop/src/main/office/office-workbench.js";
import { downloadPublicMacOfficeCatalog } from "./public-macos-catalog.mjs";

let catalogPath = resolve(process.argv[2]);
const online = process.argv.includes("--online");
const { version: hostVersion } = JSON.parse(
  await readFile("package.json", "utf8"),
);
const root = await mkdtemp(join(tmpdir(), "artemis-office-install-"));
let release: (() => void) | undefined;
try {
  let publicCatalogUrl: string | undefined;
  if (online) {
    const downloaded = await downloadPublicMacOfficeCatalog(
      await readFile(catalogPath),
      process.env.OFFICE_RUNTIME_VERSION,
    );
    catalogPath = join(root, "public-catalog.json");
    await writeFile(catalogPath, downloaded.content);
    publicCatalogUrl = downloaded.url;
  }
  const workbench = await createOfficeWorkbench({
    userData: root,
    catalogPath,
    hostVersion,
    dependents: async () => [],
    emit: () => {},
  });
  const manifest = workbench.updates.available();
  if (
    !manifest ||
    manifest.platform !== "darwin" ||
    manifest.arch !== process.arch ||
    manifest.version !== process.env.OFFICE_RUNTIME_VERSION
  )
    throw new Error("The macOS host does not advertise this runtime");
  await workbench.packs.install(
    manifest,
    online
      ? undefined
      : join(
          resolve("artifacts/office/macos-release"),
          basename(new URL(manifest.archive.url).pathname),
        ),
  );
  const lease = await workbench.packs.acquire();
  release = lease.release;
  // Exercise the real installed bridge and engine with each pinned corpus format.
  execFileSync(
    process.execPath,
    [
      "scripts/office/probe-native.mjs",
      "--office",
      join(lease.root, manifest.officeExecutable),
      "--bridge",
      join(lease.root, manifest.entrypoint),
      "--out",
      online
        ? "artifacts/office/macos-online-native-probe"
        : "artifacts/office/macos-native-probe",
    ],
    { stdio: "inherit", timeout: 300_000 },
  );
  await writeFile(
    resolve(
      "artifacts/office/macos-release/" +
        (online
          ? "public-installed-native-acceptance.json"
          : "installed-native-acceptance.json"),
    ),
    JSON.stringify(
      {
        sourceCommit: process.env.GITHUB_SHA,
        platform: manifest.platform,
        arch: manifest.arch,
        version: manifest.version,
        archiveSha256: manifest.archive.sha256,
        hostVersion,
        nativeCorpusVerified: true,
        onlineInstallVerified: online,
        ...(publicCatalogUrl ? { publicCatalogUrl } : {}),
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  release?.();
  await rm(root, { recursive: true, force: true });
}
