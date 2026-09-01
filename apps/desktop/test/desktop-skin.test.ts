// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import artemisManifest from "@artemis/theme-artemis/manifest.json";
import { SEMANTIC_TOKEN_REGISTRY } from "@artemis/theme-contract";

import {
  DEFAULT_DESKTOP_SKIN_ID,
  DesktopSkinHost,
  completeDesktopSkinTokenSnapshot,
  createDesktopSkinRegistry,
  type DesktopSkinRegistration,
} from "../src/renderer/desktop-skin.js";
import { productionDesktopSkinRegistry } from "../src/renderer/desktop-skin-registry.js";

function manifest(id: string, contrastModes = ["normal", "high"] as const) {
  const includesHighContrast = contrastModes.includes("high");
  return {
    ...artemisManifest,
    id,
    name: id === DEFAULT_DESKTOP_SKIN_ID ? "Artemis" : "Test Skin",
    capabilities: {
      ...artemisManifest.capabilities,
      contrastModes,
    },
    tokens: includesHighContrast
      ? artemisManifest.tokens
      : {
          light: artemisManifest.tokens.light,
          dark: artemisManifest.tokens.dark,
        },
  };
}

function registration(
  id: string,
  overrides: Partial<DesktopSkinRegistration> = {},
): DesktopSkinRegistration {
  return {
    manifest: manifest(id),
    load: async () => undefined,
    ready: () => true,
    ...overrides,
  };
}

function media(initial = false) {
  let matches = initial;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  return {
    query: {
      get matches() {
        return matches;
      },
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(
        (_type: string, listener: (event: MediaQueryListEvent) => void) => {
          listeners.add(listener);
        },
      ),
      removeEventListener: vi.fn(
        (_type: string, listener: (event: MediaQueryListEvent) => void) => {
          listeners.delete(listener);
        },
      ),
      dispatchEvent: vi.fn(() => true),
    } as MediaQueryList,
    change(next: boolean) {
      matches = next;
      const event = { matches: next } as MediaQueryListEvent;
      for (const listener of listeners) listener(event);
    },
    listenerCount: () => listeners.size,
  };
}

function host(
  registrations: readonly DesktopSkinRegistration[],
  initialDark = false,
) {
  const root = { dataset: {} as DOMStringMap };
  const preference = media(initialDark);
  const instance = new DesktopSkinHost({
    root,
    registry: createDesktopSkinRegistry(registrations),
    matchMedia: () => preference.query,
  });
  return { host: instance, root, media: preference };
}

describe("Desktop skin production registry", () => {
  it("contains exactly the trusted public Artemis manifest", () => {
    expect(productionDesktopSkinRegistry.ids).toEqual([
      DEFAULT_DESKTOP_SKIN_ID,
    ]);
    expect(productionDesktopSkinRegistry.defaultSkin.manifest).toEqual(
      artemisManifest,
    );
  });

  it("rejects empty, duplicate, missing-default, malformed, and invalid entries", () => {
    expect(() => createDesktopSkinRegistry([])).toThrow("at least one");
    expect(() =>
      createDesktopSkinRegistry([
        registration(DEFAULT_DESKTOP_SKIN_ID),
        registration(DEFAULT_DESKTOP_SKIN_ID),
      ]),
    ).toThrow("Duplicate");
    expect(() =>
      createDesktopSkinRegistry([registration("com.example.other")]),
    ).toThrow("missing com.artemis.default");
    expect(() =>
      createDesktopSkinRegistry([
        {
          manifest: { ...artemisManifest, id: "not valid" },
          load: async () => undefined,
          ready: () => true,
        },
      ]),
    ).toThrow("invalid manifest");
    expect(() =>
      createDesktopSkinRegistry([
        { manifest: artemisManifest } as unknown as DesktopSkinRegistration,
      ]),
    ).toThrow("malformed");
  });
});

describe("Desktop skin resolver and host", () => {
  it("installs the complete default appearance before use and preserves legacy system semantics", async () => {
    const fixture = host([registration(DEFAULT_DESKTOP_SKIN_ID)]);
    await fixture.host.bootstrap("system");
    expect(fixture.root.dataset).toEqual({
      artemisSkin: DEFAULT_DESKTOP_SKIN_ID,
      artemisTheme: "light",
      artemisContrast: "normal",
    });
    expect(fixture.media.listenerCount()).toBe(1);

    fixture.media.change(true);
    await vi.waitFor(() =>
      expect(fixture.root.dataset.artemisTheme).toBe("dark"),
    );
    expect(fixture.root.dataset.theme).toBeUndefined();

    await fixture.host.setTheme("light");
    expect(fixture.root.dataset.theme).toBe("light");
    fixture.media.change(false);
    fixture.media.change(true);
    await Promise.resolve();
    expect(fixture.root.dataset.artemisTheme).toBe("light");

    fixture.host.destroy();
    fixture.host.destroy();
    expect(fixture.media.listenerCount()).toBe(0);
    expect(fixture.media.query.removeEventListener).toHaveBeenCalledOnce();
  });

  it.each([
    ["unknown", "com.example.missing"],
    ["empty", ""],
    ["malformed", "not a skin"],
    ["non-string", 17],
  ])("falls back atomically for %s selection", async (_name, requested) => {
    const fixture = host([registration(DEFAULT_DESKTOP_SKIN_ID)]);
    await fixture.host.bootstrap();
    const before = { ...fixture.root.dataset };
    const result = await fixture.host.selectSkin(requested);
    expect(result.status).toBe("fallback");
    if (result.status === "fallback") expect(result.reason).toBe("unknown");
    expect(fixture.root.dataset).toEqual(before);
  });

  it.each([
    ["unavailable", { available: async () => false }, "unavailable"],
    [
      "availability rejected",
      { available: async () => Promise.reject(new Error("availability")) },
      "unavailable",
    ],
    [
      "load rejected",
      { load: async () => Promise.reject(new Error("load")) },
      "load-failed",
    ],
    ["not ready", { ready: () => false }, "load-failed"],
    [
      "readiness rejected",
      { ready: async () => Promise.reject(new Error("readiness")) },
      "load-failed",
    ],
  ] satisfies ReadonlyArray<
    [string, Partial<DesktopSkinRegistration>, "unavailable" | "load-failed"]
  >)(
    "falls back as a whole when the selected skin is %s",
    async (_name, overrides, expectedReason) => {
      const fixture = host([
        registration(DEFAULT_DESKTOP_SKIN_ID),
        registration("com.example.stress", overrides),
      ]);
      await fixture.host.bootstrap();
      const before = { ...fixture.root.dataset };
      const result = await fixture.host.selectSkin("com.example.stress");
      expect(result.status).toBe("fallback");
      if (result.status === "fallback") {
        expect(result.reason).toBe(expectedReason);
      }
      expect(fixture.root.dataset).toEqual(before);
      expect(Object.keys(fixture.root.dataset)).toEqual([
        "artemisSkin",
        "artemisTheme",
        "artemisContrast",
      ]);
    },
  );

  it("falls back when the selected skin does not support the resolved mode", async () => {
    const compactOnly = manifest("com.example.compact-only");
    const unsupported = registration("com.example.compact-only", {
      manifest: {
        ...compactOnly,
        capabilities: {
          ...compactOnly.capabilities,
          densities: ["compact"],
        },
      },
    });
    const fixture = host([registration(DEFAULT_DESKTOP_SKIN_ID), unsupported]);
    await fixture.host.bootstrap();
    const result = await fixture.host.selectSkin("com.example.compact-only");
    expect(result.status).toBe("fallback");
    if (result.status === "fallback") expect(result.reason).toBe("unsupported");
    expect(fixture.root.dataset.artemisSkin).toBe(DEFAULT_DESKTOP_SKIN_ID);
    expect(fixture.root.dataset.artemisContrast).toBe("normal");
  });

  it("returns fatal and preserves the last valid DOM when default fallback fails", async () => {
    let rejectDefault = false;
    let defaultLoadCount = 0;
    const fixture = host([
      registration(DEFAULT_DESKTOP_SKIN_ID, {
        load: async () => {
          defaultLoadCount += 1;
          if (rejectDefault) throw new Error("default failed");
        },
      }),
    ]);
    await fixture.host.bootstrap("dark");
    const before = { ...fixture.root.dataset };
    rejectDefault = true;
    const result = await fixture.host.selectSkin(DEFAULT_DESKTOP_SKIN_ID);
    expect(result.status).toBe("fatal");
    expect(result.error?.message).toContain("failed to load");
    expect((result.error?.cause as Error | undefined)?.message).toBe(
      "default failed",
    );
    expect(defaultLoadCount).toBe(2);
    expect(fixture.root.dataset).toEqual(before);
  });

  it("lets only the latest asynchronous generation update the root", async () => {
    let releaseSlow: (() => void) | undefined;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const fixture = host([
      registration(DEFAULT_DESKTOP_SKIN_ID),
      registration("com.example.slow", { load: () => slow }),
      registration("com.example.fast"),
    ]);
    await fixture.host.bootstrap();
    const first = fixture.host.selectSkin("com.example.slow");
    const second = fixture.host.selectSkin("com.example.fast");
    expect((await second).status).toBe("applied");
    releaseSlow?.();
    expect((await first).status).toBe("superseded");
    expect(fixture.root.dataset.artemisSkin).toBe("com.example.fast");
  });

  it("does not mutate the root before a selected loader and ready gate finish", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = host([
      registration(DEFAULT_DESKTOP_SKIN_ID),
      registration("com.example.pending", { load: () => pending }),
    ]);
    await fixture.host.bootstrap();
    const before = { ...fixture.root.dataset };
    const transition = fixture.host.selectSkin("com.example.pending");
    await Promise.resolve();
    expect(fixture.root.dataset).toEqual(before);
    release?.();
    await transition;
    expect(fixture.root.dataset.artemisSkin).toBe("com.example.pending");
  });
});

describe("Desktop semantic token snapshots", () => {
  it("requires all 74 semantic custom properties without inline fallback", () => {
    const values = new Map(
      Object.values(SEMANTIC_TOKEN_REGISTRY).map((definition) => [
        definition.cssVariable,
        "resolved",
      ]),
    );
    const complete = completeDesktopSkinTokenSnapshot({
      getPropertyValue: (name) => values.get(name) ?? "",
    });
    expect(Object.keys(complete ?? {})).toHaveLength(74);
    values.delete("--artemis-color-canvas");
    expect(
      completeDesktopSkinTokenSnapshot({
        getPropertyValue: (name) => values.get(name) ?? "",
      }),
    ).toBeUndefined();
  });
});
