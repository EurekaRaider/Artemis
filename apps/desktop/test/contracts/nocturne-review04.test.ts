import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { findCssDeclarations } from "./css-test-utils.js";

const style = (name: string) =>
  readFileSync(
    new URL(`../../src/renderer/styles/${name}`, import.meta.url),
    "utf8",
  );
const nocturne = style("nocturne.css");
const locales = ["zh-CN", "zh-TW"] as const;

describe("Nocturne fourth review regressions", () => {
  it("keeps the composer and selected sidebar controls flat in glass material", () => {
    const protectedControl =
      /\.(?:composer(?:-run-modes)?|sidebar-new-task|nav-row|project-thread-row)(?![\w-])/u;
    for (const file of ["nocturne.css", "prototype-migration.css"]) {
      postcss.parse(style(file)).walkDecls((declaration) => {
        const selectors: string[] = [];
        for (let parent = declaration.parent; parent; parent = parent.parent) {
          if (parent.type === "rule")
            selectors.push((parent as postcss.Rule).selector);
        }
        const selector = selectors.reverse().join(" ");
        if (
          !selector.includes('[data-material="glass"]') ||
          !protectedControl.test(selector)
        )
          return;
        expect(
          declaration.value,
          `${selector}: ${declaration.prop}`,
        ).not.toMatch(/--nocturne-lens|inset\s+0\s+1px\s+0|999px/u);
        if (declaration.prop.endsWith("backdrop-filter"))
          expect(declaration.value).toBe("none");
      });
    }
    expect(findCssDeclarations(nocturne, ".app-shell .sidebar")).toContain(
      "--selected: var(--nocturne-side-selected)",
    );
  });

  it("uses the flat header status and buttons in both materials", () => {
    expect(
      findCssDeclarations(nocturne, ":root .workspace-header .status-pill"),
    ).toContain("block-size: 22px");
    postcss.parse(nocturne).walkDecls((declaration) => {
      const selectors: string[] = [];
      for (let parent = declaration.parent; parent; parent = parent.parent) {
        if (parent.type === "rule")
          selectors.push((parent as postcss.Rule).selector);
      }
      const selector = selectors.join(" ");
      if (
        !selector.includes('[data-material="glass"]') ||
        !selector.includes("workspace-header")
      )
        return;
      expect(declaration.value).not.toMatch(
        /--nocturne-(?:glass-tint|lens)|inset\s+0\s+1px\s+0/u,
      );
      if (declaration.prop.endsWith("backdrop-filter"))
        expect(declaration.value).toBe("none");
    });
  });

  it("does not reserve space for hidden goal actions or hide the project add button", () => {
    expect(findCssDeclarations(nocturne, ".goal-bar-secondary")).toContain(
      "display: none",
    );
    expect(
      findCssDeclarations(
        nocturne,
        ".goal-bar:is(:hover, :focus-within) .goal-bar-secondary",
      ),
    ).toContain("display: inline-flex");
    expect(
      findCssDeclarations(
        nocturne,
        ".app-shell .project-group-row .project-new-thread",
      ),
    ).toContain("opacity: 1");
  });

  it("keeps usage surfaces raised and chart colors separate from status colors", () => {
    const cards = findCssDeclarations(
      nocturne,
      ".app-shell :is(.token-usage-activity, .token-usage-models, .token-usage-detail-block)",
    );
    expect(cards).toContain("background: var(--surface)");
    expect(
      findCssDeclarations(nocturne, ".app-shell .token-usage-summary"),
    ).toContain("background: var(--surface)");
    for (const token of ["input", "output", "cache", "write", "model"]) {
      expect(nocturne).toContain(`--nocturne-chart-${token}: light-dark(`);
    }
    expect(nocturne).not.toContain("--nocturne-cache-read");
    expect(
      findCssDeclarations(
        nocturne,
        ".app-shell .work-record .turn-execution-entries > .assistant-message",
      ),
    ).toContain("margin-block-start: 12px");
  });

  it.each(locales)(
    "uses task terminology and full-width questions in %s",
    (locale) => {
      const values = JSON.parse(
        readFileSync(
          new URL(
            `../../src/shared/i18n/ui-locales/${locale}.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      ) as Record<string, string>;
      const taskKeys = [
        "App.inline9",
        "App.archiveConversations",
        "App_copy.deleteTask",
        "App_copy.deleteTaskConfirm",
        "App_copy.conversation",
        "App_copy.conversationHistory",
        "App_copy.archivedReadOnly",
        "App_copy.loadingHistory",
        "ArchivePage_labels.archiveTitle",
        "ArchivePage_labels.archiveSearch",
        "ArchivePage_labels.archiveOpen",
        "ArchivePage_labels.archiveCountOne",
        "ArchivePage_labels.archiveCountOther",
        "Share.title",
        "Share.deleteConfirm",
        "DecisionCard.allowedSession",
        "DesignHost.projectOnly",
        "ImMemberRemoval.message1",
        "ImNativeGroups.message9",
      ];
      for (const key of taskKeys)
        expect(values[key], key).not.toMatch(/会话|对话|會話|對話/u);
      expect(values["App_copy.temporaryConversation"]).toBe(
        locale === "zh-CN" ? "临时对话" : "臨時對話",
      );
      expect(values["GroupAuthorization.firstMessage"]).toMatch(/对话|對話/u);
      for (const [key, value] of Object.entries(values)) {
        if (/[\u3400-\u9fff]/u.test(value))
          expect(value, key).not.toMatch(/\?$/u);
      }
    },
  );
});
