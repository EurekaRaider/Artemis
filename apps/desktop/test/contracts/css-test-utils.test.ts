import { describe, expect, it } from "vitest";

import { findCssDeclarations } from "./css-test-utils.js";

describe("CSS declaration contracts", () => {
  it("resolves native nesting and retains declaration order", () => {
    const source = `
      .app-shell {
        .control { color: red; }
        & > .control { padding: 4px; }
        .panel { & .control { min-inline-size: 0; } }
        .control { color: blue; }
      }
    `;
    expect(findCssDeclarations(source, ".app-shell .control")).toBe(
      "color: red;\ncolor: blue;",
    );
    expect(findCssDeclarations(source, ".app-shell > .control")).toBe(
      "padding: 4px;",
    );
    expect(findCssDeclarations(source, ".app-shell .panel .control")).toBe(
      "min-inline-size: 0;",
    );
  });

  it("preserves a parent selector list's maximum specificity", () => {
    expect(
      findCssDeclarations(
        ".panel, #dialog { & .control { color: red; } }",
        ":is(.panel, #dialog) .control",
      ),
    ).toBe("color: red;");
  });

  it("reads layer nesting but excludes nested media and container overrides", () => {
    const source = `
      @layer app {
        .panel {
          & .control { color: red; }
          @media (max-width: 800px) { & .control { color: blue; } }
          @container (max-width: 400px) { & .control { color: green; } }
        }
      }
    `;
    expect(findCssDeclarations(source, ".panel .control")).toBe("color: red;");
  });
});
