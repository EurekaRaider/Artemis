import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { load } from "js-yaml";
import { selectVisualConvergenceWorkloads } from "../../apps/desktop/scripts/verify/ui/visual-convergence-workloads.mjs";
import {
  mainPushUpdate,
  isReadmeOnlyChange,
  verifyPrePush,
} from "./verify-pre-push.mjs";

const head = "a".repeat(40);
test("macOS visual shards cover every workload exactly once", () => {
  const expected = [
    "screenshot-matrix",
    "conversation-timeline",
    "feedback-and-composer",
    "large-diff-and-environment",
    "terminal-and-browser",
    "form-controls",
    "navigation-controls",
    "resource-center-mcp",
    "secondary-pages",
    "goal-parity",
    "desktop-skin-gallery-package",
  ];
  const complete = selectVisualConvergenceWorkloads("darwin");
  assert.deepEqual(
    complete.workloads.map(({ id }) => id),
    expected,
  );
  assert.equal(complete.shard, undefined);
  const selected = [1, 2, 3].flatMap((index) => {
    const result = selectVisualConvergenceWorkloads(
      "darwin",
      `--shard=${index}/3`,
    );
    assert.deepEqual(result.shard, { index, count: 3, totalWorkloads: 11 });
    return result.workloads;
  });
  assert.deepEqual(selected.map(({ id }) => id).sort(), [...expected].sort());
  for (const workload of selected) {
    assert.deepEqual(
      workload,
      complete.workloads.find(({ id }) => id === workload.id),
    );
  }
  assert.deepEqual(
    selectVisualConvergenceWorkloads("win32").workloads,
    complete.workloads.slice(0, -1),
  );
  for (const argument of [
    "--shard",
    "--shard=0/3",
    "--shard=4/3",
    "--shard=1/2",
  ]) {
    assert.throws(() => selectVisualConvergenceWorkloads("darwin", argument));
  }
  assert.throws(() => selectVisualConvergenceWorkloads("win32", "--shard=1/3"));
});
test("macOS visual acceptance rejects failed, cancelled or skipped shards", () => {
  const workflow = load(
    readFileSync(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    ),
  );
  const shards = workflow.jobs["macos-visual-shards"];
  assert.deepEqual(shards.strategy.matrix.shard, [1, 2, 3]);
  assert.equal(shards.strategy["fail-fast"], false);
  assert.equal(shards["continue-on-error"], undefined);
  assert.equal(shards["runs-on"], "macos-15");
  assert.equal(shards.needs, "verify");
  assert.equal(shards.if, "${{ !inputs.hooks_only }}");
  assert(shards.steps.some((step) => step.with?.ref === "${{ github.sha }}"));
  const execution = shards.steps.find((step) => step.run?.includes("--shard="));
  assert.equal(
    execution.run,
    "npm run verify:visual-convergence -- --shard=${{ matrix.shard }}/3",
  );
  assert.equal(execution.env.ARTEMIS_EXPECTED_HEAD, "${{ github.sha }}");
  assert.equal(execution["continue-on-error"], undefined);
  const gate = workflow.jobs["macos-visual-acceptance"];
  assert.equal(gate.name, "Visual convergence (macos-arm64)");
  assert.equal(gate["runs-on"], "windows-2025");
  assert.deepEqual(gate.needs, ["macos-visual-shards"]);
  assert.equal(gate.if, "${{ !inputs.hooks_only && always() }}");
  const verdict = /^node -e "(.+)"$/u.exec(gate.steps[0].run)?.[1];
  assert(verdict);
  assert.equal(
    gate.steps[0].env.ARTEMIS_VISUAL_SHARD_RESULT,
    "${{ needs.macos-visual-shards.result }}",
  );
  for (const result of ["success", "failure", "cancelled", "skipped", ""]) {
    assert.equal(
      spawnSync(process.execPath, ["-e", verdict], {
        env: { ...process.env, ARTEMIS_VISUAL_SHARD_RESULT: result },
      }).status === 0,
      result === "success",
    );
  }
  assert.deepEqual(
    workflow.jobs["visual-convergence-electron"].strategy.matrix.include.map(
      ({ platform }) => platform,
    ),
    ["windows-x64"],
  );
});
test("Intel CI uses native runners and requires every isolated test shard", () => {
  const workflow = load(
    readFileSync(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    ),
  );
  const shared = workflow.jobs["macos-x64-checks"];
  assert.equal(shared["runs-on"], "macos-15-intel");
  assert(
    shared.steps.some(
      (step) => step.run === "npm run verify:ci -- --shared-tests",
    ),
  );
  assert(
    shared.steps.some((step) => step.run?.includes("process.arch !== 'x64'")),
  );
  const desktop = workflow.jobs["macos-x64-desktop-tests"];
  assert.equal(desktop.needs, "macos-x64-checks");
  assert.deepEqual(desktop.strategy.matrix.shard, [1, 2]);
  assert.equal(desktop.strategy["fail-fast"], false);
  assert.equal(desktop["runs-on"], "macos-15-intel");
  assert(desktop.steps.some((step) => step.with?.ref === "${{ github.sha }}"));
  assert(desktop.steps.some((step) => step.run === "npm run build"));
  assert(
    desktop.steps.some(
      (step) =>
        step.run ===
        "npm run test -w @artemis/desktop -- --shard=${{ matrix.shard }}/2",
    ),
  );
  const visual = workflow.jobs["macos-x64-visual-shards"];
  assert.deepEqual(visual.strategy.matrix.shard, [1, 2, 3]);
  assert.equal(visual.strategy["fail-fast"], false);
  assert.equal(visual["runs-on"], "macos-15-intel");
  assert(visual.steps.some((step) => step.with?.ref === "${{ github.sha }}"));
  assert(
    visual.steps.some(
      (step) => step.env?.ARTEMIS_EXPECTED_HEAD === "${{ github.sha }}",
    ),
  );
  assert.equal(
    workflow.jobs["macos-x64-visual-acceptance"].name,
    "Visual convergence (macos-x64)",
  );
  assert.deepEqual(workflow.jobs["macos-x64-visual-acceptance"].needs, [
    "macos-x64-visual-shards",
  ]);
  const gate = workflow.jobs["macos-x64-acceptance"];
  assert.deepEqual(gate.needs, ["macos-x64-checks", "macos-x64-desktop-tests"]);
  assert.equal(gate.if, "${{ !inputs.hooks_only && always() }}");
  assert.equal(gate.name, "Test, typecheck, build and format (macos-x64)");
  const verdict = /^node -e "(.+)"$/u.exec(gate.steps[0].run)?.[1];
  assert(verdict);
  for (const sharedResult of ["success", "failure", "skipped", "cancelled"])
    for (const desktopResult of ["success", "failure", "skipped", "cancelled"])
      assert.equal(
        spawnSync(process.execPath, ["-e", verdict], {
          env: {
            ...process.env,
            SHARED_RESULT: sharedResult,
            DESKTOP_RESULT: desktopResult,
          },
        }).status === 0,
        sharedResult === "success" && desktopResult === "success",
      );
});
test("Release verifies both native macOS architectures and supports packaging without publication", () => {
  const workflow = load(
    readFileSync(
      new URL("../../.github/workflows/release.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.type, "boolean");
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, true);
  for (const jobName of ["sign-macos", "package-macos"]) {
    const job = workflow.jobs[jobName];
    assert.deepEqual(
      job.strategy.matrix.include.map(({ arch, runner, macho_arch }) => [
        arch,
        runner,
        macho_arch,
      ]),
      [
        ["arm64", "macos-15", "arm64"],
        ["x64", "macos-15-intel", "x86_64"],
      ],
    );
    assert.equal(job.strategy["fail-fast"], false);
    assert(job.steps.some((step) => step.with?.ref === "${{ github.sha }}"));
  }
  assert(
    workflow.jobs["package-macos"].steps.some(
      (step) => step.run === "npm run verify:mac-native -w @artemis/desktop",
    ),
  );
  assert.deepEqual(workflow.jobs.collect.needs, [
    "package-macos",
    "package-windows",
  ]);
  assert(
    workflow.jobs.collect.steps.some((step) =>
      step.run?.includes("collect-release-assets.mjs"),
    ),
  );
  assert.equal(workflow.jobs.publish.needs, "collect");
  assert.equal(workflow.jobs.publish.if, "inputs.publish");
  for (const [name, job] of Object.entries(workflow.jobs))
    if (name !== "publish") assert.notEqual(job.permissions?.contents, "write");
});
test("native macOS package verification accepts Intel Mach-O architecture names", () => {
  const source = readFileSync(
    new URL(
      "../../apps/desktop/scripts/verify/native/verify-macos-native.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const check = source.slice(
    source.indexOf("const architectures = run("),
    source.indexOf("const temporaryRoot ="),
  );
  assert(check.includes("/usr/bin/lipo"));
  const verify = (arch, output) =>
    runInNewContext(check, {
      process: { arch },
      executablePath: "/Artemis.app/Contents/MacOS/Artemis",
      run: () => output,
    });
  assert.doesNotThrow(() => verify("x64", "x86_64\n"));
  assert.doesNotThrow(() => verify("arm64", "arm64\n"));
  assert.throws(() => verify("x64", "arm64\n"), /does not contain/u);
  assert.throws(() => verify("arm64", "x86_64\n"), /does not contain/u);
});
test("Windows CI keeps the full desktop suite across isolated shards", () => {
  const read = (path) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const workflow = load(read(".github/workflows/ci.yml"));
  const shards = workflow.jobs["windows-desktop-tests"];
  assert.deepEqual(
    shards.strategy.matrix.include.map((entry) => entry.shard),
    [1, 2, 3, 4],
  );
  assert.equal(shards.strategy["fail-fast"], false);
  assert.equal(shards["continue-on-error"], undefined);
  assert(shards.steps.some((step) => step.with?.ref === "${{ github.sha }}"));
  assert(shards.steps.some((step) => step.run === "npm run build"));
  assert(
    shards.steps.some(
      (step) =>
        step.run ===
        "npm run test -w @artemis/desktop -- --shard=${{ matrix.shard }}/4",
    ),
  );
  const scripts = JSON.parse(read("package.json")).scripts;
  assert.equal(
    scripts.test,
    "npm run test:shared && npm run test -w @artemis/desktop",
  );
  assert(
    JSON.parse(read("apps/desktop/package.json")).scripts.test.endsWith(
      "vitest run --no-file-parallelism",
    ),
  );
  const gate = workflow.jobs["windows-acceptance"];
  assert.equal(gate?.name, "Test, typecheck, build and format (windows-x64)");
  assert.deepEqual(gate.needs, ["verify", "windows-desktop-tests"]);
  assert.equal(gate.if, "${{ !inputs.hooks_only && always() }}");
  const verdict = gate.steps[0].run;
  for (const job of gate.needs)
    assert(verdict.includes(`'\${{ needs.${job}.result }}' -ne 'success'`));
  assert(verdict.includes("throw"));
});
test("only non-deletion main updates trigger the expensive check", () => {
  assert.deepEqual(
    mainPushUpdate(`refs/heads/main ${head} refs/heads/main ${"b".repeat(40)}`),
    { head, base: "b".repeat(40) },
  );
  assert.equal(
    mainPushUpdate(`refs/heads/topic ${head} refs/heads/topic ${head}`),
    undefined,
  );
  assert.equal(
    mainPushUpdate(`(delete) ${"0".repeat(40)} refs/heads/main ${head}`),
    undefined,
  );
  assert.equal(mainPushUpdate(""), undefined);
});

function harness({ dirty = false, fail, changed = false, paths = "" } = {}) {
  const calls = [],
    removed = [];
  let headReads = 0;
  const run = (command, args, cwd) => {
    const line = `${command} ${args.join(" ")}`;
    calls.push([line, cwd]);
    if (line.startsWith("git diff --name-only --no-renames -z ")) return paths;
    if (line === fail) throw new Error("validation failed");
    if (line === "git rev-parse HEAD")
      return changed && headReads++ > 0 ? "b".repeat(40) : head;
    if (line === "git status --porcelain") return dirty ? " M source.ts" : "";
    return "";
  };
  return {
    calls,
    removed,
    options: {
      head,
      root: "/source",
      run,
      env: {},
      temporary: () => "/isolated",
      remove: (path) => removed.push(path),
    },
  };
}

test("validates the exact commit with clean dependencies and both CI suites", () => {
  const h = harness();
  verifyPrePush(h.options);
  assert.deepEqual(
    h.calls.filter(([, cwd]) => cwd === "/isolated").map(([line]) => line),
    [
      `git checkout --quiet --detach ${head}`,
      "npm ci",
      "npm run verify:ci",
      "npm run verify:visual-convergence",
    ],
  );
  assert.deepEqual(h.removed, ["/isolated"]);
});

test("a failed gate blocks push and removes the temporary checkout", () => {
  const h = harness({ fail: "npm run verify:ci" });
  assert.throws(() => verifyPrePush(h.options), /validation failed/u);
  assert.equal(
    h.calls.some(([line]) => line === "npm run verify:visual-convergence"),
    false,
  );
  assert.deepEqual(h.removed, ["/isolated"]);
});

test("dirty or concurrently changed source cannot be certified", () => {
  const dirty = harness({ dirty: true });
  assert.throws(() => verifyPrePush(dirty.options), /Commit or stash/u);
  assert.equal(
    dirty.calls.some(([line]) => line === "npm ci"),
    false,
  );
  const changed = harness({ changed: true });
  assert.throws(
    () => verifyPrePush(changed.options),
    /changed during verification/u,
  );
});

test("README-only pushes skip gates, but mixed, empty and initial pushes do not", () => {
  assert.equal(isReadmeOnlyChange("README.md\0docs/README.md\0"), true);
  for (const paths of [
    "",
    "src/main.ts\0",
    "README.md\0src/main.ts\0",
    "README.md.js\0",
  ]) {
    assert.equal(isReadmeOnlyChange(paths), false);
  }
  const readme = harness({ paths: "README.md\0docs/README.md\0" });
  verifyPrePush({ ...readme.options, base: "b".repeat(40) });
  assert.equal(
    readme.calls.some(([line]) => line === "npm ci"),
    false,
  );
  for (const [paths, base] of [
    ["README.md\0src/main.ts\0", "b".repeat(40)],
    ["README.md\0old-code.ts\0", "b".repeat(40)],
    ["README.md\0", "0".repeat(40)],
    ["", "b".repeat(40)],
  ]) {
    const h = harness({ paths });
    verifyPrePush({ ...h.options, base });
    assert.equal(
      h.calls.some(([line]) => line === "npm run verify:ci"),
      true,
    );
  }
});
