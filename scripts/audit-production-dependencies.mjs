import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const maximumAttempts = 3;
const fetchTimeoutMs = 30_000;

export const auditArguments = [
  "audit",
  "--omit=dev",
  "--audit-level=high",
  "--json",
  "--fetch-retries=0",
  `--fetch-timeout=${String(fetchTimeoutMs)}`,
];

function parseAuditReport(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

export function classifyAuditResult(result) {
  const report = parseAuditReport(result.stdout ?? "");
  if (report?.auditReportVersion !== undefined) {
    return result.status === 0 ? "passed" : "audit-failure";
  }
  return "retryable-error";
}

function failureMessage(result) {
  const report = parseAuditReport(result.stdout ?? "");
  return (
    report?.message ??
    result.error?.message ??
    result.stderr?.trim() ??
    `npm audit exited with status ${String(result.status)}`
  );
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function runProductionAudit({
  attempts = maximumAttempts,
  command = process.platform === "win32" ? "npm.cmd" : "npm",
  run = spawnSync,
  wait = delay,
  writeStderr = (value) => process.stderr.write(value),
  writeStdout = (value) => process.stdout.write(value),
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = run(command, auditArguments, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: fetchTimeoutMs + 15_000,
    });
    const classification = classifyAuditResult(result);
    if (classification === "passed") {
      writeStdout(result.stdout);
      return 0;
    }
    if (classification === "audit-failure") {
      writeStdout(result.stdout);
      writeStderr(result.stderr ?? "");
      return result.status ?? 1;
    }

    writeStderr(
      `Production dependency audit attempt ${String(attempt)}/${String(attempts)} failed before receiving an audit report: ${failureMessage(result)}\n`,
    );
    if (attempt < attempts) {
      await wait(attempt * 1_000);
      continue;
    }
    writeStdout(result.stdout ?? "");
    writeStderr(result.stderr ?? "");
  }
  return 1;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runProductionAudit();
}
