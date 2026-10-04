import { expect, it, vi } from "vitest";
import { BoundedStateCache } from "../../../src/renderer/app/bounded-state-cache.js";
it("evicts by retained bytes even below the entry limit", () => {
  const evict = vi.fn();
  const cache = new BoundedStateCache<string>(evict, 8, 100);
  cache.set("a", "x".repeat(20));
  cache.set("b", "y".repeat(20));
  expect([...cache.keys()]).toEqual(["b"]);
  expect(evict).toHaveBeenCalledWith("a");
  expect(cache.estimatedBytes).toBeLessThanOrEqual(100);
  cache.set("large", "z".repeat(100));
  expect(cache.has("large")).toBe(false);
});
it("bounds entries and accounts for replacement and deletion", () => {
  const cache = new BoundedStateCache<object>(() => {}, 2);
  const shared = { text: "unchanged" };
  cache.set("a", { shared });
  cache.set("b", { shared });
  cache.set("a", { shared, text: "updated" });
  cache.set("c", { shared });
  expect([...cache.keys()]).toEqual(["a", "c"]);
  cache.delete("a");
  cache.clear();
  expect(cache.estimatedBytes).toBe(0);
});
