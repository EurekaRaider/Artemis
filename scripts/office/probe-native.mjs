import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, value, index, values) =>
        value.startsWith("--")
          ? [...pairs, [value.slice(2), values[index + 1]]]
          : pairs,
      [],
    ),
);
if (!args.office || !args.bridge)
  throw new Error(
    "Pass --office <soffice> --bridge <office-bridge> [--corpus directory] [--out directory]",
  );
const out = resolve(args.out ?? "artifacts/office/probe");
const corpus = resolve(args.corpus ?? "artifacts/office/corpus");
await mkdir(out, { recursive: true });
const source = JSON.parse(
  await readFile(
    join(dirname(fileURLToPath(import.meta.url)), "corpus.json"),
    "utf8",
  ),
);
const profile = join(out, `profile-${randomUUID()}`);
await mkdir(profile);
const pipe = `artemis_probe_${randomUUID().replaceAll("-", "")}`;
const office = spawn(
  resolve(args.office),
  [
    "--headless",
    "--nologo",
    "--nodefault",
    "--norestore",
    `-env:UserInstallation=${pathToFileURL(profile).href}`,
    `--accept=pipe,name=${pipe};urp;StarOffice.ComponentContext`,
  ],
  { stdio: "ignore" },
);
const bootstrap =
  process.platform === "darwin"
    ? join(
        dirname(resolve(args.office)),
        "..",
        "Resources",
        "ure",
        "etc",
        "unorc",
      )
    : join(dirname(resolve(args.office)), "uno.ini");
const officeTypes =
  process.platform === "darwin"
    ? join(
        dirname(resolve(args.office)),
        "..",
        "Resources",
        "types",
        "offapi.rdb",
      )
    : join(dirname(resolve(args.office)), "types", "offapi.rdb");
const bridge = spawn(
  resolve(args.bridge),
  [
    pathToFileURL(bootstrap).href,
    `uno:pipe,name=${pipe};urp;StarOffice.ComponentContext`,
  ],
  {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: dirname(resolve(args.office)),
    env: { ...process.env, URE_MORE_TYPES: pathToFileURL(officeTypes).href },
  },
);
const pending = new Map();
let buffered = "",
  diagnostics = "";
bridge.stderr.setEncoding("utf8");
bridge.stderr.on("data", (chunk) => {
  diagnostics = (diagnostics + chunk).slice(-4000);
});
bridge.stdout.setEncoding("utf8");
bridge.stdout.on("data", (chunk) => {
  buffered += chunk;
  let newline;
  while ((newline = buffered.indexOf("\n")) >= 0) {
    const value = JSON.parse(buffered.slice(0, newline));
    buffered = buffered.slice(newline + 1);
    const wait = pending.get(value.id);
    if (!wait) continue;
    pending.delete(value.id);
    clearTimeout(wait.timer);
    if (value.error !== undefined) wait.reject(new Error(value.error));
    else wait.resolve(value.result);
  }
});
bridge.on("exit", (code, signal) => {
  for (const wait of pending.values()) {
    clearTimeout(wait.timer);
    wait.reject(new Error(`bridge exit ${code ?? signal}: ${diagnostics}`));
  }
  pending.clear();
});
function request(command, fields = {}) {
  if (bridge.exitCode !== null || bridge.signalCode)
    return Promise.reject(
      new Error(
        `bridge is unavailable: ${bridge.exitCode ?? bridge.signalCode}`,
      ),
    );
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${command} timed out: ${diagnostics}`));
    }, 30_000);
    pending.set(id, { resolve, reject, timer });
    bridge.stdin.write(`${JSON.stringify({ id, command, ...fields })}\n`);
  });
}
const measurements = [];
try {
  for (const sample of source.samples) {
    const directory = join(out, sample.id.replaceAll("/", "_"));
    await mkdir(directory, { recursive: true });
    const row = {
      id: sample.id,
      format: sample.format,
      nativeFlowPassed: false,
      compatibilityAccepted: false,
    };
    try {
      let start = performance.now();
      const snapshot = await request("open", {
        path: join(corpus, sample.id),
        format: sample.format,
      });
      row.openMs = performance.now() - start;
      const target = snapshot.targets.find((target) => target.text.length > 0);
      if (!target)
        throw new Error("No supported selection target in this sample");
      const marker = "Artemis probe ";
      let change;
      if (target.selection.kind === "paragraph")
        change = {
          type: "replace-text",
          paragraph: target.selection.index,
          start: 0,
          end: 0,
          text: marker,
        };
      else if (target.selection.kind === "object")
        change = {
          type: "set-object-text",
          page: target.selection.page,
          object: target.selection.index,
          text: marker + target.text,
        };
      else {
        const [, columnName, rowNumber] =
          target.selection.range.match(/^([A-Z]+)(\d+)/u);
        const column = [...columnName].reduce(
          (value, char) => value * 26 + char.charCodeAt(0) - 64,
          0,
        );
        change = {
          type: "set-cells",
          sheet: target.selection.sheet,
          column,
          row: Number(rowNumber),
          values: [[marker + target.text]],
        };
      }
      row.selection = target.selection;
      start = performance.now();
      await request("apply", { change });
      row.operationAckMs = performance.now() - start;
      const changed = await request("snapshot");
      row.snapshotMs = performance.now() - start;
      if (!changed.targets.some((target) => target.text.includes(marker)))
        throw new Error("Applied content is missing from native snapshot");
      start = performance.now();
      await request("render", { path: join(directory, "live.pdf") });
      row.nativePdfMs = performance.now() - start;
      const saved = join(directory, sample.id.split("/").at(-1));
      await request("save", { path: saved });
      await request("close");
      const reopened = await request("open", {
        path: saved,
        format: sample.format,
      });
      if (!reopened.targets.some((target) => target.text.includes(marker)))
        throw new Error("Edited content did not survive save/reopen");
      await request("render", { path: join(directory, "reopened.pdf") });
      await writeFile(
        join(directory, "snapshots.json"),
        JSON.stringify({ original: snapshot, changed, reopened }, null, 2),
      );
      row.nativeFlowPassed = true;
      row.targetCountBefore = snapshot.targets.length;
      row.targetCountAfter = reopened.targets.length;
      row.warnings = reopened.warnings;
    } catch (error) {
      row.error = String(error);
    } finally {
      await request("close").catch(() => undefined);
    }
    measurements.push(row);
    await writeFile(
      join(out, "report.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          measuredAt: new Date().toISOString(),
          platform: process.platform,
          arch: process.arch,
          sourceCommit: source.sourceCommit,
          notes: [
            "Native operation and PDF export measurements, not UI paint latency.",
            "Compatibility is not accepted by opening or round-tripping alone. Inspect pixels and feature preservation.",
          ],
          samples: measurements,
        },
        null,
        2,
      ),
    );
    console.log(
      `${row.nativeFlowPassed ? "FLOW" : "FAIL"} ${row.id}: ${row.error ?? `ack ${Math.round(row.operationAckMs)}ms, PDF ${Math.round(row.nativePdfMs)}ms`}`,
    );
    if (bridge.exitCode !== null || bridge.signalCode) break;
  }
} finally {
  bridge.stdin.end();
  bridge.kill();
  office.kill();
}
if (measurements.some((sample) => !sample.nativeFlowPassed))
  process.exitCode = 1;
