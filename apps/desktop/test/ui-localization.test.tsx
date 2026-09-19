// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { APP_LOCALES } from "@artemis/protocol";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./renderer-test-utils.js";
import { ImFirstTaskInstructions } from "../src/renderer/ImSetupGuide.js";
import { FileAttachment } from "../src/renderer/FileAttachment.js";
import { ArchivePage } from "../src/renderer/ArchivePage.js";
import { UI_COPY } from "../src/shared/ui-copy.js";
import {
  UI_RESOURCES,
  uiText,
  uiTranslator,
  type UiMessageKey,
} from "../src/shared/ui-text.js";
import { STATUS_RESOURCES } from "../src/shared/status-resources.js";
import { bundledPluginDescription } from "../src/shared/bundled-plugin-copy.js";
import { reviewMessage } from "../src/shared/review-copy.js";
import { statusText } from "../src/shared/status-text.js";

const placeholders = (text: string) =>
  [...text.matchAll(/\{\{([\w.-]+)\}\}|\{([\w.-]+)\}/g)]
    .map((match) => match[1] ?? match[2])
    .sort();

describe("application language packs", () => {
  it.each(APP_LOCALES.filter((locale) => locale !== "en"))(
    "does not leave delegation controls and receipts in English in %s",
    (locale) => {
      for (const key of Object.keys(UI_RESOURCES.en).filter((key) =>
        key.startsWith("ImDelegation."),
      ) as UiMessageKey[]) {
        expect(uiText(locale, key), `${locale}:${key}`).not.toBe(
          uiText("en", key),
        );
      }
    },
  );

  it.each(APP_LOCALES)(
    "has complete nonempty messages and unchanged placeholders in %s",
    (locale) => {
      const source = UI_RESOURCES.en;
      const translated = UI_RESOURCES[locale];
      expect(Object.keys(translated).sort()).toEqual(
        Object.keys(source).sort(),
      );
      for (const key of Object.keys(source) as UiMessageKey[]) {
        const text = translated[key]!;
        expect(text.trim(), `${locale}:${key}`).not.toBe("");
        expect(placeholders(text), `${locale}:${key}`).toEqual(
          placeholders(source[key]!),
        );
        for (const token of UI_RESOURCES["zh-CN"][key]!.match(
          /--[a-z][a-z-]+|@[a-z][a-z0-9_-]*\/[a-z][a-z0-9_-]*|AGENTS\.md|SKILL\.md|\.codex-plugin|127\.0\.0\.1/g,
        ) ?? []) {
          expect(text, `${locale}:${key}`).toContain(token);
        }
      }
      expect(Object.keys(STATUS_RESOURCES[locale])).toEqual(
        Object.keys(STATUS_RESOURCES.en),
      );
    },
  );

  it("substitutes dynamic data once and isolates RTL values without interpreting their contents", () => {
    const hostileLookingName = "repo {{value2}} $& <b>main</b>";
    const text = uiText("ar", "EnvironmentPanel_labels.branchSearch", {
      project: hostileLookingName,
    });
    expect(text).toContain(`\u2068${hostileLookingName}\u2069`);
    expect(text).not.toContain("{{project}}");
  });

  it("switches page and attachment labels in-place for every locale", () => {
    const view = (locale: (typeof APP_LOCALES)[number]) => (
      <>
        <FileAttachment
          locale={locale}
          name="example.txt"
          content="User content stays unchanged"
        />
        <ArchivePage
          locale={locale}
          projects={[]}
          threads={[]}
          onOpen={vi.fn()}
          onRestore={vi.fn()}
          onDelete={vi.fn()}
        />
      </>
    );
    const { rerender, container } = render(view("en"));
    for (const locale of APP_LOCALES) {
      rerender(view(locale));
      expect(
        screen.getByRole("button", {
          name: `${uiText(locale, "FileAttachment.inline1")}: example.txt`,
        }),
      ).toBeTruthy();
      const page = container.querySelector(".archive-page") as HTMLElement;
      expect(
        within(page).getByText(
          UI_COPY.ArchivePage_labels[locale].archiveEmptyTitle,
        ),
      ).toBeTruthy();
      if (locale !== "en") {
        expect(uiText(locale, "FileAttachment.inline1")).not.toBe(
          uiText("en", "FileAttachment.inline1"),
        );
      }
    }
  });

  it("uses the intended scoped meanings and localizes protocol display states", () => {
    expect(UI_COPY.App_copy["zh-CN"].running).toBe("思考中");
    expect(statusText("zh-CN", "running")).toBe("运行中");
    expect(statusText("zh-TW", "authorization-required")).toBe("需要授權");
    expect(statusText("ja", "checking")).toBe("更新を確認中");
    expect(statusText("ar", "future-diagnostic-code")).toBe(
      "future-diagnostic-code",
    );
  });

  it.each(APP_LOCALES)(
    "localizes built-in plugin descriptions and known review messages in %s",
    (locale) => {
      for (const name of [
        "documents",
        "pdf",
        "presentations",
        "spreadsheets",
      ]) {
        const description = bundledPluginDescription(locale, name);
        expect(description).toBeTruthy();
        expect(description).not.toContain("{{");
        if (locale !== "en")
          expect(description).not.toBe(bundledPluginDescription("en", name));
      }
      expect(
        bundledPluginDescription(locale, "third-party-plugin"),
      ).toBeUndefined();
      expect(reviewMessage(locale, "git: external diagnostic")).toBe(
        "git: external diagnostic",
      );
      if (locale !== "en")
        expect(reviewMessage(locale, "Project not found.")).not.toBe(
          "Project not found.",
        );
    },
  );

  it.each([false, true])(
    "copies executable Arabic IM commands without bidi control characters (Slack: %s)",
    (slack) => {
      const copy = vi.fn();
      render(
        <ImFirstTaskInstructions
          t={uiTranslator("ar")}
          copy={copy}
          slack={slack}
        />,
      );
      fireEvent.click(
        screen.getAllByRole("button", {
          name: uiText("ar", "ImSetupGuide.message15"),
        })[1]!,
      );
      const command = copy.mock.calls[0]![0] as string;
      expect(command).toMatch(slack ? /^new\s/u : /^\/new\s/u);
      expect(command).not.toMatch(/[\u2068\u2069]/u);
    },
  );

  it("does not route renderer pages through bilingual fallback catalogs or boolean language props", () => {
    const directory = resolve(process.cwd(), "src/renderer");
    for (const file of readdirSync(directory).filter((file) =>
      /\.tsx?$/.test(file),
    )) {
      const source = readFileSync(resolve(directory, file), "utf8");
      expect(source, file).not.toMatch(
        /\blegacyLocale\s*\(|\blocalizedCopy\s*\(|\bzh\s*:\s*boolean/,
      );
      expect(source, file).not.toMatch(/\bt\(\s*["'`][\p{Script=Han}]/u);
    }
  });
});
