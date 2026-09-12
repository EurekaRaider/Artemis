import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";

it("waits for the Review action before clicking and checking its Select", async () => {
  const main = readFileSync(
    new URL("../src/main/main.ts", import.meta.url),
    "utf8",
  );
  const start = main.indexOf("if (view === 'turn-changes-form-controls') {");
  const end = main.indexOf("if (view === 'turn-changes-open')", start);
  let queries = 0;
  let now = 0;
  let opened = false;
  class Button {
    disabled = false;
    click = vi.fn(() => {
      opened = true;
    });
    closest = () => ({});
  }
  const button = new Button();
  const trigger = new Button();
  const querySelector = vi.fn((selector: string) => {
    if (selector === ".turn-change-actions button:last-child")
      return ++queries >= 3 ? button : null;
    return opened ? trigger : null;
  });
  const run = new Function(
    "document",
    "wait",
    "HTMLButtonElement",
    "Date",
    "view",
    `return (async () => { ${main.slice(start, end)} })()`,
  );
  await run(
    { querySelector },
    async () => {},
    Button,
    { now: () => (now += 100) },
    "turn-changes-form-controls",
  );
  expect(queries).toBe(3);
  expect(button.click).toHaveBeenCalledOnce();
});
