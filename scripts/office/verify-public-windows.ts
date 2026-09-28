// Exercise the production host against the anonymous public HTTPS installer.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createOfficeWorkbench } from "../../apps/desktop/src/main/office-workbench.js";
import { UnoOfficeEngine } from "../../apps/desktop/src/main/office-uno-engine.js";
if (process.platform !== "win32" || !process.env.LOCALAPPDATA)
  throw Error("Windows user profile required");
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
  await workbench.packs.install(manifest); // No archive path, token or fetch override.
  if ((await workbench.status()).activeVersion !== "1.0.1")
    throw Error("Online installation did not activate");
  lease = await workbench.packs.acquire();
  const workspace = join(base, "验证文档");
  await cp("artifacts/office/corpus", workspace, { recursive: true });
  const engine = await UnoOfficeEngine.create(
    lease.root,
    lease.manifest,
    join(base, "profile"),
    () => {},
  );
  try {
    for (const [file, format] of [
      ["word/2col-header.docx", "word"],
      ["sheets/fontSize.xlsx", "excel"],
      ["slides/ShapePlusImage.pptx", "powerpoint"],
    ] as const) {
      const snapshot = await engine.open(join(workspace, file), format);
      if (!snapshot.targets.length) throw Error(`No native content: ${file}`);
      await engine.render(join(out, `${format}.pdf`));
    }
  } finally {
    await engine.close();
  }
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => name.toLowerCase() !== "psmodulepath",
      ),
    ),
    OFFICE_INSTALLED_ROOT: lease.root,
  };
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
  lease?.release();
  await workbench.sessions.dispose();
  await rm(base, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 500,
  });
}
