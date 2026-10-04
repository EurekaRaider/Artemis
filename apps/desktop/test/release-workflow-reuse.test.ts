import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { expect, it } from "vitest";
const workflow = load(
  readFileSync(
    new URL("../../../.github/workflows/release.yml", import.meta.url),
    "utf8",
  ),
) as any;
it("publishes only after fresh exact-head CI and both platform verifications", () => {
  expect(workflow.jobs.ci.needs).toBe("prepare");
  expect(workflow.jobs.ci.if).toBeUndefined();
  expect(workflow.jobs["sign-macos"].needs).toContain("ci");
  expect(workflow.jobs["package-windows"].needs).toContain("ci");
  expect(workflow.jobs.publish.needs).toEqual([
    "package-macos",
    "package-windows",
  ]);
  expect(workflow.jobs.publish.if).toBeUndefined();
  expect(workflow.jobs.prepare.if).toBe("github.ref == 'refs/heads/main'");
  expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual([
    "release_tag",
  ]);
});
it("passes intermediate artifacts through Actions instead of source releases", () => {
  expect(
    workflow.jobs["sign-macos"].steps.some((step: any) =>
      step.uses?.startsWith("actions/upload-artifact"),
    ),
  ).toBe(true);
  expect(
    workflow.jobs["package-macos"].steps.some((step: any) =>
      step.uses?.startsWith("actions/download-artifact"),
    ),
  ).toBe(true);
  for (const [id, job] of Object.entries<any>(workflow.jobs)) {
    if (id === "publish") continue;
    for (const step of job.steps ?? [])
      expect(step.run ?? "").not.toMatch(
        /gh release (upload|create|download)/u,
      );
  }
});
