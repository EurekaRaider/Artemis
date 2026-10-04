import {
  generateSkinCss,
  generateSkinMotionCss,
  SKIN_FONT_STACKS,
  validateVisualSkinPackage,
  type SkinGeometry,
} from "@artemis/theme-contract";
import type { ArtemisApi } from "../../shared/api.js";
import type {
  AppearanceState,
  ResolvedSkinPackage,
  SkinSelection,
} from "../../shared/appearance.js";
import {
  DEFAULT_DESKTOP_SKIN_ID,
  type DesktopSkinHost,
} from "./desktop-skin.js";
import { replaceDesktopSkinCatalog } from "./desktop-skin-registry.js";

export const APPEARANCE_APPLIED_EVENT = "artemis:appearance-applied";
const EMPTY_ICONS = Object.freeze({});
export interface AppearanceView {
  readonly state: AppearanceState | null;
  readonly preview: SkinSelection | null | undefined;
  readonly applied: SkinSelection | null;
  readonly icons: Readonly<Record<string, readonly SkinGeometry[]>>;
  readonly diagnostics: readonly string[];
  readonly busy: boolean;
}
interface PreparedAppearance {
  resolved: ResolvedSkinPackage;
  style: HTMLStyleElement;
  fonts: FontFace[];
  backgrounds: Partial<Record<"light" | "dark", HTMLElement>>;
  diagnostics: string[];
}
function selectionEqual(
  a: SkinSelection | null | undefined,
  b: SkinSelection | null | undefined,
) {
  return (
    a?.pluginId === b?.pluginId &&
    a?.skinId === b?.skinId &&
    (a === undefined) === (b === undefined)
  );
}
function limited<T>(promise: Promise<T>, timeout = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Resource preparation timed out.")),
      timeout,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
function image(url: string): Promise<HTMLImageElement> {
  const element = new Image();
  return limited(
    new Promise<HTMLImageElement>((resolve, reject) => {
      element.onload = () => {
        if (element.naturalWidth * element.naturalHeight > 20_000_000)
          reject(new Error("Image exceeds pixel limit."));
        else resolve(element);
      };
      element.onerror = () => reject(new Error("Image could not be decoded."));
      element.src = url;
    }),
  ).finally(() => {
    element.onload = null;
    element.onerror = null;
  });
}
function monospaced(family: string, weight: string, style: string): boolean {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return false;
  context.font = `${style} ${weight} 16px "${family}", monospace`;
  const widths = ["iiiiiiii", "WWWWWWWW", "00000000", "........"].map(
    (text) => context.measureText(text).width,
  );
  return Math.max(...widths) - Math.min(...widths) < 0.25;
}
export class AppearanceController {
  private view: AppearanceView = {
    state: null,
    preview: undefined,
    applied: null,
    icons: EMPTY_ICONS,
    diagnostics: [],
    busy: false,
  };
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private active: PreparedAppearance | undefined;
  private readonly background: HTMLDivElement;
  private unsubscribe: (() => void) | undefined;
  private observer: MutationObserver;
  private readonly reduced = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  constructor(
    private readonly api: Pick<
      ArtemisApi,
      | "getAppearanceState"
      | "resolveSkin"
      | "releaseSkinResources"
      | "setSkinSelection"
      | "onAppearanceStateChanged"
    >,
    private readonly host: DesktopSkinHost,
  ) {
    this.background = document.createElement("div");
    this.background.className = "appearance-background";
    this.background.setAttribute("aria-hidden", "true");
    document.body.prepend(this.background);
    this.observer = new MutationObserver(() => this.syncMode());
    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        "data-artemis-skin",
        "data-artemis-theme",
        "data-artemis-contrast",
      ],
    });
    this.reduced.addEventListener("change", this.syncMode);
    document.addEventListener("visibilitychange", this.syncMode);
  }
  snapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<AppearanceView>) {
    this.view = { ...this.view, ...patch };
    for (const l of this.listeners) l();
  }
  async initialize(): Promise<void> {
    if (this.unsubscribe) return;
    this.unsubscribe = this.api.onAppearanceStateChanged((state) => {
      void this.acceptState(state).catch((error) =>
        this.addDiagnostic(String(error)),
      );
    });
    try {
      await this.acceptState(await this.api.getAppearanceState());
    } catch (error) {
      this.addDiagnostic(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  private async acceptState(state: AppearanceState) {
    if (this.view.state && state.revision < this.view.state.revision) return;
    const old = this.view.state;
    this.publish({
      state,
      ...(old?.revision !== state.revision ? { busy: true } : {}),
    });
    if (old?.revision === state.revision) {
      this.syncMode();
      return;
    }
    replaceDesktopSkinCatalog(
      state.catalog
        .filter((s) => s.available && s.manifest)
        .map((s) => ({
          manifest: s.manifest,
          load: async () => undefined,
          ready: () => true,
          available: () =>
            Boolean(
              this.view.state?.catalog.some(
                (c) =>
                  c.pluginId === s.pluginId &&
                  c.id === s.id &&
                  c.available &&
                  c.contentHash === s.contentHash,
              ),
            ),
        })),
    );
    await this.host.setTheme(state.theme);
    if (this.view.state?.revision !== state.revision) return;
    await this.apply(
      this.view.preview === undefined
        ? this.view.state.selection
        : this.view.preview,
    );
  }
  async preview(selection: SkinSelection | null) {
    this.publish({ preview: selection });
    await this.apply(selection);
  }
  async cancelPreview() {
    this.publish({ preview: undefined });
    await this.apply(this.view.state?.selection ?? null);
  }
  async confirmPreview() {
    const selection =
      this.view.preview === undefined
        ? (this.view.state?.selection ?? null)
        : this.view.preview;
    const state = await this.api.setSkinSelection(selection);
    this.publish({ preview: undefined });
    await this.acceptState(state);
  }
  async reset() {
    this.publish({ preview: undefined });
    await this.acceptState(await this.api.setSkinSelection(null));
  }
  private async cleanup(prepared: PreparedAppearance | undefined) {
    if (!prepared) return;
    prepared.style.remove();
    for (const el of Object.values(prepared.backgrounds)) {
      for (const video of el.querySelectorAll("video")) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      el.remove();
    }
    for (const face of prepared.fonts) document.fonts.delete(face);
    await this.api
      .releaseSkinResources(prepared.resolved.leaseId)
      .catch(() => undefined);
  }
  private async prepare(
    resolved: ResolvedSkinPackage,
  ): Promise<PreparedAppearance> {
    const report = validateVisualSkinPackage({
      manifest: resolved.data.manifest,
      tokenDocuments: resolved.data.documents,
      ...(resolved.data.icons ? { icons: resolved.data.icons } : {}),
      ...(resolved.data.motion ? { motion: resolved.data.motion } : {}),
    });
    if (!report.valid || !report.value)
      throw new Error("Resolved skin failed renderer contract validation.");
    const p: PreparedAppearance = {
      resolved,
      style: document.createElement("style"),
      fonts: [],
      backgrounds: {},
      diagnostics: [],
    };
    p.style.dataset.appearanceLease = resolved.leaseId;
    p.style.textContent =
      generateSkinCss(report.value) +
      generateSkinMotionCss(report.value.motion, report.value.manifest.id);
    const manifest = report.value.manifest;
    if (manifest.schemaVersion === 1) return p;
    const familyDeclarations: string[] = [];
    await Promise.all(
      Object.entries(manifest.fonts ?? {}).map(async ([role, faces]) => {
        const loaded: FontFace[] = [];
        // A new lease must not resolve through faces retained by the previous appearance.
        const family = `ArtemisSkin_${resolved.contentHash}_${manifest.id.replace(/[.-]/gu, "_")}_${resolved.leaseId.replace(/[^a-z0-9]/giu, "_")}_${role}`;
        await Promise.all(
          faces.map(async (f) => {
            const asset = resolved.assets[f.asset];
            if (
              !asset ||
              !/^artemis-skin:\/\/asset\/[a-f0-9-]+$/u.test(asset.url)
            )
              return;
            try {
              const face = new FontFace(family, `url("${asset.url}")`, {
                weight: String(f.weight),
                style: f.style,
              });
              await limited(face.load());
              document.fonts.add(face);
              loaded.push(face);
            } catch {
              p.diagnostics.push(`${role}: font unavailable; system fallback.`);
            }
          }),
        );
        if (loaded.length !== faces.length) {
          for (const face of loaded) document.fonts.delete(face);
          return;
        }
        if (
          role === "code" &&
          loaded.some((face) => !monospaced(family, face.weight, face.style))
        ) {
          for (const face of loaded) document.fonts.delete(face);
          p.diagnostics.push("code: font is not monospaced; system fallback.");
          return;
        }
        p.fonts.push(...loaded);
        if (loaded.length)
          familyDeclarations.push(
            `--appearance-font-${role}:"${family}",${role === "code" ? SKIN_FONT_STACKS["system-mono"] : SKIN_FONT_STACKS["system-ui"]};`,
          );
      }),
    );
    if (familyDeclarations.length)
      p.style.textContent += `:root[data-artemis-skin="${manifest.id}"]{${familyDeclarations.join("")}--artemis-typography-body-family:var(--appearance-font-ui,${SKIN_FONT_STACKS["system-ui"]});--artemis-typography-display-family:var(--appearance-font-ui,${SKIN_FONT_STACKS["system-ui"]});--artemis-typography-mono-family:var(--appearance-font-code,${SKIN_FONT_STACKS["system-mono"]});}`;
    await Promise.all(
      (["light", "dark"] as const).map(async (theme) => {
        const b = manifest.backgrounds[theme];
        if (b.type === "none") return;
        const asset =
          resolved.assets[b.type === "video" ? b.poster! : b.asset!];
        if (!asset) return;
        try {
          const poster = await image(asset.url);
          const element = document.createElement("div");
          element.append(poster);
          if (b.type === "video") {
            const source = resolved.assets[b.asset!];
            if (source) {
              const video = document.createElement("video");
              video.muted = true;
              video.defaultMuted = true;
              video.loop = true;
              video.playsInline = true;
              video.disablePictureInPicture = true;
              video.preload = "metadata";
              video.poster = asset.url;
              try {
                await limited(
                  new Promise<void>((resolve, reject) => {
                    const ready = () => {
                      video.removeEventListener("loadeddata", ready);
                      video.removeEventListener("error", failed);
                      if (
                        !Number.isFinite(video.duration) ||
                        video.duration > 60 ||
                        video.videoWidth > 1920 ||
                        video.videoHeight > 1080 ||
                        video.videoWidth < 1 ||
                        video.videoHeight < 1
                      )
                        reject(
                          new Error("Video exceeds decoded media limits."),
                        );
                      else resolve();
                    };
                    const failed = () => {
                      video.removeEventListener("loadeddata", ready);
                      video.removeEventListener("error", failed);
                      reject(new Error("Video could not be decoded."));
                    };
                    video.addEventListener("loadeddata", ready);
                    video.addEventListener("error", failed);
                    video.preload = "auto";
                    video.src = source.url;
                  }),
                );
                video.addEventListener("error", () => {
                  video.pause();
                  video.removeAttribute("src");
                  video.load();
                  video.style.visibility = "hidden";
                  const message = "Video unavailable; using poster.";
                  p.diagnostics.push(message);
                  if (this.active === p) this.addDiagnostic(message);
                });
                element.append(video);
              } catch {
                video.pause();
                video.removeAttribute("src");
                video.load();
                p.diagnostics.push(
                  `${theme}: video unavailable; using poster.`,
                );
              }
            }
          }
          element.className = "appearance-background-media";
          Object.assign(element.style, {
            opacity: String(b.opacity ?? 1),
            filter: `blur(${b.blur ?? 0}px)`,
          });
          for (const child of element.children)
            Object.assign((child as HTMLElement).style, {
              objectFit: b.fit ?? "cover",
              objectPosition: `${b.position?.[0] ?? 50}% ${b.position?.[1] ?? 50}%`,
            });
          const scrim = document.createElement("div");
          scrim.className = "appearance-background-scrim";
          scrim.style.backgroundColor = b.scrim ?? "transparent";
          element.append(scrim);
          p.backgrounds[theme] = element;
        } catch {
          p.diagnostics.push(
            `${theme}: wallpaper unavailable; using skin color.`,
          );
        }
      }),
    );
    return p;
  }
  private addDiagnostic(message: string) {
    if (!this.view.diagnostics.includes(message))
      this.publish({ diagnostics: [...this.view.diagnostics, message] });
  }
  private async apply(selection: SkinSelection | null) {
    const generation = ++this.generation;
    const entry =
      selection &&
      this.view.state?.catalog.find(
        (s) => s.pluginId === selection.pluginId && s.id === selection.skinId,
      );
    this.publish({ busy: true });
    let prepared: PreparedAppearance | undefined,
      resolved: ResolvedSkinPackage | undefined;
    try {
      if (selection && entry?.available) {
        resolved = await this.api.resolveSkin(selection);
        prepared = await this.prepare(resolved);
        const latest = this.view.state?.catalog.find(
          (s) => s.pluginId === selection.pluginId && s.id === selection.skinId,
        );
        if (
          generation !== this.generation ||
          !latest?.available ||
          latest.contentHash !== resolved.contentHash ||
          this.view.state?.revision !== resolved.revision
        ) {
          await this.cleanup(prepared);
          return;
        }
      }
      if (generation !== this.generation) return;
      const old = this.active;
      if (prepared) {
        prepared.style.media = "all";
        document.head.append(prepared.style);
      }
      const transition = await this.host.selectSkin(
        prepared?.resolved.data.manifest.id ?? DEFAULT_DESKTOP_SKIN_ID,
      );
      if (
        generation !== this.generation ||
        transition.status === "superseded"
      ) {
        await this.cleanup(prepared);
        return;
      }
      this.active = prepared;
      this.publish({
        applied: transition.status === "applied" && prepared ? selection : null,
        diagnostics: prepared
          ? [
              ...prepared.diagnostics,
              ...(transition.status === "fallback"
                ? [
                    "Skin does not support the current mode; default skin is active.",
                  ]
                : []),
            ]
          : selection
            ? [entry?.reason ?? "Skin unavailable; default skin is active."]
            : [],
        busy: false,
      });
      this.syncMode();
      window.dispatchEvent(new Event(APPEARANCE_APPLIED_EVENT));
      await this.cleanup(old);
    } catch (error) {
      if (prepared) await this.cleanup(prepared);
      else if (resolved)
        await this.api
          .releaseSkinResources(resolved.leaseId)
          .catch(() => undefined);
      if (generation !== this.generation) return;
      const old = this.active;
      this.active = undefined;
      await this.host.selectSkin(DEFAULT_DESKTOP_SKIN_ID);
      this.publish({
        applied: null,
        icons: EMPTY_ICONS,
        busy: false,
        diagnostics: [error instanceof Error ? error.message : String(error)],
      });
      this.syncMode();
      window.dispatchEvent(new Event(APPEARANCE_APPLIED_EVENT));
      await this.cleanup(old);
    }
  }
  private syncMode = () => {
    const root = document.documentElement;
    const effective =
      this.active &&
      root.dataset.artemisSkin === this.active.resolved.data.manifest.id;
    const high = root.dataset.artemisContrast === "high";
    const icons = effective
      ? (this.active!.resolved.data.icons?.icons ?? EMPTY_ICONS)
      : EMPTY_ICONS;
    const applied = effective ? this.active!.resolved.selection : null;
    const effectiveChanged = !selectionEqual(this.view.applied, applied);
    if (this.view.icons !== icons || effectiveChanged)
      this.publish({ icons, applied });
    if (effectiveChanged)
      window.dispatchEvent(new Event(APPEARANCE_APPLIED_EVENT));
    const theme = root.dataset.artemisTheme === "dark" ? "dark" : "light";
    const element =
      effective && !high ? this.active!.backgrounds[theme] : undefined;
    if (this.background.firstElementChild !== element) {
      for (const old of this.background.querySelectorAll("video")) old.pause();
      this.background.replaceChildren(...(element ? [element] : []));
    }
    this.background.hidden = !element;
    root.dataset.appearanceWallpaper = element ? "true" : "false";
    const video = element?.querySelector("video");
    if (video) {
      const pause =
        high ||
        this.reduced.matches ||
        this.view.state?.mediaPaused ||
        document.hidden;
      if (pause) {
        video.pause();
        video.style.visibility = "hidden";
      } else {
        video.style.visibility = "visible";
        void video.play().catch(() => {
          video.style.visibility = "hidden";
          this.addDiagnostic("Video playback unavailable; using poster.");
        });
      }
    }
  };
  async dispose() {
    this.generation++;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.observer.disconnect();
    this.reduced.removeEventListener("change", this.syncMode);
    document.removeEventListener("visibilitychange", this.syncMode);
    const old = this.active;
    this.active = undefined;
    this.background.remove();
    await this.cleanup(old);
    this.listeners.clear();
  }
}
let controller: AppearanceController | undefined;
export function getAppearanceController() {
  if (!controller) throw new Error("Appearance has not been initialized.");
  return controller;
}
export async function bootstrapAppearance() {
  // Browser-hosted previews and legacy QA bridges may not implement desktop IPC.
  if (typeof window.artemis?.getAppearanceState !== "function") return;
  const { desktopSkinHost } = await import("./desktop-skin-bootstrap.js");
  controller ??= new AppearanceController(window.artemis, desktopSkinHost);
  await controller.initialize();
}
