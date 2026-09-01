// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it } from "vitest";

import artemisManifest from "@artemis/theme-artemis/manifest.json";

import {
  DEFAULT_DESKTOP_SKIN_ID,
  DesktopSkinHost,
  createDesktopSkinRegistry,
} from "../src/renderer/desktop-skin.js";

afterEach(cleanup);

function matchMedia(): MediaQueryList {
  return {
    matches: false,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  };
}

describe("Desktop skin DOM identity", () => {
  it("preserves application state, selection, focus, and body portal identity across attribute-only changes", async () => {
    const stressManifest = {
      ...artemisManifest,
      id: "com.example.stress",
      name: "Stress",
    };
    const registry = createDesktopSkinRegistry([
      {
        manifest: artemisManifest,
        load: async () => undefined,
        ready: () => true,
      },
      {
        manifest: stressManifest,
        load: async () => undefined,
        ready: () => true,
      },
    ]);
    const host = new DesktopSkinHost({
      root: document.documentElement,
      registry,
      matchMedia,
    });
    await host.bootstrap();

    const portal = document.createElement("div");
    document.body.append(portal);
    const view = render(
      <>
        <textarea defaultValue="preserved-state" aria-label="state anchor" />
        {createPortal(<div data-portal-anchor>portal</div>, portal)}
      </>,
    );
    const anchor = view.getByRole("textbox", {
      name: "state anchor",
    }) as HTMLTextAreaElement;
    const portalAnchor = portal.querySelector("[data-portal-anchor]");
    anchor.focus();
    anchor.setSelectionRange(2, 8);

    await host.selectSkin("com.example.stress");
    await host.setTheme("dark");
    await host.setContrast("high");
    await host.selectSkin(DEFAULT_DESKTOP_SKIN_ID);

    expect(view.getByRole("textbox", { name: "state anchor" })).toBe(anchor);
    expect(anchor.value).toBe("preserved-state");
    expect(anchor.selectionStart).toBe(2);
    expect(anchor.selectionEnd).toBe(8);
    expect(document.activeElement).toBe(anchor);
    expect(portal.querySelector("[data-portal-anchor]")).toBe(portalAnchor);
    expect(portalAnchor?.closest("html")).toBe(document.documentElement);
    expect(document.body.dataset.artemisSkin).toBeUndefined();
    expect(document.documentElement.dataset.artemisSkin).toBe(
      DEFAULT_DESKTOP_SKIN_ID,
    );
    expect(document.documentElement.dataset.artemisContrast).toBe("high");

    host.destroy();
    portal.remove();
  });
});
