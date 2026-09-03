import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { verifyUiPerformance } from "../../../scripts/verify-ui-performance.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(appDirectory, "..", "..");
const requestedOutput =
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
  process.env.ARTEMIS_VISUAL_CONVERGENCE_OUTPUT;
const outputDirectory = requestedOutput
  ? resolve(requestedOutput)
  : await mkdtemp(join(tmpdir(), "artemis-visual-convergence-"));
const budget = JSON.parse(
  await readFile(
    join(repositoryRoot, "scripts/ui-performance-budget.json"),
    "utf8",
  ),
);

function runGit(arguments_) {
  const result = spawnSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Visual convergence verifier could not run git ${arguments_.join(" ")}: ${result.error?.message ?? result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function outputTail(value, maximum = 12_000) {
  if (!value) return "";
  return value.length <= maximum ? value : value.slice(-maximum);
}

const candidateHead = runGit(["rev-parse", "HEAD"]);
const expectedHead = process.env.ARTEMIS_EXPECTED_HEAD?.trim() || candidateHead;
assert(
  /^[0-9a-f]{40}$/u.test(candidateHead) && expectedHead === candidateHead,
  `Visual convergence expected HEAD ${expectedHead} does not match candidate ${candidateHead}.`,
);
const initialStatus = runGit(["status", "--porcelain"]);
assert(
  initialStatus === "",
  `Visual convergence requires a clean exact-head worktree:\n${initialStatus}`,
);

await mkdir(outputDirectory, { recursive: true });
const reportPath = join(outputDirectory, "visual-convergence-audit.json");
const report = {
  format: "artemis-visual-convergence-audit",
  version: 1,
  generatedAt: new Date().toISOString(),
  candidateHead,
  expectedHead,
  platform: process.platform,
  architecture: process.arch,
  status: "running",
  evidenceBoundary: {
    proves:
      "Production Electron renderer behavior, strict renderer sandboxing, isolated synthetic user data, the recorded UI state matrices, local bundle budgets, and locally built package boundaries on the named runner.",
    doesNotProve:
      "Code signing, notarization, Gatekeeper or SmartScreen, clean-install behavior, a native screen reader pass, real provider accounts, hardware-specific behavior beyond the named runner, or soak stability.",
    platformRule:
      "macOS arm64, macOS x64, and Windows x64 are separate CI evidence; no one runner stands in for another.",
  },
  workloads: [],
};

const workloads = [
  {
    id: "screenshot-matrix",
    budget: "screenshot-matrix",
    script: "capture-screenshot-matrix.mjs",
  },
  {
    id: "conversation-timeline",
    budget: "conversation-timeline",
    script: "verify-conversation-timeline.mjs",
  },
  {
    id: "feedback-and-composer",
    budget: "feedback-and-composer",
    script: "verify-feedback-layout.mjs",
  },
  {
    id: "large-diff-and-environment",
    budget: "large-diff-and-environment",
    script: "verify-environment-panel-responsive.mjs",
  },
  {
    id: "terminal-and-browser",
    budget: "terminal-and-browser",
    script: "verify-workspace-dock.mjs",
  },
  {
    id: "form-controls",
    budget: "form-controls",
    script: "verify-form-controls.mjs",
  },
  {
    id: "navigation-controls",
    budget: "navigation-controls",
    script: "verify-navigation-controls.mjs",
  },
  {
    id: "resource-center-mcp",
    budget: "resource-center-mcp",
    script: "verify-mcp-editor.mjs",
  },
  {
    id: "secondary-pages",
    budget: "secondary-pages",
    script: "verify-secondary-pages.mjs",
  },
  {
    id: "goal-parity",
    budget: "goal-parity",
    script: "verify-goal-parity.mjs",
  },
  ...(process.platform === "darwin"
    ? [
        {
          id: "desktop-skin-gallery-package",
          budget: "desktop-skin-gallery-package",
          script: "verify-desktop-skin.mjs",
        },
      ]
    : []),
];

function verifyCandidateUnchanged(workloadId) {
  const actualHead = runGit(["rev-parse", "HEAD"]);
  const actualStatus = runGit(["status", "--porcelain"]);
  assert(
    actualHead === candidateHead && actualStatus === initialStatus,
    `${workloadId} changed the candidate worktree: HEAD ${actualHead}; status ${JSON.stringify(actualStatus)}.`,
  );
}

async function runWorkload(workload) {
  const maximumMs = budget.thresholds.workloadWallClockMs[workload.budget];
  assert(
    Number.isFinite(maximumMs),
    `No wall-clock budget is registered for ${workload.id}.`,
  );
  const workloadOutput = join(outputDirectory, workload.id);
  await mkdir(workloadOutput, { recursive: true });
  const startedAt = performance.now();
  const result = spawnSync(
    process.execPath,
    [join(scriptDirectory, workload.script), workloadOutput],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ARTEMIS_EXPECTED_HEAD: candidateHead,
      },
      maxBuffer: 40 * 1024 * 1024,
      timeout: maximumMs,
    },
  );
  const durationMs = performance.now() - startedAt;
  const entry = {
    id: workload.id,
    script: workload.script,
    maximumMs,
    durationMs: Number(durationMs.toFixed(1)),
    status: result.error || result.status !== 0 ? "failed" : "passed",
    exitStatus: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
    stdoutTail: outputTail(result.stdout),
    stderrTail: outputTail(result.stderr),
    outputDirectory: workload.id,
  };
  report.workloads.push(entry);
  assert(
    !result.error && result.status === 0,
    [
      `${workload.id} failed after ${entry.durationMs}ms.`,
      result.error?.message,
      result.stdout,
      result.stderr,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  assert(
    durationMs <= maximumMs,
    `${workload.id} took ${entry.durationMs}ms; maximum ${String(maximumMs)}ms.`,
  );
  verifyCandidateUnchanged(workload.id);
}

try {
  for (const workload of workloads) await runWorkload(workload);
  report.performance = await verifyUiPerformance(
    repositoryRoot,
    join(outputDirectory, "screenshot-matrix", "manifest.json"),
  );
  verifyCandidateUnchanged("UI performance verification");
  report.completedAt = new Date().toISOString();
  report.status = "passed";
  await writeFile(reportPath, `${JSON.stringify(report, undefined, 2)}\n`);
  console.log(reportPath);
} catch (error) {
  report.completedAt = new Date().toISOString();
  report.status = "failed";
  report.failure = error instanceof Error ? error.stack : String(error);
  await writeFile(reportPath, `${JSON.stringify(report, undefined, 2)}\n`);
  throw error;
}
