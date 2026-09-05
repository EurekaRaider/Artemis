import { readFileSync } from "node:fs";
import { SEMANTIC_TOKEN_REGISTRY } from "@artemis/theme-contract";
import { expect, it } from "vitest";

it("resolves every public component CSS token through the theme registry", () => {
  const css = readFileSync(
    new URL("../src/styles.css", import.meta.url),
    "utf8",
  );
  const registered = new Set<string>(
    Object.values(SEMANTIC_TOKEN_REGISTRY).map((token) => token.cssVariable),
  );
  const consumed = new Set(
    [...css.matchAll(/var\(\s*(--artemis-[a-z0-9-]+)/gu)].map(
      (match) => match[1]!,
    ),
  );
  expect(
    [...consumed].filter((token) => !registered.has(token)).sort(),
  ).toEqual([]);
});
