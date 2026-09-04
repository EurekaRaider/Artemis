import assert from "node:assert/strict";

import {
  auditArguments,
  classifyAuditResult,
  runProductionAudit,
} from "./audit-production-dependencies.mjs";

const cleanReport = JSON.stringify({
  auditReportVersion: 2,
  metadata: { vulnerabilities: { high: 0, critical: 0 } },
});
const vulnerableReport = JSON.stringify({
  auditReportVersion: 2,
  metadata: { vulnerabilities: { high: 1, critical: 0 } },
});
const networkError = JSON.stringify({
  message: "network timeout",
  uri: "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk",
});

assert.deepEqual(auditArguments, [
  "audit",
  "--omit=dev",
  "--audit-level=high",
  "--json",
  "--fetch-retries=0",
  "--fetch-timeout=30000",
]);
assert.equal(classifyAuditResult({ status: 0, stdout: cleanReport }), "passed");
assert.equal(
  classifyAuditResult({ status: 1, stdout: vulnerableReport }),
  "audit-failure",
);
assert.equal(
  classifyAuditResult({ status: 1, stdout: networkError }),
  "retryable-error",
);
assert.equal(classifyAuditResult({ status: 0, stdout: "" }), "retryable-error");

async function runFixture(results) {
  let calls = 0;
  const stderr = [];
  const stdout = [];
  const status = await runProductionAudit({
    run: (_command, arguments_, options) => {
      calls += 1;
      assert.deepEqual(arguments_, auditArguments);
      assert.equal(options.timeout, 45_000);
      return results[Math.min(calls - 1, results.length - 1)];
    },
    wait: async () => {},
    writeStderr: (value) => stderr.push(value),
    writeStdout: (value) => stdout.push(value),
  });
  return { calls, status, stderr: stderr.join(""), stdout: stdout.join("") };
}

const recovered = await runFixture([
  { status: 1, stdout: networkError, stderr: "" },
  { status: 0, stdout: cleanReport, stderr: "" },
]);
assert.equal(recovered.status, 0);
assert.equal(recovered.calls, 2);
assert.match(recovered.stderr, /attempt 1\/3/u);

const vulnerable = await runFixture([
  { status: 1, stdout: vulnerableReport, stderr: "high vulnerability" },
]);
assert.equal(vulnerable.status, 1);
assert.equal(vulnerable.calls, 1);
assert.match(vulnerable.stdout, /auditReportVersion/u);

const unavailable = await runFixture([
  { status: 1, stdout: networkError, stderr: "registry unavailable" },
]);
assert.equal(unavailable.status, 1);
assert.equal(unavailable.calls, 3);
assert.match(unavailable.stderr, /attempt 3\/3/u);

console.log(
  "Production dependency audit fixtures passed (retry recovery, vulnerability failure, fail-closed outage)",
);
