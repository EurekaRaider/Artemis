// DesignPanelHost geometry lifecycle regression tests.
//
// The renderer drives the host purely through IPC ordering, so these tests
// replay the exact message sequences the mount component produces:
//   first open:  ensure (in flight) -> setBounds(real) [stashed]
//                -> setVisible(true) [dropped: no view yet]
//                -> ensure resolves -> setBounds(real) -> setVisible(true)
// The last setVisible(true) once restored a 0x0 default (lastBounds unset on
// a never-hidden panel) and blanked the freshly reported geometry.

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface TrackedView {
  bounds: { x: number; y: number; width: number; height: number };
  webContents: { close: ReturnType<typeof vi.fn> };
  removed: number;
}

const tracked = vi.hoisted(() => ({ views: [] as TrackedView[] }));

vi.mock("electron", () => {
  class FakePort {
    on() {}
    start() {}
    postMessage() {}
    close() {}
  }
  class FakeView {
    bounds: { x: number; y: number; width: number; height: number } = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
    webContents = {
      loadURL: async () => {},
      postMessage: () => {},
      on: () => {},
      getURL: () => "file:///panel/index.html",
      isDestroyed: () => false,
      close: vi.fn(),
    };
    removed = 0;
    constructor(_webPreferences: unknown) {
      tracked.views.push(this as unknown as TrackedView);
    }
    setBounds(bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) {
      this.bounds = { ...bounds };
    }
    getBounds() {
      return { ...this.bounds };
    }
  }
  return {
    BrowserWindow: class {},
    MessageChannelMain: class {
      port1 = new FakePort();
      port2 = new FakePort();
    },
    WebContentsView: FakeView,
    session: { fromPartition: () => ({}) },
  };
});

import {
  DesignPanelHost,
  sanitizeCandidateImages,
} from "../src/main/design-plugin-panel-host.js";

const packageRoot = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "resources/design-plugins",
);

const RECT = { x: 12, y: 34, width: 960, height: 796 };
const RECT2 = { x: 8, y: 20, width: 720, height: 640 };
const ZERO = { x: 0, y: 0, width: 0, height: 0 };

function makeWindow() {
  return {
    contentView: {
      addChildView: vi.fn(),
      removeChildView: (view: unknown) => {
        (view as TrackedView).removed += 1;
      },
    },
  } as unknown as Electron.BrowserWindow;
}

function freshHost() {
  const host = new DesignPanelHost();
  host.setCatalogRoot(packageRoot);
  return host;
}

beforeEach(() => {
  tracked.views.length = 0;
});

describe("DesignPanelHost geometry lifecycle", () => {
  it("first open: stashed bounds survive the ensure-resolved visible re-report", async () => {
    const host = freshHost();
    const window = makeWindow();
    const pending = host.ensurePanel(window, "t1", "workspace");
    // Mount effects fire while ensure is still creating the view.
    host.setBounds("t1", "workspace", RECT);
    host.setVisible("t1", "workspace", true);
    await pending;
    // ensure resolved: the component re-reports bounds then visible.
    host.setBounds("t1", "workspace", RECT);
    host.setVisible("t1", "workspace", true);
    expect(tracked.views).toHaveLength(1);
    expect(tracked.views[0]!.bounds).toEqual(RECT);
  });

  it("first open: a pre-layout 0x0 report never pins the view", async () => {
    const host = freshHost();
    const window = makeWindow();
    const pending = host.ensurePanel(window, "t1b", "workspace");
    // Pane not laid out yet: the mount report is 0x0, must be dropped.
    host.setBounds("t1b", "workspace", ZERO);
    await pending;
    expect(tracked.views[0]!.bounds).toEqual(ZERO);
    // Layout settles: the observer re-report applies for real.
    host.setBounds("t1b", "workspace", RECT);
    expect(tracked.views[0]!.bounds).toEqual(RECT);
  });

  it("hide/show round-trips geometry; double hide does not clobber it", async () => {
    const host = freshHost();
    await host.ensurePanel(makeWindow(), "t2", "workspace");
    host.setBounds("t2", "workspace", RECT);
    host.setVisible("t2", "workspace", false);
    expect(tracked.views[0]!.bounds).toEqual(ZERO);
    // A second collapse (tab inactive + dock resize) must keep the saved
    // bounds instead of overwriting them with the zeroed geometry.
    host.setVisible("t2", "workspace", false);
    host.setVisible("t2", "workspace", true);
    expect(tracked.views[0]!.bounds).toEqual(RECT);
  });

  it("bounds reported while collapsed become the restore target; zero-size artifacts do not", async () => {
    const host = freshHost();
    await host.ensurePanel(makeWindow(), "t3", "workspace");
    host.setBounds("t3", "workspace", RECT);
    host.setVisible("t3", "workspace", false);
    // Dock drag while the tab is hidden reports fresh real geometry; the
    // hidden pane itself only ever reports display:none zeros.
    host.setBounds("t3", "workspace", RECT2);
    host.setBounds("t3", "workspace", ZERO);
    expect(tracked.views[0]!.bounds).toEqual(ZERO);
    host.setVisible("t3", "workspace", true);
    expect(tracked.views[0]!.bounds).toEqual(RECT2);
  });

  it("release arriving before ensure completes tears the fresh view down", async () => {
    const host = freshHost();
    const window = makeWindow();
    const pending = host.ensurePanel(window, "t4", "workspace");
    host.releasePanel("t4", "workspace");
    await pending;
    expect(host.listPanels("t4")).toHaveLength(0);
    expect(tracked.views[0]!.removed).toBe(1);
    expect(tracked.views[0]!.webContents.close).toHaveBeenCalled();
  });

  it("re-ensure after a pending release keeps the panel (StrictMode remount)", async () => {
    const host = freshHost();
    const window = makeWindow();
    const first = host.ensurePanel(window, "t5", "workspace");
    // StrictMode: mount -> cleanup releases -> mount again coalesces.
    host.releasePanel("t5", "workspace");
    const second = host.ensurePanel(window, "t5", "workspace");
    await Promise.all([first, second]);
    expect(host.listPanels("t5")).toHaveLength(1);
    expect(tracked.views[0]!.removed).toBe(0);
  });
});

describe("sanitizeCandidateImages (panel attach channel)", () => {
  it("keeps bounded image data URLs and drops junk", () => {
    const good = "data:image/png;base64,iVBORw0KGgo=";
    const out = sanitizeCandidateImages([
      good,
      "data:image/jpeg;base64,/9j/4AAQ",
      "blob:panel/xyz", // legacy blob URL: dropped
      "data:text/html;base64,PHNjcmlwdD4=", // non-image: dropped
      "not-a-url",
      42,
    ]);
    expect(out).toEqual([good, "data:image/jpeg;base64,/9j/4AAQ"]);
    expect(sanitizeCandidateImages([])).toBeUndefined();
    expect(sanitizeCandidateImages(["junk"])).toBeUndefined();
  });

  it("caps the count at 6 and rejects oversized payloads", () => {
    const many = Array.from(
      { length: 8 },
      (_, i) => `data:image/png;base64,AAA${i}`,
    );
    expect(sanitizeCandidateImages(many)).toHaveLength(6);
    const oversized = `data:image/png;base64,${"A".repeat(10 * 1024 * 1024 + 5)}`;
    expect(sanitizeCandidateImages([oversized])).toBeUndefined();
  });
});
