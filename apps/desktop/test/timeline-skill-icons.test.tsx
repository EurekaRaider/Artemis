// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  createThreadViewState,
  reduceAgentEvent,
  PROTOCOL_VERSION,
} from "@artemis/protocol";
import { Timeline } from "../src/renderer/App.js";
import { pluginBrandIcon } from "../src/renderer/plugin-brand-icons.js";
import type { InstalledCodexPlugin } from "../src/shared/api.js";
import "./renderer-test-utils.js";

vi.mock("../src/renderer/desktop-skin-bootstrap.js", () => ({
  desktopSkinHost: { setTheme: vi.fn() },
}));

function renderSkill(name: string, plugin?: Partial<InstalledCodexPlugin>) {
  const state = reduceAgentEvent(createThreadViewState("thread"), {
    protocolVersion: PROTOCOL_VERSION,
    eventId: "event",
    threadId: "thread",
    turnId: "turn",
    seq: 1,
    timestamp: "2026-09-29T00:00:00Z",
    payload: {
      type: "user.message",
      messageId: "message",
      text: `/skill:${name}`,
    },
  });
  return render(
    <Timeline
      installedPlugins={
        plugin
          ? [
              {
                mcpServerIds: [],
                skillNames: [name],
                ...plugin,
              } as InstalledCodexPlugin,
            ]
          : []
      }
      installedSkills={[]}
      state={state}
      locale="en"
      onExternalLink={vi.fn()}
      onFileLink={vi.fn()}
      onFileLinkContextMenu={vi.fn()}
      onOpenChildAgent={vi.fn()}
      onOpenTurnReview={vi.fn()}
      onCopyText={vi.fn()}
      onEditUserMessage={undefined}
      onResolve={vi.fn()}
      onResolveUserInput={vi.fn()}
      onUndoTurnChanges={vi.fn()}
    />,
  );
}

it.each([true, false])(
  "shows Computer Use's monitor with plugin metadata present=%s",
  (installed) => {
    const { container } = renderSkill(
      "computer-use",
      installed ? { name: "computer-use" } : undefined,
    );
    expect(
      container.querySelector(".user-message-capability [data-icon='monitor']"),
    ).not.toBeNull();
  },
);

it.each([
  "atlassian",
  "figma",
  "github",
  "gmail",
  "google-workspace",
  "linear",
  "notion",
  "outlook",
  "qq-mail",
  "slack",
])("uses %s's bundled brand for a skill without a manifest icon", (name) => {
  const { container } = renderSkill("plugin-specific-skill", { name });
  expect(
    container.querySelector(".user-message-capability img"),
  ).toHaveAttribute("src", pluginBrandIcon(name));
});

it("preserves Gmail's manifest artwork", () => {
  const { container } = renderSkill("gmail", {
    name: "gmail",
    iconDataUrl: "/gmail-custom.png",
  });
  expect(
    container.querySelector(".user-message-capability img"),
  ).toHaveAttribute("src", "/gmail-custom.png");
});

it("prefers custom artwork and falls back to the owning plugin on image failure", () => {
  const { container } = renderSkill("design", {
    name: "figma",
    iconDataUrl: "/broken.png",
  });
  const image = container.querySelector(".user-message-capability img")!;
  expect(image).toHaveAttribute("src", "/broken.png");
  fireEvent.error(image);
  expect(image).toHaveAttribute("src", pluginBrandIcon("figma"));
});

it("keeps an unknown standalone skill visible with a semantic fallback", () => {
  const { container } = renderSkill("custom-task");
  expect(
    container.querySelector(".user-message-capability [data-icon='skill']"),
  ).not.toBeNull();
  expect(
    container.querySelector(".user-message-capability strong"),
  ).toHaveTextContent("custom-task");
});
