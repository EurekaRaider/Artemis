import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { AppStore } from "../src/main/store.js";
const cleanups: Array<() => void> = [];
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((clean) => clean()),
);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "native-notification-"));
  const path = join(root, "state.sqlite");
  let store = new AppStore(path);
  cleanups.push(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const now = new Date().toISOString();
  for (const id of ["parent", "child", "other"])
    store.createThread({
      id,
      title: id,
      mode: "plan",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
  return {
    get store() {
      return store;
    },
    path,
    reopen() {
      store.close();
      store = new AppStore(path);
    },
  };
}
it("counts the actual IM task and clears its badge when that conversation is read", () => {
  const f = fixture();
  const group = f.store.appendEvent("assigned", "parent", undefined, {
    type: "im.group.activity",
    taskId: "child",
    phase: "assigned",
  });
  expect(f.store.notifications.observe(group, {})).toBeUndefined();
  const completed = f.store.appendEvent("done", "child", "turn", {
    type: "turn.completed",
    reason: "completed",
  });
  expect(f.store.notifications.observe(completed, {})?.state.unread).toBe(true);
  expect(f.store.notifications.countUnread()).toBe(1);
  f.store.notifications.markRead("child", completed.seq);
  expect(f.store.notifications.countUnread()).toBe(0);
  const summary = f.store.appendEvent("summary", "parent", undefined, {
    type: "im.group.activity",
    taskId: "child",
    phase: "completed",
  });
  expect(f.store.notifications.observe(summary, {})).toBeUndefined();
  expect(f.store.notifications.countUnread()).toBe(0);
});
it("retires legacy hidden group notices on restart without clearing other unread tasks", () => {
  const f = fixture();
  const other = f.store.appendEvent("other-done", "other", "turn", {
    type: "turn.completed",
    reason: "completed",
  });
  f.store.notifications.observe(other, {});
  const db = new DatabaseSync(f.path);
  db.prepare(
    "INSERT INTO task_notifications(thread_id,notice_key,seq,kind,unread) VALUES(?,?,?,?,1)",
  ).run("parent", "group:child:completed", 2, "completed");
  db.prepare(
    "INSERT INTO task_notification_revisions(thread_id,revision) VALUES(?,1)",
  ).run("parent");
  db.close();
  expect(f.store.notifications.countUnread()).toBe(2);
  f.reopen();
  expect(f.store.notifications.countUnread()).toBe(1);
  expect(f.store.notifications.state("parent")).toMatchObject({
    unread: false,
    revision: 2,
  });
  expect(f.store.notifications.state("other")?.unread).toBe(true);
  f.reopen();
  expect(f.store.notifications.state("parent")?.revision).toBe(2);
  f.store.notifications.markRead("other", other.seq);
  expect(f.store.notifications.countUnread()).toBe(0);
});
