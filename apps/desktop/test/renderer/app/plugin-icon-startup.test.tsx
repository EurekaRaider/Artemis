// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { App } from "../../../src/renderer/app/App.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { changeLanguage: vi.fn() } }),
}));

vi.mock("../../../src/renderer/appearance/desktop-skin-bootstrap.js", () => ({
  desktopSkinHost: { setTheme: vi.fn() },
}));

it("loads plugin artwork on each cold mount without opening the skill menu", async () => {
  const listArtemisPlugins = vi.fn().mockResolvedValue([]);
  const pending = new Promise(() => {});
  stubWindowArtemis(
    new Proxy(
      { listArtemisPlugins },
      {
        get(target, key) {
          if (key === "listArtemisPlugins") return target.listArtemisPlugins;
          if (String(key).startsWith("on")) return () => () => {};
          return () => pending;
        },
      },
    ),
  );
  const first = render(<App />);
  await waitFor(() => expect(listArtemisPlugins).toHaveBeenCalled());
  first.unmount();
  listArtemisPlugins.mockClear();
  render(<App />);
  await waitFor(() => expect(listArtemisPlugins).toHaveBeenCalled());
});
