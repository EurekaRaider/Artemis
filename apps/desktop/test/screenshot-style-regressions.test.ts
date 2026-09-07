import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const desktop = postcss.parse(
  readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
);
const shared = postcss.parse(
  readFileSync(
    new URL("../../../packages/ui/src/styles.css", import.meta.url),
    "utf8",
  ),
);
function declarations(sheet: postcss.Root, selector: string) {
  const result: Record<string, string> = {};
  sheet.walkRules((rule) => {
    if (
      rule.parent?.type === "atrule" &&
      (rule.parent as postcss.AtRule).name === "media"
    )
      return;
    if (
      rule.selectors.some(
        (value) => value.replace(/\s+/g, " ").trim() === selector,
      )
    )
      rule.walkDecls((decl) => {
        result[decl.prop] = decl.value;
      });
  });
  return result;
}

describe("screenshot visual contracts", () => {
  it("centers all workspace tab close glyphs independently of the text baseline", () => {
    const close =
      '[data-artemis-component="workspace-tab"] > [data-part="close"]';
    expect(declarations(shared, close + " > span")).toMatchObject({
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      "inline-size": "100%",
      "block-size": "100%",
    });
    expect(declarations(shared, close + " svg").display).toBe("block");
  });
  it("wraps review text without expanding the reader or clipping highlighted lines", () => {
    const line = declarations(
      shared,
      '[data-artemis-component="review-diff"][data-part="line"]',
    );
    expect(line).toMatchObject({
      "min-inline-size": "0",
      "white-space": "pre-wrap",
      "overflow-wrap": "anywhere",
    });
    expect(declarations(desktop, ".review-file")["min-width"]).toBe("0");
    for (const selector of [".review-line code", ".review-hunk code"]) {
      const code = declarations(desktop, selector);
      expect(code).toMatchObject({
        "min-width": "0",
        "white-space": "pre-wrap",
        "overflow-wrap": "anywhere",
      });
      expect(code.overflow).not.toBe("hidden");
      expect(code["text-overflow"]).not.toBe("ellipsis");
    }
    expect(
      declarations(desktop, ".review-line:has(> .review-comment-trigger)")[
        "grid-template-columns"
      ],
    ).toBe("16px 22px 30px 30px minmax(0, 1fr)");
    expect(declarations(desktop, ".review-comment-trigger")["align-self"]).toBe(
      "start",
    );
    expect(declarations(desktop, ".review-line-number")["white-space"]).toBe(
      "pre",
    );
  });
  it("uses plain text Token period tabs without a baseline or selected underline", () => {
    expect(declarations(desktop, ".token-usage-tabs")["border-block-end"]).toBe(
      "0",
    );
    expect(
      declarations(desktop, '.token-usage-tabs [data-part="tab"]').border,
    ).toBe("0");
    expect(
      declarations(desktop, '.token-usage-tabs [data-part="tab"]::after')
        .display,
    ).toBe("none");
  });
  it("keeps turn changes compact with inline totals and unframed actions", () => {
    expect(declarations(desktop, ".turn-change-card")).toMatchObject({
      "border-color": "var(--border-soft)",
      "box-shadow": "none",
    });
    expect(declarations(desktop, ".turn-change-card > header")).toMatchObject({
      "min-block-size": "44px",
      "flex-wrap": "wrap",
    });
    expect(declarations(desktop, ".turn-change-heading").display).toBe("flex");
    expect(declarations(desktop, ".turn-change-icon")).toMatchObject({
      height: "16px",
    });
    expect(
      declarations(desktop, ".turn-change-icon").background,
    ).toBeUndefined();
    expect(declarations(desktop, ".turn-change-actions button")).toMatchObject({
      border: "0",
      background: "transparent",
      "min-height": "28px",
    });
    expect(declarations(desktop, ".turn-change-files li")["min-height"]).toBe(
      "28px",
    );
  });
  it("gives select options intrinsic menu width and a stable checkmark column", () => {
    expect(
      declarations(
        shared,
        '[data-artemis-component="select"] [data-part="menu"]',
      ),
    ).toMatchObject({
      "inline-size": "max-content",
      "min-inline-size": "100%",
      "inset-inline-start": "0",
    });
    expect(
      declarations(
        shared,
        '[data-artemis-component="select"] [data-part="option"]',
      ),
    ).toMatchObject({
      display: "grid",
      "grid-template-columns": "var(--artemis-space-4) minmax(0, 1fr)",
      "text-align": "start",
    });
  });
  it("centers inline notice icons in the first text line without a fixed top offset", () => {
    const icon = declarations(
      shared,
      '[data-artemis-component="inline-notice"] > [data-part="icon"]',
    );
    expect(icon).toMatchObject({
      "block-size": "1.5em",
      "align-items": "center",
    });
    expect(icon["margin-block-start"]).toBeUndefined();
  });
  it("keeps the goal rail borderless with a single plain status and quiet icon controls", () => {
    expect(declarations(desktop, ".goal-bar").border).toBe("0");
    for (const selector of [
      ".goal-bar .goal-bar-main",
      ".goal-bar-actions > button",
    ]) {
      expect(declarations(desktop, selector)).toMatchObject({
        background: "transparent",
        "border-color": "transparent",
      });
    }
    expect(declarations(desktop, ".goal-bar .goal-bar-status")).toMatchObject({
      border: "0",
      background: "transparent",
      padding: "0",
    });
  });
  it("keeps collapsed tool rows compact and exposes details from the same row", () => {
    expect(
      declarations(
        desktop,
        '.tool-card[data-artemis-component="tool-activity"]',
      ),
    ).toMatchObject({ padding: "6px 12px 0", gap: "6px" });
    expect(declarations(desktop, ".tool-activity-list li")).toMatchObject({
      padding: "4px 12px",
      "min-height": "28px",
    });
    expect(declarations(desktop, ".tool-item-details > summary")).toMatchObject(
      { display: "grid", "grid-template-columns": "minmax(0, 1fr) auto 12px" },
    );
    expect(
      declarations(desktop, '.tool-card > [data-part="status"]').position,
    ).not.toBe("absolute");
    expect(
      declarations(
        desktop,
        '.tool-card[data-state="failed"] > [data-part="status"]',
      ).color,
    ).toBe("var(--danger)");
  });
  it("uses the Artemis brand artwork in the integrated sidebar", () => {
    const app = readFileSync(
      new URL("../src/renderer/App.tsx", import.meta.url),
      "utf8",
    );
    expect(app).toContain('className="sidebar-brand"');
    expect(app).toContain('className="rail-brand"');
    expect(app).toContain('import artemisIcon from "../../build/icon.png"');
    expect(app).toContain('<img alt="" aria-hidden="true" src={artemisIcon} />');
    expect(declarations(desktop, ".artemis-mark").background).toBe(
      "transparent",
    );
  });
  it("animates both the current-step halo and dot while respecting reduced motion", () => {
    const marker =
      '.task-plan-progress [data-part="marker"][data-status="in_progress"]';
    expect(declarations(desktop, marker).animation).toBe(
      "task-step-breathe 1.6s ease-in-out infinite",
    );
    expect(declarations(desktop, `${marker}::after`).animation).toBe(
      "task-step-dot-pulse 1.6s ease-in-out infinite",
    );
    const keyframes: string[] = [];
    desktop.walkAtRules("keyframes", (rule) => {
      keyframes.push(rule.params);
    });
    expect(keyframes).toEqual(
      expect.arrayContaining(["task-step-breathe", "task-step-dot-pulse"]),
    );
    const reducedSelectors: string[] = [];
    desktop.walkAtRules("media", (rule) => {
      if (rule.params !== "(prefers-reduced-motion: reduce)") return;
      rule.walkRules((nested) => {
        nested.walkDecls("animation", (decl) => {
          if (decl.value === "none" && decl.important)
            reducedSelectors.push(...nested.selectors);
        });
      });
    });
    expect(reducedSelectors).toEqual(
      expect.arrayContaining([
        ".task-plan-progress *",
        ".task-plan-progress *::after",
      ]),
    );
  });
  it("keeps the plan capsule compact with a breathing dot, checkmarks, and accessible status text", () => {
    expect(
      declarations(desktop, '.task-plan-progress [data-part="steps"]'),
    ).toMatchObject({
      background: "color-mix(in srgb, var(--surface) 96%, transparent)",
      width: "min(520px, 72vw, calc(100cqw - 40px))",
      gap: "0",
    });
    expect(
      declarations(
        desktop,
        '.task-plan-progress [data-part="step"][data-status="in_progress"]',
      ).background,
    ).toBe("var(--artemis-color-background-activity)");
    for (const part of ["status", "step-status"]) {
      expect(
        declarations(desktop, `.task-plan-progress [data-part="${part}"]`),
      ).toMatchObject({
        position: "absolute",
        width: "1px",
        "clip-path": "inset(50%)",
      });
    }
    expect(
      declarations(
        desktop,
        '.task-plan-progress [data-part="marker"][data-status="in_progress"]::after',
      ),
    ).toMatchObject({
      content: '\"\"',
      background: "var(--accent)",
    });
    expect(
      declarations(
        desktop,
        '.task-plan-progress [data-part="marker"][data-status="completed"]::after',
      ).transform,
    ).toBe("translateY(-1px) rotate(45deg)");
    expect(
      declarations(
        desktop,
        '.task-plan-progress [data-part="marker"][data-status="failed"]::after',
      ).content,
    ).toBe('\"!\"');
  });
  it("keeps warnings and errors on a neutral surface with a quiet border and wrapping text", () => {
    expect(
      declarations(
        shared,
        '[data-artemis-component="inline-notice"][data-tone]',
      ),
    ).toMatchObject({
      background: "var(--artemis-color-surface-sunken)",
      "border-color": "var(--artemis-color-border-subtle)",
      "overflow-wrap": "anywhere",
    });
    for (const tone of ["warning", "danger"]) {
      expect(
        declarations(
          shared,
          `[data-artemis-component="inline-notice"][data-tone="${tone}"] > [data-part="icon"]`,
        ).color,
      ).toBe(`var(--artemis-color-status-${tone})`);
    }
  });
  it("anchors management actions to the last column even when a row has no leading icon", () => {
    expect(
      declarations(
        shared,
        '[data-artemis-component="management-row"] > [data-part="actions"]',
      )["grid-column"],
    ).toBe("-2 / -1");
    expect(
      declarations(
        shared,
        '[data-artemis-component="management-row"]:not(:has(> [data-part="leading"]))',
      )["grid-template-columns"],
    ).toBe("minmax(0, 1fr) auto");
  });
  it("uses plain model labels, flat added-model rows, and text-only destructive actions", () => {
    expect(
      declarations(desktop, ".token-usage-models .token-usage-model-action"),
    ).toMatchObject({
      background: "transparent",
      border: "0",
      "box-shadow": "none",
    });
    expect(
      declarations(
        desktop,
        '.added-model-row[data-artemis-component="management-row"]',
      ),
    ).toMatchObject({
      background: "transparent",
      border: "0",
      "border-radius": "0",
    });
    expect(
      declarations(
        desktop,
        '.management-text-action[data-artemis-component="button"]',
      ),
    ).toMatchObject({
      background: "transparent",
      "border-color": "transparent",
    });
    expect(
      declarations(
        desktop,
        '.management-text-action.is-destructive[data-artemis-component="button"]',
      ).color,
    ).toBe("var(--danger)");
  });
  it("uses one installed-capabilities container with divided rows", () => {
    expect(declarations(desktop, ".resource-installed-list").border).toBe(
      "1px solid var(--border-soft)",
    );
    expect(
      declarations(
        desktop,
        '.resource-installed-row[data-artemis-component="management-row"]',
      ),
    ).toMatchObject({
      border: "0",
      "border-bottom": "1px solid var(--border-soft)",
      "border-radius": "0",
    });
  });
  it("keeps IM navigation flat and its secondary actions compact", () => {
    expect(declarations(desktop, ".im-channel-card")).toMatchObject({
      border: "0",
      background: "transparent",
    });
    expect(declarations(desktop, ".im-channel-status").display).toBe(
      "inline-flex",
    );
    expect(declarations(desktop, ".im-secondary-action")["align-self"]).toBe(
      "flex-start",
    );
    expect(declarations(desktop, ".im-block").border).toBe("0");
  });
  it("renders calls as a divided group with per-call status instead of individual outlined buttons", () => {
    expect(
      declarations(
        desktop,
        '.tool-card[data-artemis-component="tool-activity"]',
      ),
    ).toMatchObject({
      background: "var(--panel-3)",
      border: "1px solid var(--border-soft)",
    });
    expect(declarations(desktop, ".tool-activity-list").gap).toBe("0");
    expect(declarations(desktop, ".tool-activity-list li")).toMatchObject({
      "border-top": "1px solid var(--border-soft)",
      "grid-template-columns": "minmax(0, 1fr) auto",
    });
  });
});
