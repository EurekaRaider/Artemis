import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";

const main = readFileSync(
  new URL("../src/main/main.ts", import.meta.url),
  "utf8",
);
const start = main.indexOf("const openSmokeHistoryThread = async (threadId)");
const end = main.indexOf("const clickByText", start);
const run = new Function(
  "document",
  "wait",
  "HTMLButtonElement",
  "Date",
  `${main.slice(start, end)} return openSmokeHistoryThread('fixture');`,
);

function fixture({ missing = false, stuck = false } = {}) {
  let now = 0;
  class Button {
    click = vi.fn();
  }
  const button = new Button();
  const unrelated = new Button();
  const document = {
    querySelector: vi.fn((selector: string) => {
      if (selector === ".thread-select") return unrelated;
      if (selector === '[data-tree-row-id="thread:fixture"] .thread-select')
        return !missing && now >= 200 ? button : null;
      if (selector === ".conversation-history-feedback")
        return stuck || now < 12_000
          ? { textContent: "Loading history" }
          : null;
      if (selector === ".timeline .user-message")
        return button.click.mock.calls.length > 0 && now >= 12_000 ? {} : null;
      return null;
    }),
  };
  return {
    button,
    unrelated,
    elapsed: () => now,
    run: () =>
      run(
        document,
        async (milliseconds: number) => {
          now += milliseconds;
        },
        Button,
        { now: () => now },
      ),
  };
}

it("selects the exact fixture once and waits for delayed history before actions", async () => {
  const test = fixture();
  await test.run();
  expect(test.elapsed()).toBe(12_000);
  expect(test.button.click).toHaveBeenCalledOnce();
  expect(test.unrelated.click).not.toHaveBeenCalled();
});

it("fails with loading diagnostics when history never becomes ready", async () => {
  const test = fixture({ stuck: true });
  await expect(test.run()).rejects.toThrow(
    "Smoke history did not load for fixture: selected=true; feedback=Loading history",
  );
  expect(test.elapsed()).toBe(30_000);
  expect(test.button.click).toHaveBeenCalledOnce();
});

it("does not substitute an unrelated task when the fixture is absent", async () => {
  const test = fixture({ missing: true });
  await expect(test.run()).rejects.toThrow("selected=false");
  expect(test.unrelated.click).not.toHaveBeenCalled();
});
