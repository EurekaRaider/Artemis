// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
function fixture(locale: (typeof APP_LOCALES)[number], confirmed = true) {
  let thread = {
    id: "design",
    typeBinding: {},
    executionProfile: "plugin-restricted-v1",
  };
  const setPermission = vi.fn(async (_id, permission) => {
    thread = {
      ...thread,
      executionProfile:
        permission === "standard"
          ? "plugin-standard-v1"
          : "plugin-restricted-v1",
    };
    return thread;
  });
  const confirm = vi.fn(async () => confirmed);
  const threadChanged = vi.fn();
  stubWindowArtemis({
    ensureDesignPanel: async () => ({}),
    getDesignThreadPermissions: async () => thread,
    setDesignThreadPermissions: setPermission,
    setDesignPanelBounds: async () => {},
    setDesignPanelVisible: async () => {},
    releaseDesignPanel: async () => {},
    onDesignPanelCandidate: () => () => {},
    onDesignPanelBinding: () => () => {},
  });
  render(
    <DesignPluginPanel
      locale={locale}
      onConfirm={confirm}
      onThreadChange={threadChanged}
      threadId="design"
      panelId="workspace"
      active
      failureMessage="Panel failed"
    />,
  );
  return { setPermission, confirm, threadChanged };
}
it.each(APP_LOCALES)(
  "explains %s permissions and changes only after the host confirmation",
  async (locale) => {
    const f = fixture(locale);
    expect(
      await screen.findByText(
        uiText(locale, "DesignPermissions.restrictedHint"),
      ),
    ).toBeVisible();
    expect(f.threadChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ executionProfile: "plugin-restricted-v1" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: uiText(locale, "DesignPermissions.enable"),
      }),
    );
    await waitFor(() =>
      expect(f.setPermission).toHaveBeenCalledWith("design", "standard"),
    );
    expect(f.confirm).toHaveBeenCalledWith(
      uiText(locale, "DesignPermissions.access"),
    );
    expect(
      await screen.findByText(uiText(locale, "DesignPermissions.standard")),
    ).toBeVisible();
    expect(f.threadChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ executionProfile: "plugin-standard-v1" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: uiText(locale, "DesignPermissions.restrict"),
      }),
    );
    await waitFor(() =>
      expect(f.setPermission).toHaveBeenLastCalledWith("design", "restricted"),
    );
  },
);
it("a declined permission confirmation never reaches the host", async () => {
  const f = fixture("en", false);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Use standard chat permissions",
    }),
  );
  await waitFor(() => expect(f.confirm).toHaveBeenCalledOnce());
  expect(f.setPermission).not.toHaveBeenCalled();
  expect(screen.getByText("Restricted design permissions")).toBeVisible();
});
it("a refused upgrade leaves the current permission visible and retryable", async () => {
  const f = fixture("en");
  f.setPermission.mockRejectedValueOnce(new Error("Stop the task first"));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Use standard chat permissions",
    }),
  );
  expect(await screen.findByText("Stop the task first")).toBeVisible();
  expect(screen.getByText("Restricted design permissions")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Use standard chat permissions" }),
  ).toBeEnabled();
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
