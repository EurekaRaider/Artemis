import { readDesktopStyles } from "../fixtures/application/styles-source.js";
import { readSharedApiSources } from "../fixtures/application/api-source.js";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "@artemis/protocol";
import { uiText, UI_RESOURCES } from "../../src/shared/i18n/ui-text.js";
import { findCssDeclarations } from "./css-test-utils.js";
const source = (path: string) =>
  readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
const styles = readDesktopStyles("styles");
const nocturne = readDesktopStyles("nocturne");
describe("Nocturne sixth review contracts", () => {
  it("never reintroduces diff row foreground colors for add/delete or inherited line numbers", () => {
    for (const selector of [".review-line.addition", ".review-line.deletion"]) {
      expect(findCssDeclarations(styles, selector)).not.toMatch(
        /(?:^|\n)color:/,
      );
    }
    expect(styles).not.toContain(
      ".review-line:is(.addition, .deletion) .review-line-number",
    );
    expect(
      findCssDeclarations(
        styles,
        '.review-line.addition > [data-part="marker"]',
      ),
    ).toContain("color: var(--success)");
    expect(
      findCssDeclarations(
        styles,
        '.review-line.deletion > [data-part="marker"]',
      ),
    ).toContain("color: var(--danger)");
  });
  it("has a single objective rule and preserves status colors without duplicate foreground overrides", () => {
    const rules: string[] = [];
    for (const file of [
      styles,
      nocturne,
      readDesktopStyles("prototype-migration"),
    ])
      postcss.parse(file).walkRules((rule) => {
        if (rule.selector.includes(".goal-bar-objective"))
          rules.push(rule.selector);
      });
    expect(rules).toEqual([".goal-bar-objective"]);
    expect(findCssDeclarations(nocturne, ".goal-bar-objective")).toContain(
      "font-size: 13px",
    );
    expect(nocturne).not.toContain(
      ".environment-pr-icon svg {\n    color: var(--muted)",
    );
  });
  it("keeps slash artwork monochrome and uses composer mode glyphs", () => {
    const artwork = source("renderer/components/CommandArtwork.tsx");
    expect(artwork).not.toMatch(/linearGradient|ResourceArtwork|stopColor/);
    for (const name of ["target", "plan", "work", "code"])
      expect(artwork).toContain(`"${name}"`);
    const heading = findCssDeclarations(styles, ".slash-command-heading");
    expect(heading).not.toMatch(/text-transform:|letter-spacing:/);
  });
  it("localizes every new key and interpolates counts in all fourteen locales", () => {
    const keys = Object.keys(UI_RESOURCES.en).filter((key) =>
      key.startsWith("Review06."),
    ) as Array<keyof typeof UI_RESOURCES.en>;
    expect(APP_LOCALES).toHaveLength(14);
    for (const locale of APP_LOCALES) {
      for (const key of keys)
        expect(uiText(locale, key), `${locale}:${key}`).toBeTruthy();
      expect(uiText(locale, "Review06.selectedCount", { count: 2 })).toContain(
        "2",
      );
      expect(
        uiText(locale, "Review06.bulkDeleteConfirm", { count: 2 }),
      ).not.toContain("{count}");
    }
    for (const locale of ["zh-CN", "zh-TW"] as const)
      for (const [key, value] of Object.entries(UI_RESOURCES[locale])) {
        expect(value, `${locale}:${key}`).not.toMatch(
          /\b(?:Agents?|Skills?|Plugins?|Workspace)\b/,
        );
      }
    expect(uiText("zh-CN", "App_copy.askApproval")).toBe("每次都问我");
    expect(uiText("zh-CN", "App_copy.agentApproval")).toBe("替我审批");
  });
  it("keeps manual instruction IPC narrow and does not add execution or path arguments", () => {
    const api = readSharedApiSources();
    expect(api).toContain(
      "readProjectInstructions(projectId: string): Promise<string>",
    );
    expect(api).toContain(
      "writeProjectInstructions(projectId: string, content: string): Promise<void>",
    );
    const backend = source("main/workspace/project-instructions.ts");
    expect(backend).not.toMatch(/child_process|PiAdapter|Mcp|spawn\(/);
  });
});
