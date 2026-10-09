// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { APP_LOCALES } from "@artemis/protocol";
import { DesignPluginPanel } from "../../../src/renderer/design/DesignPluginPanel.js";
import { uiText } from "../../../src/shared/i18n/ui-text.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
it("mounts the Design panel without a separate permissions notice or switch", async () => {
  const bounds = vi.fn(async () => {});
  stubWindowArtemis({
    ensureDesignPanel: async () => ({}),
    setDesignPanelBounds: bounds,
    setDesignPanelVisible: async () => {},
    releaseDesignPanel: async () => {},
    onDesignPanelCandidate: () => () => {},
    onDesignPanelBinding: () => () => {},
  });
  const { container } = render(
    <DesignPluginPanel
      threadId="design"
      panelId="workspace"
      active
      failureMessage="Panel failed"
    />,
  );
  await waitFor(() => expect(bounds).toHaveBeenCalled());
  expect(container.querySelector(".design-plugin-panel-mount")).not.toBeNull();
  expect(screen.queryByRole("region")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});
it.each(APP_LOCALES)(
  "uses the same Artemis source name in %s reinstall instructions",
  (locale) => {
    const label = uiText(locale, "ResourceCenter_labels.bundledPlugins");
    for (const key of [
      "AppDesign.removed",
      "DesignHost.pluginMissing",
      "DesignHost.pluginRemoved",
    ])
      expect(uiText(locale, key)).toContain(label);
  },
);
