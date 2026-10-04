import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mainPushUpdate,
  isReadmeOnlyChange,
  verifyPrePush,
} from "./verify-pre-push.mjs";

const head = "a".repeat(40);
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
