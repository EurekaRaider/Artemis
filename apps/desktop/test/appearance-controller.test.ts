// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  artemisThemeManifest,
  artemisTokenDocuments,
} from "../../../packages/theme-artemis/src/index.js";
import { validateVisualSkinPackage } from "@artemis/theme-contract";
import type {
  AppearanceState,
  ResolvedSkinPackage,
  SkinSelection,
} from "../src/shared/appearance.js";
import { DesktopSkinHost } from "../src/renderer/desktop-skin.js";
import {
  productionDesktopSkinRegistry,
  replaceDesktopSkinCatalog,
} from "../src/renderer/desktop-skin-registry.js";
vi.mock("../src/renderer/desktop-skin-bootstrap.js", () => ({
  desktopSkinHost: {},
}));
let controller: import("../src/renderer/appearance-controller.js").AppearanceController;
let host: DesktopSkinHost;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: new Set(),
  });
  host = new DesktopSkinHost({
    root: document.documentElement,
    registry: productionDesktopSkinRegistry,
    matchMedia: window.matchMedia,
  });
});
afterEach(async () => {
  await controller?.dispose();
  host.destroy();
  replaceDesktopSkinCatalog([]);
  document.head
    .querySelectorAll("[data-appearance-lease]")
    .forEach((e) => e.remove());
  vi.unstubAllGlobals();
});
function data(id: string, color?: string) {
  const manifest = {
    ...artemisThemeManifest,
    id,
    schemaVersion: 2,
    assets: {},
    backgrounds: { light: { type: "none" }, dark: { type: "none" } },
  };
  const tokenDocuments = Object.fromEntries(
    Object.entries(artemisTokenDocuments).map(([p, d]) => [
      p,
      {
        ...d,
        skinId: id,
        modes: d.modes.map((m) => ({
          ...m,
          tokens: {
            ...m.tokens,
            ...(color
              ? { "color.canvas": { kind: "color", value: color } }
              : {}),
          },
        })),
      },
    ]),
  );
  return validateVisualSkinPackage({ manifest, tokenDocuments }).value!;
}
const selection = (name: string): SkinSelection => ({
  pluginId: "ocean",
  skinId: `com.example.${name}`,
});
function state(
  revision = 1,
  selected: SkinSelection | null = null,
): AppearanceState {
  return {
    schemaVersion: 1,
    revision,
    selection: selected,
    theme: "light",
    mediaPaused: false,
    catalog: ["a", "b", "c"].map((name) => ({
      id: `com.example.${name}`,
      name,
      version: "1.0.0",
      schemaVersion: 2,
      pluginId: "ocean",
      pluginName: "Ocean",
      contentHash: "a".repeat(64),
      enabled: true,
      available: true,
      manifest: data(`com.example.${name}`).manifest,
    })),
  };
}
function resolved(
  s: SkinSelection,
  revision = 1,
  hash = "a".repeat(64),
  color?: string,
): ResolvedSkinPackage {
  return {
    selection: s,
    revision,
    contentHash: hash,
    leaseId: `${s.skinId}-${revision}`,
    data: data(s.skinId, color),
    assets: {},
  };
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
async function setup(
  resolveSkin: (s: SkinSelection) => Promise<ResolvedSkinPackage>,
) {
  const module = await import("../src/renderer/appearance-controller.js");
  let listener!: (s: AppearanceState) => void;
  const release = vi.fn(async () => {}),
    save = vi.fn(async (s: SkinSelection | null) => state(2, s));
  controller = new module.AppearanceController(
    {
      getAppearanceState: async () => state(),
      resolveSkin,
      releaseSkinResources: release,
      setSkinSelection: save,
      onAppearanceStateChanged: (l) => {
        listener = l;
        return () => {};
      },
    },
    host,
  );
  await controller.initialize();
  return { release, save, publish: (s: AppearanceState) => listener(s) };
}
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
describe("appearance switching generations", () => {
  it("isolates fonts between skins and leases from the same plugin content", async () => {
    class Face {
      constructor(public family: string) {}
      load() {
        return Promise.resolve(this);
      }
    }
    vi.stubGlobal("FontFace", Face);
    const { release } = await setup(async (s) => {
      const result = resolved(s);
      return {
        ...result,
        data: {
          ...result.data,
          manifest: {
            ...result.data.manifest,
            schemaVersion: 2,
            assets: { ui: { kind: "font", path: "assets/ui.woff2" } },
            fonts: { ui: [{ asset: "ui", weight: 400, style: "normal" }] },
          } as import("@artemis/theme-contract").VisualSkinManifest,
        },
        assets: {
          ui: {
            url: "artemis-skin://asset/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            hash: "a".repeat(64),
            mime: "font/woff2",
          },
        },
      };
    });
    await controller.preview(selection("a"));
    const first = [...document.fonts][0]!.family;
    await controller.preview(selection("b"));
    const second = [...document.fonts][0]!.family;
    expect(first).not.toBe(second);
    expect(document.fonts.size).toBe(1);
    expect(release).toHaveBeenCalledWith("com.example.a-1");
  });
  it("commits only C after A → B → C resolves out of order", async () => {
    const pending = new Map(
      ["a", "b", "c"].map((k) => [k, deferred<ResolvedSkinPackage>()]),
    );
    const { release } = await setup(
      (s) => pending.get(s.skinId.split(".").at(-1)!)!.promise,
    );
    const a = controller.preview(selection("a")),
      b = controller.preview(selection("b")),
      c = controller.preview(selection("c"));
    pending.get("c")!.resolve(resolved(selection("c")));
    await c;
    pending.get("a")!.resolve(resolved(selection("a")));
    pending.get("b")!.resolve(resolved(selection("b")));
    await Promise.all([a, b]);
    expect(controller.snapshot().applied).toEqual(selection("c"));
    expect(document.documentElement.dataset.artemisSkin).toBe("com.example.c");
    expect(
      document.head.querySelectorAll("[data-appearance-lease]"),
    ).toHaveLength(1);
    expect(release).toHaveBeenCalledWith("com.example.a-1");
    expect(release).toHaveBeenCalledWith("com.example.b-1");
  });
  it("canceling a pending preview restores the selected default and releases late resources", async () => {
    const pending = deferred<ResolvedSkinPackage>();
    const { release, save } = await setup(() => pending.promise);
    const preview = controller.preview(selection("a"));
    await controller.cancelPreview();
    pending.resolve(resolved(selection("a")));
    await preview;
    expect(controller.snapshot().applied).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith("com.example.a-1");
  });
  it("falls back when a plugin is disabled during preparation", async () => {
    const pending = deferred<ResolvedSkinPackage>();
    const { publish, release } = await setup(() => pending.promise);
    const preview = controller.preview(selection("a"));
    const disabled = state(2, selection("a"));
    publish({
      ...disabled,
      catalog: disabled.catalog.map((s) => ({
        ...s,
        available: false,
        enabled: false,
      })),
    });
    await flush();
    pending.resolve(resolved(selection("a")));
    await preview;
    await flush();
    expect(controller.snapshot().applied).toBeNull();
    expect(
      document.head.querySelectorAll("[data-appearance-lease]"),
    ).toHaveLength(0);
    expect(release).toHaveBeenCalled();
  });
  it("refreshes the same ID on revision changes and sends an explicit consumer notification", async () => {
    let revision = 1,
      hash = "a".repeat(64);
    const { publish, release } = await setup(async (s) =>
      resolved(s, revision, hash, revision === 2 ? "#112233" : undefined),
    );
    const event = vi.fn();
    window.addEventListener("artemis:appearance-applied", event);
    await controller.preview(selection("a"));
    revision = 2;
    hash = "b".repeat(64);
    const updated = state(2, selection("a"));
    publish({
      ...updated,
      catalog: updated.catalog.map((s) => ({ ...s, contentHash: hash })),
    });
    await flush();
    await flush();
    expect(controller.snapshot().applied).toEqual(selection("a"));
    expect(
      document.head.querySelector("[data-appearance-lease]")?.textContent,
    ).toContain("#112233");
    expect(release).toHaveBeenCalledWith("com.example.a-1");
    expect(event).toHaveBeenCalledTimes(2);
    window.removeEventListener("artemis:appearance-applied", event);
  });
  it("rejects invalid core tokens and releases the resolved lease", async () => {
    const bad = resolved(selection("a"));
    const documents = structuredClone(bad.data.documents);
    delete (
      documents["tokens.light.json"]!.modes[0]!.tokens as Record<
        string,
        unknown
      >
    )["color.canvas"];
    const { release } = await setup(async () => ({
      ...bad,
      data: { ...bad.data, documents },
    }));
    await controller.preview(selection("a"));
    expect(controller.snapshot().applied).toBeNull();
    expect(release).toHaveBeenCalledWith(bad.leaseId);
  });
});
