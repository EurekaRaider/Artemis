import { expect, it } from "vitest";
import { CodemodeWorkerPool } from "../../src/runtime/codemode-workers.js";

it("retains cancelled workers until actual release and waits without polling", async () => {
  const pool = new CodemodeWorkerPool(() => 4);
  const releases = await Promise.all(
    Array.from({ length: 6 }, () => pool.acquire()),
  );
  expect(pool.snapshot).toEqual({ active: 6, queued: 0 });
  let admitted = false;
  const next = pool.acquire().then((release) => {
    admitted = true;
    return release;
  });
  await Promise.resolve();
  expect(admitted).toBe(false);
  releases[0]!();
  const release = await next;
  expect(admitted).toBe(true);
  releases[0]!();
  expect(pool.snapshot.active).toBe(6);
  release();
  releases.forEach((done) => done());
  expect(pool.snapshot.active).toBe(0);
});

it("expands capacity for waiting supervisors and live preference changes", async () => {
  let capacity = 1;
  const pool = new CodemodeWorkerPool(() => capacity);
  const releases = await Promise.all(
    Array.from({ length: 3 }, () => pool.acquire()),
  );
  const waiting = pool.acquire();
  expect(pool.snapshot.queued).toBe(1);
  capacity = 2;
  pool.refresh();
  releases.push(await waiting);
  expect(pool.snapshot).toEqual({ active: 4, queued: 0 });
  releases.forEach((done) => done());
});

it("cancels queued scripts before execution and rejects admission after disposal", async () => {
  const pool = new CodemodeWorkerPool(() => 1);
  const releases = await Promise.all(
    Array.from({ length: 3 }, () => pool.acquire()),
  );
  const controller = new AbortController();
  const cancelled = pool.acquire(controller.signal);
  controller.abort(new Error("Cancelled before worker start"));
  await expect(cancelled).rejects.toThrow("Cancelled before worker start");
  const waiting = pool.acquire();
  pool.dispose();
  await expect(waiting).rejects.toThrow("host is closed");
  await expect(pool.acquire()).rejects.toThrow("host is closed");
  releases.forEach((done) => done());
  expect(pool.snapshot).toEqual({ active: 0, queued: 0 });
});
