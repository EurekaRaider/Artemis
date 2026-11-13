import { describe, expect, it } from "vitest";

import { findCssDeclarations } from "../css-test-utils.js";
import {
  appSource,
  compositionStylesSource,
  nocturneStylesSource,
  stylesSource,
} from "../../fixtures/application/layout-contract.js";

const nocturne = (selector: string) =>
  findCssDeclarations(nocturneStylesSource, selector) ?? "";
const empty = '.app-shell .conversation[data-state="empty"]';

describe("welcome page layout contract", () => {
  it("anchors one centred 720px column near 22% of the main area", () => {
    expect(nocturne(`${empty} > .conversation-body`)).toMatch(
      /justify-content: flex-start/u,
    );
    expect(nocturne(`${empty} > .conversation-body::before`)).toMatch(
      /flex: 0 1 calc\(22% - 28px\)/u,
    );
    expect(
      nocturne(
        `${empty} > .conversation-body > .composer-wrap, ${empty} > .conversation-body > .timeline-scroll`,
      ),
    ).toMatch(/max-inline-size: 720px/u);
    const hero = nocturne(".app-shell .conversation-empty-state");
    expect(hero).toMatch(/align-items: center/u);
    expect(hero).toMatch(/text-align: center/u);
    expect(
      nocturne(".app-shell .conversation-empty-state .artemis-mark svg"),
    ).toMatch(/inline-size: 40px/u);
    expect(appSource).toContain("icon={<ArtemisMark size={40} />}");
    const title = nocturne(".app-shell .conversation-empty-state h1");
    expect(title).toMatch(/font-size: 28px/u);
    expect(title).toMatch(/line-height: 36px/u);
    expect(
      nocturne(".app-shell .conversation-empty-state:lang(zh) h1"),
    ).toMatch(/font-weight: 500;\s*letter-spacing: 0/u);
    expect(nocturne(".app-shell .conversation-greeting-detail")).toMatch(
      /font-size: 14.5px;\s*line-height: 22px/u,
    );
  });

  it("quiets the welcome header and centres the context line under the composer", () => {
    expect(appSource).toContain(
      "{conversationEmpty ? t.newTask : activeWorkspaceLabel}",
    );
    expect(nocturne(`${empty} .workspace-header`)).toMatch(
      /border-block-end-color: transparent/u,
    );
    expect(compositionStylesSource).toMatch(
      /:has\(\s*\.conversation\[data-state="empty"\]\s*\)::before\s*\{\s*border-block-end-color: transparent/u,
    );
    expect(nocturne(`${empty} .composer-context-row`)).toMatch(
      /justify-content: center/u,
    );
    expect(nocturne(`${empty} .composer-context > * + *::before`)).toMatch(
      /border-radius: 50%/u,
    );
    expect(
      nocturne(
        `${empty} :is(.composer-context-trigger, .environment-workspace-trigger)`,
      ),
    ).toMatch(/color: var\(--muted-2\);\s*font-size: 12px/u);
  });

  it("restyles the composer with a text-only mode track at regular widths", () => {
    expect(nocturne(".app-shell .composer")).toMatch(/border-radius: 18px/u);
    expect(findCssDeclarations(stylesSource, ".composer textarea")).toMatch(
      /font-size: 15px/u,
    );
    expect(nocturne(".composer-run-modes")).toMatch(
      /background: var\(--hover\)/u,
    );
    expect(nocturne('.composer-run-modes [data-part="icon"]')).toMatch(
      /display: none/u,
    );
    expect(
      nocturne(
        '.composer-run-modes [aria-checked="false"]:disabled [data-part="icon"]',
      ),
    ).toMatch(/display: flex/u);
    expect(nocturneStylesSource).toMatch(
      /@container composer \(max-width: 680px\) \{\s*\.composer-run-modes \[data-part="icon"\] \{\s*display: flex;/u,
    );
  });

  it("centres fixed-width resume cards and stacks them below 560px", () => {
    expect(nocturne(".welcome-resume h2")).toMatch(/text-align: center/u);
    expect(nocturne(".welcome-resume-grid")).toMatch(
      /display: flex;\s*justify-content: center;\s*gap: 12px/u,
    );
    expect(nocturne(".app-shell .welcome-resume-card")).toMatch(
      /flex: 0 1 232px/u,
    );
    expect(nocturne(".welcome-resume-meta")).toMatch(
      /padding-inline-start: 24px/u,
    );
    expect(nocturneStylesSource).toMatch(
      /@container \(max-width: 559px\) \{\s*\.welcome-resume-grid \{\s*flex-direction: column;/u,
    );
  });

  it("floors helper text at 12px only in the Chinese interface", () => {
    expect(findCssDeclarations(stylesSource, ":root")).toContain(
      "--meta: 11.5px;",
    );
    expect(findCssDeclarations(stylesSource, ":root:lang(zh)")).toContain(
      "--meta: 12px;",
    );
    expect(
      nocturne(':root[data-artemis-skin="com.artemis.default"]:lang(zh)'),
    ).toMatch(
      /--artemis-typography-label-size: 12px;\s*--artemis-typography-metadata-size: 12px/u,
    );
  });
});
