// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { App } from "../src/renderer/App.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { changeLanguage: vi.fn() } }),
}));

vi.mock("../src/renderer/desktop-skin-bootstrap.js", () => ({
  desktopSkinHost: { setTheme: vi.fn() },
}));

it("loads plugin artwork on each cold mount without opening the skill menu", async () => {
  const listCodexPlugins = vi.fn().mockResolvedValue([]);
  const pending = new Promise(() => {});
  stubWindowArtemis(
    new Proxy(
      { listCodexPlugins },
      {
        get(target, key) {
          if (key === "listCodexPlugins") return target.listCodexPlugins;
          if (String(key).startsWith("on")) return () => () => {};
          return () => pending;
        },
      },
    ),
  );
  const first = render(<App />);
  await waitFor(() => expect(listCodexPlugins).toHaveBeenCalledTimes(1));
  first.unmount();
  render(<App />);
  await waitFor(() => expect(listCodexPlugins).toHaveBeenCalledTimes(2));
});
