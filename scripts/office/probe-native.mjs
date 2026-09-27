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
const marker = "[Artemis probe]";
function planEdit(sample, snapshot) {
  if (sample.format === "word") {
    const target =
      snapshot.targets.find((target) => target.text) ?? snapshot.targets[0];
    if (!target) throw new Error("No paragraph or table cell in Word sample");
    return {
      target,
      change: {
        type: "replace-text",
        paragraph: target.selection.index,
        start: 0,
        end: 0,
        text: marker,
      },
    };
  }
  if (sample.format === "powerpoint") {
    const text =
      sample.id === "slides/connector-shape-animations.pptx"
        ? snapshot.targets.find((target) => target.selection.cell)
        : snapshot.targets.find((target) => target.editable && target.text);
    const target = text ?? snapshot.targets.find((target) => target.bounds);
    if (!target && sample.id === "slides/onemaster-twolayouts.pptx")
      return {
        target: { selection: { kind: "object", page: 1, index: 0 } },
        change: {
          type: "insert-slide-text",
          page: 1,
          object: 0,
          x: 1000,
          y: 1000,
          width: 10000,
          height: 2000,
          text: marker,
        },
      };
    if (!target)
      throw new Error("No editable text or movable object in slide sample");
    const { page, index: object, path, cell } = target.selection;
    return {
      target,
      change: text
        ? {
            type: "set-object-text",
            page,
            object,
            ...(path ? { path } : {}),
            ...(cell ? { cell } : {}),
            text: marker + target.text,
          }
        : {
            type: "move-object",
            page,
            object,
            ...(path ? { path } : {}),
            x: target.bounds.x + 100,
            y: target.bounds.y + 100,
          },
    };
  }
  // Use a named source cell for the pivot fixture, never its derived Sheet3!A3 output.
  const pivot = sample.id.includes("PivotTable_");
  const sheet = pivot ? "Sheet1" : snapshot.sheets[0];
  const address = pivot ? "A2" : "Z50";
  if (!snapshot.sheets.includes(sheet))
    throw new Error(`Missing fixture sheet: ${sheet}`);
  const current = snapshot.targets.find(
    (target) =>
      target.selection.sheet === sheet && target.selection.range === address,
  );
  const value = pivot ? Number(current?.text) + 1 : marker;
  if (pivot && !Number.isFinite(value))
    throw Error("Pivot source fixture must be numeric");
  return {
    target: { selection: { kind: "cells", sheet, range: address } },
    change: {
      type: "set-cells",
      sheet,
      column: pivot ? 1 : 26,
      row: pivot ? 2 : 50,
      values: [[value]],
    },
  };
}
function assertEdit(snapshot, target, change) {
  const actual = snapshot.targets.find(
    (value) =>
      JSON.stringify(value.selection) === JSON.stringify(target.selection),
  );
  // Native JSON objects are key-sorted; compare selection identity without relying on key order.
  const matches = (value) =>
    Object.entries(target.selection).every(
      ([key, expected]) =>
        (target.selection.kind === "paragraph" &&
          (key === "start" || key === "end")) ||
        JSON.stringify(value.selection[key]) === JSON.stringify(expected),
    );
  const edited = actual ?? snapshot.targets.find(matches);
  if (change.type === "move-object") {
    if (
      !edited?.bounds ||
      Math.abs(edited.bounds.x - change.x) > 1 ||
      Math.abs(edited.bounds.y - change.y) > 1
    )
      throw new Error("Object position did not survive the native operation");
  } else if (
    change.type === "set-cells" &&
    typeof change.values[0][0] === "number"
  ) {
    if (Number(edited?.text) !== change.values[0][0])
      throw Error("Numeric source edit was not preserved");
  } else if (!edited?.text.includes(marker))
    throw new Error(
      "Edited content is missing from the selected native target",
    );
}
try {
  for (const sample of source.samples.filter(
    (sample) => !args.sample || sample.id === args.sample,
  )) {
    const directory = join(out, sample.id.replaceAll("/", "_"));
    await mkdir(directory, { recursive: true });
    const row = {
      id: sample.id,
      format: sample.format,
      nativeFlowPassed: false,
      compatibilityAccepted: false,
    };
    const snapshots = {};
    try {
      let start = performance.now();
      const snapshot = await request("open", {
        path: join(corpus, sample.id),
        format: sample.format,
      });
      snapshots.original = snapshot;
      row.openMs = performance.now() - start;
      const { target, change } = planEdit(sample, snapshot);
      row.selection = target.selection;
      row.change = change;
      if (sample.id.includes("PivotTable_")) {
        const derived = snapshot.targets.find(
          (value) => value.editable === false,
        );
        if (!derived)
          throw new Error("Pivot output was not identified as read-only");
        let blocked = false;
        try {
          await request("apply", {
            change: {
              type: "set-cells",
              sheet: "Sheet3",
              column: 1,
              row: 3,
              values: [[marker]],
            },
          });
        } catch (error) {
          blocked = String(error).includes("Pivot result cells are derived");
        }
        if (!blocked) throw new Error("Pivot output edit was not rejected");
        row.pivotOutputProtected = true;
      }
      start = performance.now();
      await request("apply", { change });
      row.operationAckMs = performance.now() - start;
      const changed = await request("snapshot");
      snapshots.changed = changed;
      row.snapshotMs = performance.now() - start;
      assertEdit(changed, target, change);
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
      snapshots.reopened = reopened;
      assertEdit(reopened, target, change);
      await request("render", { path: join(directory, "reopened.pdf") });
      row.nativeFlowPassed = true;
      row.targetCountBefore = snapshot.targets.length;
      row.targetCountAfter = reopened.targets.length;
      row.warnings = reopened.warnings;
    } catch (error) {
      row.error = String(error);
    } finally {
      await writeFile(
        join(directory, "snapshots.json"),
        JSON.stringify(snapshots, null, 2),
      );
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
          executionCommit: process.env.GITHUB_SHA,
          expectedSamples: source.samples.length,
          sourceCommit: source.sourceCommit,
          ...(args.sample ? { focusedSample: args.sample } : {}),
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
if (
  measurements.length !== source.samples.length ||
  measurements.some((sample) => !sample.nativeFlowPassed)
)
  process.exitCode = 1;
