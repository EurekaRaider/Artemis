// Exercise the production host against the anonymous public HTTPS installer.
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createOfficeWorkbench } from "../../apps/desktop/src/main/office-workbench.js";
import { UnoOfficeEngine } from "../../apps/desktop/src/main/office-uno-engine.js";
if (process.platform !== "win32" || !process.env.LOCALAPPDATA)
  throw Error("Windows user profile required");
for (const name of await readdir(process.env.LOCALAPPDATA)) {
  if (!name.startsWith("Artemis Office 发布验收-")) continue;
  const packs = join(process.env.LOCALAPPDATA, name, "capability-packs");
  for (const stage of await readdir(packs).catch(() => [] as string[])) {
    if (!stage.startsWith(".stage-")) continue;
    const archive = await stat(join(packs, stage, "download.zip")).catch(
      () => undefined,
    );
    console.log(
      "OFFICE_PREVIOUS_DOWNLOAD",
      JSON.stringify({
        bytes: archive?.size,
        modified: archive?.mtime.toISOString(),
      }),
    );
  }
}
const base = await mkdtemp(
  join(process.env.LOCALAPPDATA, "Artemis Office 发布验收-"),
);
const out = resolve("artifacts/office/public-windows");
await mkdir(out, { recursive: true });
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const workbench = await createOfficeWorkbench({
  userData: base,
  catalogPath: resolve(
    process.argv[2] ?? "apps/desktop/resources/office-runtime/catalog.json",
  ),
  hostVersion: version,
  dependents: async () => [],
  emit: () => {},
});
let lastBytes = -1;
let lastTransfer = Date.now();
let stalled = false;
const progress = setInterval(() => {
  void workbench.packs
    .status()
    .then(async ({ phase, downloadedBytes, totalBytes }) => {
      if (downloadedBytes !== lastBytes) {
        lastBytes = downloadedBytes;
        lastTransfer = Date.now();
      }
      const status = {
        phase,
        downloadedBytes,
        totalBytes,
        at: new Date().toISOString(),
      };
      console.log(`OFFICE_PUBLIC_PROGRESS ${JSON.stringify(status)}`);
      await writeFile(join(out, "progress.json"), JSON.stringify(status));
      if (phase === "downloading" && Date.now() - lastTransfer > 300_000) {
        stalled = true;
        workbench.packs.cancel();
      }
    })
    .catch((error) =>
      console.error("Progress observation failed:", error.message),
    );
}, 30_000);
let lease: Awaited<ReturnType<typeof workbench.packs.acquire>> | undefined;
try {
  const manifest = workbench.updates.available();
  if (
    !manifest ||
    manifest.platform !== "win32" ||
    manifest.version !== "1.0.1"
  )
    throw Error("Production catalog lacks the Windows release");
  if ((await workbench.status()).availableVersion !== "1.0.1")
    throw Error("The Windows host does not advertise online installation");
  console.log("OFFICE_PUBLIC_STAGE online-install", manifest.archive.url);
  await workbench.packs.install(manifest).catch((error) => {
    if (stalled)
      throw new Error("Public download made no progress for five minutes", {
        cause: error,
      });
    throw error;
  }); // No archive path, token or fetch override.
  console.log("OFFICE_PUBLIC_STAGE installed");
  if ((await workbench.status()).activeVersion !== "1.0.1")
    throw Error("Online installation did not activate");
  lease = await workbench.packs.acquire();
  console.log("OFFICE_PUBLIC_STAGE acquired");
  const workspace = join(base, "验证文档");
  await cp("artifacts/office/corpus", workspace, { recursive: true });
  for (const [file, format] of [
    ["word/2col-header.docx", "word"],
    ["sheets/fontSize.xlsx", "excel"],
    ["slides/ShapePlusImage.pptx", "powerpoint"],
  ] as const) {
    const engine = await UnoOfficeEngine.create(
      lease.root,
      lease.manifest,
      join(base, `profile-${format}`),
      () => {},
    );
    try {
      console.log("OFFICE_PUBLIC_STAGE native-preview", format);
      const snapshot = await engine.open(join(workspace, file), format);
      if (!snapshot.targets.length) throw Error(`No native content: ${file}`);
      await engine.render(join(out, `${format}.pdf`));
    } finally {
      await engine.close();
    }
  }
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => name.toLowerCase() !== "psmodulepath",
      ),
    ),
    OFFICE_INSTALLED_ROOT: lease.root,
  };
  console.log("OFFICE_PUBLIC_STAGE final-acl");
  const acl = JSON.parse(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `& { ${await readFile("scripts/office/verify-installed-acl.ps1", "utf8")} } -Root $env:OFFICE_INSTALLED_ROOT`,
      ],
      { env, encoding: "utf8", timeout: 180000 },
    ),
  );
  if (acl.administrator || acl.unexpectedWriters !== 0)
    throw Error("Expected a protected non-administrator installation");
  const report = {
    sourceCommit: process.env.GITHUB_SHA,
    hostVersion: version,
    runtimeVersion: manifest.version,
    archiveSha256: manifest.archive.sha256,
    publicDownloadValidated: true,
    productionHostInstall: true,
    nativeFormats: ["word", "excel", "powerpoint"],
    acl,
  };
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  clearInterval(progress);
  lease?.release();
  await workbench.sessions.dispose();
  await rm(base, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 500,
  });
}
