import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { CapabilityPackService } from "../../apps/desktop/src/main/capability-pack-service.js";
import {
  UnoOfficeEngine,
  verifyOfficeNative,
} from "../../apps/desktop/src/main/office-uno-engine.js";
import type { CapabilityPackManifest } from "@artemis/protocol";

const [candidatePath, rootPath, workspacePath, outputPath, probePath] =
  process.argv.slice(2);
if (
  process.platform !== "win32" ||
  !candidatePath ||
  !rootPath ||
  !workspacePath ||
  !outputPath ||
  !probePath
)
  throw Error(
    "verify-candidate <candidate> <installed root> <workspace> <evidence> <probe script>",
  );
const candidate = resolve(candidatePath),
  root = resolve(rootPath),
  workspace = resolve(workspacePath),
  out = resolve(outputPath);
await mkdir(out, { recursive: true });
const catalog = JSON.parse(
  await readFile(join(candidate, "catalog.json"), "utf8"),
) as {
  publicKeys: Record<string, string>;
  manifests: CapabilityPackManifest[];
};
const [first, upgrade] = catalog.manifests;
if (!first || !upgrade) throw Error("Candidate lacks upgrade fixtures");
const archive = join(candidate, "office-core-win32-x64.zip");
const checkpoints: string[] = [];
let users: string[] = [],
  cancelDownload = false,
  downloads = 0;
const server = createServer((_request, response) => {
  downloads++;
  const stream = createReadStream(archive);
  response.on("close", () => stream.destroy());
  stream.pipe(response);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string")
  throw Error("No transport fixture address");
const service = new CapabilityPackService({
  root,
  hostVersion: "1.6.8",
  platform: "win32",
  arch: "x64",
  publicKeys: catalog.publicKeys,
  verifyNative: verifyOfficeNative,
  dependents: async () => users,
  // Real streamed transport with an explicit loopback fixture; this does not
  // claim the final public HTTPS release URL has been published or tested.
  fetch: async (url, options) => {
    if (url !== upgrade.archive.url)
      throw Error("Unexpected candidate download URL");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/candidate.zip`,
      { signal: options?.signal, redirect: "error" },
    );
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  },
  onProgress: (status) => {
    if (cancelDownload && status.downloadedBytes > 0) service.cancel();
  },
});
const reject = async (action: Promise<unknown>, message: string) => {
  try {
    await action;
  } catch (error) {
    if (String(error).includes(message)) return;
    throw error;
  }
  throw Error(`Expected rejection: ${message}`);
};
let release: (() => void) | undefined;
const report: Record<string, unknown> = {
  schemaVersion: 1,
  commit: process.env.GITHUB_SHA,
  candidate: true,
  finalCapabilityPackage: true,
  releaseAccepted: false,
  checkpoints,
  transport: "loopback HTTP streaming; offline ZIP",
  publicDownloadValidated: false,
};
try {
  await service.install(first, archive);
  checkpoints.push("offline-install");
  const initial = await service.acquire();
  release = initial.release;
  users = ["Documents", "Presentations", "Spreadsheets"];
  await reject(service.uninstall(first.version), "in use");
  checkpoints.push("active-session-uninstall-protected");
  cancelDownload = true;
  await reject(service.install(upgrade), "cancelled");
  if ((await service.status()).activeVersion !== first.version)
    throw Error("Cancellation changed the active version");
  checkpoints.push("interrupted-download-retains-active-version");
  cancelDownload = false;
  await service.install(upgrade);
  if ((await service.status()).activeVersion !== upgrade.version)
    throw Error("Upgrade did not activate");
  checkpoints.push("streamed-upgrade");
  await service.activate(first.version);
  release();
  release = undefined;
  await reject(service.uninstall(first.version), "shared");
  checkpoints.push("rollback", "shared-plugin-uninstall-protected");
  await writeFile(
    join(root, "office-core", first.version, "manifest.json"),
    "{interrupted receipt",
  );
  await service.install(first, archive);
  await writeFile(
    join(root, "office-core", first.version, "payload", first.entrypoint),
    "corrupted candidate fixture",
  );
  await service.install(first, archive);
  checkpoints.push("damaged-receipt-repaired", "damaged-payload-repaired");
  users = [];
  await service.uninstall(upgrade.version);
  await service.deactivate();
  await service.uninstall(first.version);
  if ((await service.status()).versions.length)
    throw Error("Uninstall left an advertised installation");
  checkpoints.push("uninstall");
  await service.install(first, archive);
  const lease = await service.acquire();
  release = lease.release;
  const engine = await UnoOfficeEngine.create(
    lease.root,
    lease.manifest,
    join(out, `profile-${randomUUID()}`),
    () => {},
  );
  try {
    const opened = await engine.open(
      join(workspace, "word/2col-header.docx"),
      "word",
    );
    if (!opened.targets.length)
      throw Error("Host engine did not return document content");
    await engine.apply({
      type: "replace-text",
      paragraph: 0,
      start: 0,
      end: 0,
      text: "Candidate acceptance ",
    });
    if (
      !(await engine.snapshot()).targets.some((target) =>
        target.text.includes("Candidate acceptance"),
      )
    )
      throw Error("Host engine mutation failed");
    await engine.render(join(out, "candidate-host.pdf"));
    await engine.save(join(out, "candidate-host.docx"));
    checkpoints.push("actual-host-engine-open-edit-render-save");
  } finally {
    await engine.close();
  }
  const trust = JSON.parse(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        join(dirname(resolve(probePath)), "verify-installed-acl.ps1"),
        "-Root",
        lease.root,
      ],
      { encoding: "utf8", timeout: 180_000 },
    ),
  );
  if (trust.administrator)
    throw Error(
      "Installed candidate acceptance requires an ordinary user token",
    );
  checkpoints.push("final-installed-acl");
  report.installed = { ...trust, version: first.version, payload: lease.root };
  const run = spawnSync(
    process.execPath,
    [
      resolve(probePath),
      "--office",
      join(lease.root, first.officeExecutable),
      "--bridge",
      join(lease.root, first.entrypoint),
      "--corpus",
      workspace,
      "--out",
      join(out, "native"),
    ],
    { stdio: "inherit", timeout: 180_000 },
  );
  report.nativeProbeExitCode = run.status;
  if (run.error) throw run.error;
  if (run.status !== 0)
    throw Error("Installed candidate failed native corpus acceptance");
  checkpoints.push("installed-native-corpus");
  report.candidateAccepted = true;
} catch (error) {
  report.error = String(error);
  report.candidateAccepted = false;
  process.exitCode = 1;
} finally {
  release?.();
  report.downloadRequests = downloads;
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  server.closeAllConnections();
  server.close();
}
