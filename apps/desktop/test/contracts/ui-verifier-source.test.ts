import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, test } from "vitest";

const roots: string[] = [];
const helper = pathToFileURL(
  join(process.cwd(), "scripts/verify/ui/verifier-source.mjs"),
).href;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "artemis-verifier-source-"));
  roots.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
  git("init", "--quiet");
  writeFileSync(join(root, "source.txt"), "original");
  git("add", "source.txt");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  return root;
}

function run(root: string, code: string) {
  return execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { captureVerifierSource, assertVerifierSourceUnchanged } from ${JSON.stringify(helper)}; const root = ${JSON.stringify(root)}; ${code}`,
    ],
    { encoding: "utf8" },
  ).trim();
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test("keeps clean exact-head verification as the default", () => {
  const result = JSON.parse(
    run(
      fixture(),
      "const source = captureVerifierSource(root); assertVerifierSourceUnchanged(root, source); console.log(JSON.stringify(source));",
    ),
  );
  expect(result.mode).toBe("exact-head");
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(result.status).toBe("");
});

test("rejects uncommitted source without the explicit working-tree mode", () => {
  const root = fixture();
  writeFileSync(join(root, "source.txt"), "edited");
  expect(
    run(
      root,
      "try { captureVerifierSource(root); console.log('accepted'); } catch { console.log('rejected'); }",
    ),
  ).toBe("rejected");
});

test("fingerprints local content and rejects edits even when git status is unchanged", () => {
  const root = fixture();
  writeFileSync(join(root, "source.txt"), "first edit");
  expect(
    run(
      root,
      "import { writeFileSync } from 'node:fs'; import { join } from 'node:path'; const source = captureVerifierSource(root, true); assertVerifierSourceUnchanged(root, source); writeFileSync(join(root, 'source.txt'), 'second edit'); try { assertVerifierSourceUnchanged(root, source); console.log('accepted'); } catch { console.log('rejected'); }",
    ),
  ).toBe("rejected");
});

test("includes untracked source in the local fingerprint", () => {
  const root = fixture();
  expect(
    run(
      root,
      "import { writeFileSync } from 'node:fs'; import { join } from 'node:path'; const source = captureVerifierSource(root, true); writeFileSync(join(root, 'new.txt'), 'new source'); try { assertVerifierSourceUnchanged(root, source); console.log('accepted'); } catch { console.log('rejected'); }",
    ),
  ).toBe("rejected");
});
